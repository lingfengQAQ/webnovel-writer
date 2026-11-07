import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { canonicalizePath, withBookLockAsync } from '@webnovel/core'
import type { StoryGraph } from '../study/graph-types'
import type { GraphExtraction } from '../study/graph-extraction'

const APPLICATION_ID = 0x57564731
const CACHE_NAME = 'story-graph.sqlite', STATE_NAME = 'story-graph-state.json'
export interface GraphState {
  schema: 2
  bookId: string
  enabled: boolean
  paused: boolean
  generation: number
  phase: 'disabled' | 'ready' | 'queued' | 'running' | 'paused' | 'failed' | 'unconfigured' | 'model-changed'
  calls: number
  inputTokens: number
  outputTokens: number
  updatedAt: number
  fingerprint?: string
  revision?: string
  model?: string
  completed?: number
  total?: number
  error?: string
}
export function initialGraphState(bookId: string): GraphState {
  return { schema: 2, bookId, enabled: false, paused: false, generation: 0, phase: 'disabled',
    calls: 0, inputTokens: 0, outputTokens: 0, updatedAt: 0 }
}
export function graphFile(root: string, name: string): string {
  if (!/^(?:story-graph\.sqlite(?:-(?:journal|wal|shm))?|story-graph-state\.json|story-graph\.worker\.lock)$/.test(name)) throw new Error('图谱运行文件名无效')
  const runtime = path.join(root, '.webnovel')
  for (const [target, directory] of [[runtime, true], [path.join(runtime, name), false]] as const) {
    try {
      const stat = fs.lstatSync(target)
      if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) throw new Error('图谱缓存位置被链接或其他文件占用，已保留现场')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return path.join(runtime, name)
}
export function readGraphState(root: string, bookId: string): GraphState {
  const file = graphFile(root, STATE_NAME)
  if (!fs.existsSync(file)) return initialGraphState(bookId)
  if (fs.statSync(file).size > 32768) throw new Error('图谱控制记录过大，已保留现场')
  let value: GraphState
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')) as GraphState } catch { throw new Error('图谱控制记录无法解析，已保留现场') }
  if (value?.schema !== 2 || value.bookId !== bookId || typeof value.enabled !== 'boolean' || typeof value.paused !== 'boolean'
    || !['disabled', 'ready', 'queued', 'running', 'paused', 'failed', 'unconfigured', 'model-changed'].includes(value.phase)
    || [value.generation, value.calls, value.inputTokens, value.outputTokens, value.updatedAt].some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('图谱控制记录格式或书身份不匹配，已保留现场')
  return value
}
/** Mutations hold the existing short book lock; reads never acquire it. */
export function writeGraphState(root: string, state: GraphState): void {
  const file = graphFile(root, STATE_NAME), temporary = `${file}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, JSON.stringify(state) + '\n', { flag: 'wx', mode: 0o600 })
    graphFile(root, STATE_NAME)
    fs.renameSync(temporary, file)
  } finally { try { fs.unlinkSync(temporary) } catch { /* already replaced */ } }
}
export function changeGraphState(root: string, bookId: string, update: (state: GraphState) => GraphState): Promise<GraphState> {
  return withBookLockAsync(root, async () => {
    const next = update(readGraphState(root, bookId)); writeGraphState(root, next); return next
  })
}

export function acquireGraphLease(root: string): Promise<() => void> {
  return withBookLockAsync(root, async () => {
    const file = graphFile(root, 'story-graph.worker.lock'), token = randomUUID()
    if (fs.existsSync(file)) {
      let pid: number
      try { pid = JSON.parse(fs.readFileSync(file, 'utf8')).pid as number } catch { throw new Error('图谱任务锁无法解析，未清理原文件') }
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('图谱任务锁身份无效')
      let dead = false
      try { process.kill(pid, 0) } catch (error) { dead = (error as NodeJS.ErrnoException).code === 'ESRCH' }
      if (!dead) throw new Error('另一图谱任务正在运行')
      fs.unlinkSync(graphFile(root, 'story-graph.worker.lock'))
    }
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token }), { flag: 'wx', mode: 0o600 })
    return () => {
      try { if (JSON.parse(fs.readFileSync(graphFile(root, 'story-graph.worker.lock'), 'utf8')).token === token) fs.unlinkSync(file) } catch { /* another owner or removed root */ }
    }
  })
}

export interface GraphCacheView {
  readonly status: 'missing' | 'ready' | 'invalid'
  readonly fingerprint?: string
  readonly extractions: readonly GraphExtraction[]
  readonly error?: string
}
export function graphCacheSignature(root: string): string {
  const file = graphFile(root, CACHE_NAME)
  return fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : 'missing'
}
function cacheHeader(file: string): Buffer {
  const header = Buffer.alloc(100), handle = fs.openSync(file, 'r')
  try { fs.readSync(handle, header, 0, 100, 0) } finally { fs.closeSync(handle) }
  return header
}

/** Explicit rebuild preserves the old derived cache; foreign databases and links remain untouched. */
export function replaceGraphCache(root: string, bookId: string): void {
  const file = graphFile(root, CACHE_NAME)
  if (!fs.existsSync(file)) return
  const header = cacheHeader(file)
  if (header.subarray(0, 16).toString() !== 'SQLite format 3\0' || header.readUInt32BE(68) !== APPLICATION_ID) throw new Error('该位置不是可确认的图谱缓存，未移动原文件')
  let db: DatabaseSync | undefined
  try {
    db = database(root, true)
    const identity = db.prepare('SELECT root, book_id FROM identity').get()
    if (identity && (identity.root !== canonicalizePath(root) || identity.book_id !== bookId)) throw new Error('FOREIGN_GRAPH_CACHE')
  } catch (error) { if (error instanceof Error && error.message === 'FOREIGN_GRAPH_CACHE') throw new Error('缓存属于其他作品，未移动原文件') }
  finally { try { db?.close() } catch { /* a damaged owned database is still preserved */ } }
  const suffix = `.replaced-${randomUUID()}`, moved: Array<[string, string]> = []
  try {
    for (const ending of ['', '-journal', '-wal', '-shm']) {
      const source = graphFile(root, CACHE_NAME + ending), target = source + suffix
      if (!fs.existsSync(source)) continue
      fs.renameSync(source, target); moved.push([source, target])
    }
  } catch (error) {
    for (const [source, target] of moved.reverse()) if (!fs.existsSync(source)) fs.renameSync(target, source)
    throw error
  }
}
function database(root: string, readOnly: boolean): DatabaseSync {
  const filename = graphFile(root, CACHE_NAME)
  for (const suffix of ['-journal', '-wal', '-shm']) graphFile(root, CACHE_NAME + suffix)
  const SQLite = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
  const db = new SQLite.DatabaseSync(filename, { readOnly })
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=0;')
  return db
}
function verify(db: DatabaseSync, root: string, bookId: string): void {
  if (db.prepare('PRAGMA application_id').get()?.['application_id'] !== APPLICATION_ID || db.prepare('PRAGMA user_version').get()?.['user_version'] !== 1) throw new Error('图谱缓存身份或版本不匹配，已保留原文件')
  const identity = db.prepare('SELECT root, book_id FROM identity').get()
  if (identity?.root !== canonicalizePath(root) || identity?.book_id !== bookId) throw new Error('图谱缓存属于其他作品或目录，未使用该文件')
}

/** No file is created, recovered, quarantined or mutated by this path. */
export function readGraphCache(root: string, bookId: string): GraphCacheView {
  let db: DatabaseSync | undefined
  try {
    const file = graphFile(root, CACHE_NAME)
    if (!fs.existsSync(file)) return { status: 'missing', extractions: [] }
    const header = cacheHeader(file)
    if (header.subarray(0, 16).toString() !== 'SQLite format 3\0' || header.readUInt32BE(68) !== APPLICATION_ID) throw new Error('该位置不是可确认的图谱缓存，未打开原文件')
    // A readonly SQLite WAL connection may create a missing shared-memory file.
    // Our writer uses rollback journals; refuse other modes before SQLite sees them.
    if (header[18] !== 1 || header[19] !== 1) throw new Error('图谱缓存使用了其他日志模式，请显式重建；读取未创建辅助文件')
    db = database(root, true); verify(db, root, bookId)
    const snapshot = db.prepare('SELECT fingerprint FROM snapshot WHERE id=1').get()
    const extractions = db.prepare('SELECT payload FROM extractions').all().map(row => JSON.parse(String(row.payload)) as GraphExtraction)
    for (const row of extractions) {
      if (!row || typeof row.version !== 'string' || typeof row.key !== 'string' || typeof row.evidenceId !== 'string' || typeof row.sourceHash !== 'string'
        || typeof row.identityHash !== 'string' || typeof row.revision !== 'string' || typeof row.model !== 'string'
        || row.error !== undefined && typeof row.error !== 'string'
        || !Array.isArray(row.relations) || row.relations.length > 100 || !Number.isSafeInteger(row.rejected) || row.rejected < 0
        || row.relations.some(relation => !relation || typeof relation.from !== 'string' || !relation.from || relation.from.length > 512
          || typeof relation.to !== 'string' || !relation.to || relation.to.length > 512
          || typeof relation.relation !== 'string' || !relation.relation.trim() || relation.relation.length > 80
          || typeof relation.quote !== 'string' || !relation.quote
          || !['asserted', 'negated', 'reported', 'uncertain'].includes(relation.qualifier)
          || !Number.isSafeInteger(relation.offset) || relation.offset < 0 || typeof relation.assigned !== 'boolean')) throw new Error('图谱证据缓存结构损坏，未使用该文件')
    }
    return { status: 'ready', fingerprint: typeof snapshot?.fingerprint === 'string' ? snapshot.fingerprint : undefined, extractions }
  } catch (error) { return { status: 'invalid', extractions: [], error: error instanceof Error ? error.message : '图谱缓存无法读取，已保留现场' } }
  finally { try { db?.close() } catch { /* no writes */ } }
}

/** Caller owns the short book lock and has revalidated source bytes and generation. */
export function saveGraphCache(root: string, graph: StoryGraph, extraction?: GraphExtraction): void {
  const filename = graphFile(root, CACHE_NAME), exists = fs.existsSync(filename)
  if (exists) {
    const header = cacheHeader(filename)
    if (header.subarray(0, 16).toString() !== 'SQLite format 3\0' || header.readUInt32BE(68) !== APPLICATION_ID
      || header[18] !== 1 || header[19] !== 1) throw new Error('图谱缓存不可写，原文件已保留')
    if (!extraction) {
      const current = readGraphCache(root, graph.bookId)
      if (current.status !== 'ready') throw new Error(current.error || '图谱缓存不可写')
    }
  }
  const db = database(root, false)
  try {
    if (!exists) db.exec(`BEGIN; CREATE TABLE identity(root TEXT NOT NULL,book_id TEXT NOT NULL);
      CREATE TABLE snapshot(id INTEGER PRIMARY KEY,fingerprint TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE extractions(evidence_id TEXT PRIMARY KEY,input_key TEXT NOT NULL,payload TEXT NOT NULL);
      PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1; COMMIT;`)
    if (!exists) db.prepare('INSERT INTO identity(root,book_id) VALUES (?,?)').run(canonicalizePath(root), graph.bookId)
    verify(db, root, graph.bookId)
    db.exec('BEGIN IMMEDIATE')
    try {
      // Sources are read from the book; the cache needs their identity, not another
      // 100 MB serialization of the entire graph on every extracted paragraph.
      db.prepare('INSERT INTO snapshot(id,fingerprint,payload) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint,payload=excluded.payload').run(graph.fingerprint ?? '', JSON.stringify({ records: graph.records.length, edges: graph.edges.length, evidence: graph.evidence?.length ?? 0 }))
      if (extraction) db.prepare('INSERT INTO extractions(evidence_id,input_key,payload) VALUES (?,?,?) ON CONFLICT(evidence_id) DO UPDATE SET input_key=excluded.input_key,payload=excluded.payload').run(extraction.evidenceId, extraction.key, JSON.stringify(extraction))
      if (!extraction) {
        const ids = new Set(graph.evidence?.map(item => item.id))
        for (const row of db.prepare('SELECT evidence_id FROM extractions').all()) if (!ids.has(String(row.evidence_id))) db.prepare('DELETE FROM extractions WHERE evidence_id=?').run(String(row.evidence_id))
      }
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  } finally { db.close() }
}
