import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { DatabaseSync } from 'node:sqlite'
import { renameSync } from '../repo/rename'
import { CHUNK_VERSION } from './source'
import { SearchError, type SearchSnapshot } from './types'
import { readVector, vectorBytes } from './vectors'
import { snapshotInputs, type IndexedEmbeddingInput } from './embedding'
import { invalidateIndexCache, readIndexState } from './state'

export const CACHE_PATH = '.webnovel/finalized-search.sqlite'
const APPLICATION_ID = 0x57565336
const SCHEMA_VERSION = 2

function assertCachePaths(root: string): string {
  const runtime = path.join(root, '.webnovel')
  if (fs.lstatSync(runtime).isSymbolicLink()) throw new SearchError('unsafe-cache', '检索缓存目录不得为链接')
  const filename = path.join(root, CACHE_PATH)
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try {
      const stat = fs.lstatSync(filename + suffix)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new SearchError('unsafe-cache', '检索缓存位置被目录、链接或共享硬链接占用')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return filename
}

/** Called only while holding the book lock. No connection survives a network wait. */
export class SearchCache {
  private constructor(private readonly db: DatabaseSync, private currentState: 'created' | 'ready' | 'rebuilt') {}
  get state(): 'created' | 'ready' | 'rebuilt' { return this.currentState }

  static async open(root: string): Promise<SearchCache> {
    let SQLite: typeof import('node:sqlite')
    // Prefix-only Node builtins are not recognized by older ESM transform runners.
    // Keep this lazy so hosts without SQLite can still load the other book tools.
    try { SQLite = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite') }
    catch { throw new SearchError('sqlite-unavailable', '当前 Node 不支持内置 SQLite，无法建立检索索引') }
    const filename = assertCachePaths(root)
    let state: SearchCache['state'] = fs.existsSync(filename) ? 'ready' : 'created'
    if (state === 'created') {
      const previous = readIndexState(root)
      // A missing cache after completed work is also data loss. Initial creation
      // must not replace the generation of the worker that is building it.
      if (previous.completedChunks || previous.fingerprint || previous.indexedHead || previous.phase === 'ready') invalidateIndexCache(root)
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      let db: DatabaseSync | undefined
      let owned = false
      try {
        db = new SQLite.DatabaseSync(filename)
        db.exec('PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=0;')
        const appId = db.prepare('PRAGMA application_id').get()?.['application_id']
        const version = db.prepare('PRAGMA user_version').get()?.['user_version']
        if (appId !== 0 && appId !== APPLICATION_ID) throw new SearchError('foreign-cache', '缓存位置存在其他 SQLite 数据库，未改动该文件')
        owned = appId === APPLICATION_ID
        if (appId === 0) {
          if (db.prepare('SELECT name FROM sqlite_master').all().length) throw new SearchError('foreign-cache', '缓存位置存在未知数据库，未改动该文件')
          const previous = readIndexState(root)
          if (previous.completedChunks || previous.fingerprint || previous.indexedHead || previous.phase === 'ready') {
            invalidateIndexCache(root)
            state = 'rebuilt'
          }
          db.exec(`BEGIN;
            CREATE TABLE chunks (id TEXT PRIMARY KEY, body TEXT NOT NULL, vector BLOB, revision TEXT, dimensions INTEGER);
            CREATE VIRTUAL TABLE terms USING fts5(id UNINDEXED, body, tokenize='trigram case_sensitive 1');
            CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE embeddings (key TEXT PRIMARY KEY, body TEXT NOT NULL, title TEXT NOT NULL, vector BLOB NOT NULL, revision TEXT NOT NULL, dimensions INTEGER NOT NULL);
            PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION}; COMMIT;`)
        } else if (version === 1) {
          // Retain the old rows until their exact source inputs can be validated.
          db.exec(`BEGIN;
            CREATE TABLE embeddings (key TEXT PRIMARY KEY, body TEXT NOT NULL, title TEXT NOT NULL, vector BLOB NOT NULL, revision TEXT NOT NULL, dimensions INTEGER NOT NULL);
            PRAGMA user_version=${SCHEMA_VERSION}; COMMIT;`)
        } else if (version !== SCHEMA_VERSION) throw new SearchError('obsolete-cache', '检索缓存格式已变更')
        if (db.prepare('PRAGMA quick_check').get()?.['quick_check'] !== 'ok') throw new SearchError('damaged-cache', '检索缓存损坏')
        const chunkVersion = db.prepare("SELECT value FROM metadata WHERE key='chunk-version'").get()?.['value']
        if (chunkVersion !== undefined && chunkVersion !== CHUNK_VERSION) throw new SearchError('obsolete-cache', '切片版本已变更')
        // A structurally valid SQLite file can still have damaged or missing FTS content.
        db.prepare('SELECT id, body, vector, revision, dimensions FROM chunks LIMIT 0').all()
        db.prepare('SELECT key, body, title, vector, revision, dimensions FROM embeddings LIMIT 0').all()
        // Compare in linear time. SQL EXCEPT/GROUP BY on whole paragraph bodies
        // spills large temporary sort trees for long books on Windows.
        const content = new Map(db.prepare('SELECT id, body FROM chunks').all().map(row => [row['id'], row['body']]))
        const terms = db.prepare('SELECT id, body FROM terms').all()
        if (terms.length !== content.size || new Set(terms.map(row => row['id'])).size !== content.size
          || terms.some(row => content.get(row['id']) !== row['body'])) {
          throw new SearchError('damaged-cache', '正文切片与关键词索引不一致')
        }
        return new SearchCache(db, state)
      } catch (error) {
        try { db?.close() } catch { /* Preserve the original failure. */ }
        const errcode = (error as { errcode?: number }).errcode
        const rebuild = errcode === 11 || errcode === 26 || (owned && (errcode === 1 || errcode === 17))
          || (error instanceof SearchError && ['damaged-cache', 'obsolete-cache'].includes(error.code))
        if (!rebuild || attempt > 0) throw error
        assertCachePaths(root)
        // Quarantine only this derived cache, retaining its bytes for diagnosis.
        const backup = `${filename}.invalid-${randomUUID()}`
        for (const suffix of ['', '-journal', '-wal', '-shm']) {
          if (fs.existsSync(filename + suffix)) renameSync(filename + suffix, backup + suffix)
        }
        invalidateIndexCache(root)
        state = 'rebuilt'
      }
    }
    throw new SearchError('index-error', '无法重建检索缓存')
  }

  close(): void { this.db.close() }

  vectors(snapshot: SearchSnapshot, revision: string, dimensions: number): Map<string, Float32Array> {
    const inputs = snapshotInputs(snapshot, revision)
    const byChunk = new Map([...inputs.values()].flatMap(input => input.chunkIds.map(id => [id, input] as const)))
    const result = new Map<string, Float32Array>()
    const migrated = new Map<string, Float32Array>()
    for (const row of this.db.prepare('SELECT id, body, vector FROM chunks WHERE revision=? AND dimensions=?').all(revision, dimensions)) {
      if (typeof row['id'] !== 'string') continue
      const expected = byChunk.get(row['id'])
      if (!expected || row['body'] !== expected.input.text) continue
      const vector = readVector(row['vector'], dimensions)
      if (vector) migrated.set(expected.key, vector)
    }
    if (migrated.size) this.saveEmbeddings([...inputs.values()].filter(input => migrated.has(input.key)), migrated, revision)
    for (const row of this.db.prepare('SELECT key, body, title, vector FROM embeddings WHERE revision=? AND dimensions=?').all(revision, dimensions)) {
      if (typeof row['key'] !== 'string') continue
      const expected = inputs.get(row['key'])
      if (!expected || row['body'] !== expected.input.text || row['title'] !== (expected.input.title ?? '')) continue
      const vector = readVector(row['vector'], dimensions)
      if (vector) for (const id of expected.chunkIds) result.set(id, vector)
    }
    return result
  }

  saveEmbeddings(inputs: readonly IndexedEmbeddingInput[], vectors: ReadonlyMap<string, Float32Array>, revision: string, signal?: AbortSignal): void {
    const insert = this.db.prepare('INSERT INTO embeddings(key,body,title,vector,revision,dimensions) VALUES (?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,title=excluded.title,vector=excluded.vector,revision=excluded.revision,dimensions=excluded.dimensions')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const input of inputs) {
        signal?.throwIfAborted()
        const vector = vectors.get(input.key)
        if (!vector) throw new SearchError('invalid-embedding', '缺少已验证的批次向量')
        insert.run(input.key, input.input.text, input.input.title ?? '', vectorBytes(vector), revision, vector.length)
      }
      signal?.throwIfAborted()
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  clearEmbeddings(): void {
    this.db.exec('BEGIN; DELETE FROM embeddings; UPDATE chunks SET vector=NULL,revision=NULL,dimensions=NULL; COMMIT;')
  }

  pruneEmbeddings(snapshot: SearchSnapshot, revision: string): void {
    const live = snapshotInputs(snapshot, revision)
    const remove = this.db.prepare('DELETE FROM embeddings WHERE key=?')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const row of this.db.prepare('SELECT key FROM embeddings').all()) if (!live.has(String(row['key']))) remove.run(row['key']!)
      this.db.exec('UPDATE chunks SET vector=NULL,revision=NULL,dimensions=NULL; COMMIT;')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  publish(snapshot: SearchSnapshot, vectors: ReadonlyMap<string, Float32Array>, revision: string | undefined, signal?: AbortSignal): void {
    if (revision && vectors.size) {
      const inputs = snapshotInputs(snapshot, revision)
      const stored = new Map<string, Float32Array>()
      for (const input of inputs.values()) {
        const vector = input.chunkIds.map(id => vectors.get(id)).find(value => value !== undefined)
        if (vector) stored.set(input.key, vector)
      }
      this.saveEmbeddings([...inputs.values()].filter(input => stored.has(input.key)), stored, revision, signal)
    }
    const chunks = snapshot.documents.flatMap(doc => doc.chunks)
    const current = new Map(this.db.prepare('SELECT id, body FROM chunks').all().map(row => [row['id'], row['body']]))
    const live = new Set(chunks.map(chunk => chunk.id))
    const remove = this.db.prepare('DELETE FROM chunks WHERE id=?')
    const removeTerms = this.db.prepare('DELETE FROM terms WHERE id=?')
    const insert = this.db.prepare('INSERT INTO chunks(id,body) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,vector=NULL,revision=NULL,dimensions=NULL')
    const insertTerms = this.db.prepare('INSERT INTO terms(id,body) VALUES (?,?)')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const id of current.keys()) {
        signal?.throwIfAborted()
        if (typeof id === 'string' && !live.has(id)) { remove.run(id); removeTerms.run(id) }
      }
      for (const chunk of chunks) {
        signal?.throwIfAborted()
        if (current.get(chunk.id) !== chunk.text) {
          insert.run(chunk.id, chunk.text)
          // New content hashes have never had an FTS row. A DELETE by the UNINDEXED
          // id would scan all previous rows for every new chunk during first build.
          if (current.has(chunk.id)) removeTerms.run(chunk.id)
          insertTerms.run(chunk.id, chunk.text)
        }
      }
      this.db.prepare("INSERT INTO metadata(key,value) VALUES ('chunk-version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(CHUNK_VERSION)
      signal?.throwIfAborted()
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  /** Literal, case-sensitive phrases; SQL and FTS syntax never comes from the user. */
  keyword(query: string, expected: ReadonlySet<string>): Array<{ id: string; score: number }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const rows = [...query].length >= 3
          ? this.db.prepare('SELECT id, rank AS score FROM terms WHERE terms MATCH ? AND instr(body,?)>0').all('"' + query.replaceAll('"', '""') + '"', query)
          : this.db.prepare('SELECT id, 0 AS score FROM terms WHERE instr(body,?)>0').all(query)
        const ids = new Set(rows.map(row => String(row['id'])))
        if (rows.length === expected.size && ids.size === expected.size && [...ids].every(id => expected.has(id))) {
          return rows.map(row => ({ id: String(row['id']), score: Number(row['score']) }))
        }
      } catch (error) {
        if (![1, 11, 26].includes((error as { errcode: number }).errcode)) throw error
      }
      if (attempt === 0) {
        // Check actual recall against this request's source snapshot, not a costly
        // full re-tokenization on every open. Repair only when this check disagrees.
        this.db.exec("INSERT INTO terms(terms) VALUES('rebuild')")
        this.currentState = 'rebuilt'
      }
    }
    throw new SearchError('damaged-cache', '关键词索引重建后仍与原文不一致')
  }
}
