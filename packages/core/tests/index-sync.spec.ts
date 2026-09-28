import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { changeIndexState, embeddingRevision, readIndexState, searchFinalized, syncFinalizedIndex, withBookLockAsync, withBookWrite, writeBatchAtomic, type EmbeddingProvider } from '../src'
import { SearchCache } from '../src/retrieval/cache'
import { removeSync } from '../src/repo/remove'
import { scanFinalized } from '../src/retrieval/source'
import { vectorBytes, normalizedVector } from '../src/retrieval/vectors'
import { retryDelayMs, DEFAULT_INDEX_RETRY } from '../src/retrieval/retry'

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-index-sync-')) })
afterEach(() => { removeSync(root) })
function chapter(number: number, body: string, title = `章${number}`) {
  const relative = `定稿/卷01/${String(number).padStart(4, '0')}-${title}.md`
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), `---\n版本: 1\n角色: 已定稿\n---\n${body}\n`)
  return relative
}
function provider(run: EmbeddingProvider['embed'] = async inputs => inputs.map(() => [1, 0]), batchSize = 1): EmbeddingProvider {
  return { metadata: { provider: 'fixture', model: 'fixture', dimensions: 2, revision: 'v1', batchSize }, embed: run, embedBatch: run }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('程序维护的向量索引', () => {
  it.each(['query', 'checkpoint'] as const)('真实 SQLite 隔离使旧批次代次失效，发现入口：%s', async discoveredBy => {
    chapter(1, '第一份'); chapter(2, '第二份')
    const entered = deferred<void>(), late = deferred<readonly (readonly number[])[]>()
    let calls = 0
    const client = provider(async () => { if (++calls === 2) { entered.resolve(); return late.promise }; return [[1, 0]] })
    await changeIndexState(root, state => ({ ...state, auto: true }))
    const pending = syncFinalizedIndex(root, { getProvider: () => client })
    await entered.promise
    const before = readIndexState(root)
    expect(before.completedChunks).toBe(1)
    fs.writeFileSync(path.join(root, '.webnovel/finalized-search.sqlite'), 'broken')
    if (discoveredBy === 'query') expect(await searchFinalized(root, { query: '第一份', provider: client }))
      .toMatchObject({ ok: true, mode: 'keyword', index: { phase: 'queued', ready: false, missing: 2 } })
    late.resolve([[1, 0]])
    expect(await pending).toMatchObject({ ok: false, failure: { code: 'cancelled' } })
    expect(readIndexState(root)).toMatchObject({ generation: before.generation + 1, phase: 'queued', completedChunks: 0, completedChapters: 0 })
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
    const db = new DatabaseSync(path.join(root, '.webnovel/finalized-search.sqlite'))
    try { expect(db.prepare('SELECT count(*) AS count FROM embeddings').get()?.['count']).toBe(0) } finally { db.close() }
    expect(await syncFinalizedIndex(root, { getProvider: () => client })).toMatchObject({ ok: true, state: { generated: 2, reused: 0 } })
  })

  it('外部删除缓存后重建也清除旧 ready，反复查询不反复增加代次', async () => {
    chapter(1, '原文')
    const client = provider()
    await syncFinalizedIndex(root, { getProvider: () => client })
    const before = readIndexState(root)
    fs.unlinkSync(path.join(root, '.webnovel/finalized-search.sqlite'))
    expect(await searchFinalized(root, { query: '原文', provider: client })).toMatchObject({ ok: true, index: { ready: false, phase: 'disabled' } })
    expect(readIndexState(root)).toMatchObject({ generation: before.generation + 1, completedChunks: 0, phase: 'disabled', auto: false })
    await searchFinalized(root, { query: '原文', provider: client })
    expect(readIndexState(root).generation).toBe(before.generation + 1)
  })

  it('查询向量等待期间缓存损坏，迟到查询不能继续宣称 ready', async () => {
    chapter(1, '原文')
    const entered = deferred<void>(), late = deferred<readonly (readonly number[])[]>()
    const client = provider(async (inputs, role) => {
      if (role === 'query') { entered.resolve(); return late.promise }
      return inputs.map(() => [1, 0])
    })
    await syncFinalizedIndex(root, { getProvider: () => client })
    const pending = searchFinalized(root, { query: '原文', provider: client })
    await entered.promise
    fs.writeFileSync(path.join(root, '.webnovel/finalized-search.sqlite'), 'broken')
    late.resolve([[1, 0]])
    expect(await pending).toMatchObject({ ok: false, code: 'index-changed' })
    expect(readIndexState(root)).toMatchObject({ phase: 'disabled', completedChunks: 0 })
  })

  it('只修复 FTS 内部召回仍保留向量和 ready 代次', async () => {
    chapter(1, '剑客带信归来')
    const client = provider()
    await syncFinalizedIndex(root, { getProvider: () => client })
    const before = readIndexState(root)
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
    await withBookLockAsync(root, async () => {
      const snapshot = await scanFinalized(root)
      const cache = await SearchCache.open(root)
      try {
        const db = new DatabaseSync(path.join(root, '.webnovel/finalized-search.sqlite'))
        try {
          const writable = db as typeof db & { enableDefensive?(enabled: boolean): void }
          writable.enableDefensive?.(false)
          db.exec("UPDATE terms SET body='无关内容'; UPDATE terms_content SET c1=(SELECT body FROM chunks WHERE id=c0)")
        } finally { db.close() }
        const ids = snapshot.documents.flatMap(doc => doc.chunks.map(chunk => chunk.id))
        expect(cache.keyword('剑客带信', new Set(ids)).map(hit => hit.id)).toEqual(ids)
        expect(cache.state).toBe('rebuilt')
        expect(cache.vectors(snapshot, embeddingRevision(client)!, 2).size).toBe(1)
      } finally { cache.close() }
    })
    expect(readIndexState(root)).toEqual(before)
  })

  it('查询不生成正文向量；后台就绪后查询只请求问句', async () => {
    chapter(1, '主角带信归来。')
    const embed = vi.fn<EmbeddingProvider['embed']>(async inputs => inputs.map(() => [1, 0]))
    const client = provider(embed)
    const cold = await searchFinalized(root, { query: '带信', provider: client })
    expect(cold).toMatchObject({ ok: true, mode: 'keyword', index: { ready: false, missing: 1 } })
    expect(embed).not.toHaveBeenCalled()
    expect(await syncFinalizedIndex(root, { getProvider: () => client })).toMatchObject({ ok: true, state: { phase: 'ready', generated: 1, completedChunks: 1 } })
    expect(await searchFinalized(root, { query: '带信', provider: client })).toMatchObject({ ok: true, mode: 'hybrid', index: { embedded: 0, reused: 1, ready: true } })
    expect(embed.mock.calls.map(call => call[1])).toEqual(['document', 'query'])
  })

  it('每批持久化，失败后的新调用只补未完成部分', async () => {
    for (let number = 1; number <= 3; number++) chapter(number, `正文${number}`)
    let calls = 0
    const failed = provider(async () => {
      if (++calls === 2) throw { code: 'http-error', httpStatus: 503 }
      return [[1, 0]]
    })
    expect(await syncFinalizedIndex(root, { getProvider: () => failed, retry: { maxRetries: 0 } })).toMatchObject({ ok: false, state: { phase: 'failed', completedChunks: 1, failed: 2 } })
    const requested: string[] = []
    const restored = provider(async inputs => { requested.push(...inputs.map(input => input.text)); return inputs.map(() => [1, 0]) })
    expect(await syncFinalizedIndex(root, { getProvider: () => restored })).toMatchObject({ ok: true, state: { generated: 2, reused: 1, completedChunks: 3 } })
    expect(requested).toEqual(['正文2', '正文3'])
  })

  it('相同输入去重，单章内容小改仍复用未变片段与其他章', async () => {
    const relative = chapter(1, Array.from({ length: 20 }, (_, index) => `${index}段${'山'.repeat(96)}`).join('\n\n') + '\n\n旧结尾')
    chapter(2, '完全不动的章节')
    const embed = vi.fn<EmbeddingProvider['embed']>(async inputs => inputs.map(() => [1, 0]))
    const client = provider(embed, 32)
    const first = await syncFinalizedIndex(root, { getProvider: () => client })
    expect(first.ok).toBe(true)
    fs.writeFileSync(path.join(root, relative), fs.readFileSync(path.join(root, relative), 'utf8').replace('旧结尾', '新结尾'))
    embed.mockClear()
    const next = await syncFinalizedIndex(root, { getProvider: () => client })
    expect(next.ok).toBe(true)
    if (!next.ok) return
    expect(next.state.generated).toBeLessThan(next.state.chunks)
    expect(next.state.reused).toBeGreaterThan(1)
    expect(embed.mock.calls.flatMap(call => call[0]).every(input => input.title !== '章2')).toBe(true)
    const content = fs.readFileSync(path.join(root, relative), 'utf8')
    fs.writeFileSync(path.join(root, relative), content.replace('版本: 1', '版本: 2'))
    embed.mockClear()
    expect(await syncFinalizedIndex(root, { getProvider: () => client })).toMatchObject({ ok: true, state: { generated: 0 } })
    expect(embed).not.toHaveBeenCalled()
  })

  it('同正文同标题在不同章节只请求一次，来源仍分别定位', async () => {
    chapter(1, '相同原文', '相同标题'); chapter(2, '相同原文', '相同标题')
    const embed = vi.fn<EmbeddingProvider['embed']>(async inputs => inputs.map(() => [1, 0]))
    const client = provider(embed)
    expect(await syncFinalizedIndex(root, { getProvider: () => client })).toMatchObject({ ok: true, state: { chunks: 2, completedChunks: 2 } })
    expect(embed).toHaveBeenCalledTimes(1)
    const result = await searchFinalized(root, { query: '相同原文', provider: client })
    expect(result.ok && result.hits.map(hit => hit.chapter)).toEqual([1, 2])
  })

  it('取消保留已提交批次，并在未配合的 API 返回前释放任务租约', async () => {
    chapter(1, '第一份'); chapter(2, '第二份')
    const entered = deferred<void>(), late = deferred<readonly (readonly number[])[]>()
    let calls = 0
    const client = provider(async () => { if (++calls === 2) { entered.resolve(); return late.promise }; return [[1, 0]] })
    const controller = new AbortController()
    const pending = syncFinalizedIndex(root, { getProvider: () => client, signal: controller.signal })
    await entered.promise
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, failure: { code: 'cancelled' }, state: { completedChunks: 1 } })
    late.resolve([[1, 0]])
    expect(fs.existsSync(path.join(root, '.webnovel/finalized-search.worker.lock'))).toBe(false)
    const next = provider()
    expect(await syncFinalizedIndex(root, { getProvider: () => next })).toMatchObject({ ok: true, state: { generated: 1, reused: 1 } })
  })

  it('API 等待不占书仓锁，源变更拒绝迟到批次', async () => {
    const relative = chapter(1, '旧正文')
    const entered = deferred<void>(), late = deferred<readonly (readonly number[])[]>()
    const client = provider(async () => { entered.resolve(); return late.promise })
    const pending = syncFinalizedIndex(root, { getProvider: () => client })
    await entered.promise
    expect(fs.existsSync(path.join(root, '.webnovel/book.lock'))).toBe(false)
    withBookWrite(root, () => writeBatchAtomic(root, [{ relPath: relative, content: '新正文' }]))
    late.resolve([[1, 0]])
    expect(await pending).toMatchObject({ ok: false, failure: { code: 'source-changed' }, state: { phase: 'queued', completedChunks: 0 } })
    expect((await searchFinalized(root, { query: '旧正文' }))).toMatchObject({ ok: true, hits: [] })
  })

  it('提供方换实例不发布旧向量，同书不会启动第二个工作者', async () => {
    chapter(1, '原文')
    const entered = deferred<void>(), late = deferred<readonly (readonly number[])[]>()
    let current = provider(async () => { entered.resolve(); return late.promise })
    const pending = syncFinalizedIndex(root, { getProvider: () => current })
    await entered.promise
    expect(await syncFinalizedIndex(root, { getProvider: () => current })).toMatchObject({ ok: false, failure: { code: 'index-busy' } })
    current = provider()
    late.resolve([[1, 0]])
    expect(await pending).toMatchObject({ ok: false, failure: { code: 'provider-changed' } })
    expect(await syncFinalizedIndex(root, { getProvider: () => current })).toMatchObject({ ok: true, state: { generated: 1 } })
  })

  it('指数退避、Retry-After 和预算由一层控制，瞬时错误不生成最终通知', async () => {
    chapter(1, '重试原文')
    let now = 1000, calls = 0
    const sleeps: number[] = []
    const client = provider(async () => {
      if (++calls === 1) throw { code: 'http-error', httpStatus: 429, retryAfterMs: 7000 }
      if (calls === 2) throw { code: 'http-error', httpStatus: 503 }
      return [[1, 0]]
    })
    const result = await syncFinalizedIndex(root, { getProvider: () => client,
      clock: { now: () => now, random: () => 1, sleep: async ms => { sleeps.push(ms); now += ms } } })
    expect(result).toMatchObject({ ok: true, state: { phase: 'ready', completedChunks: 1 } })
    expect(sleeps).toEqual([7000, 4000])
    expect(calls).toBe(3)
    expect(readIndexState(root).errors).toHaveLength(2)
    expect(readIndexState(root).notice).toBeUndefined()
    expect(retryDelayMs(9, DEFAULT_INDEX_RETRY, 120_000, () => 1)).toBe(120_000)
  })

  it('鉴权与格式错误不重试，安全原因和通知绑定原会话', async () => {
    chapter(1, '私有原文')
    await changeIndexState(root, state => ({ ...state, recipientSession: 'owner-session' }))
    const embed = vi.fn(async () => { throw { code: 'http-error', httpStatus: 401, message: 'SECRET key and prompt' } })
    const client = provider(embed)
    const sleep = vi.fn(async () => {})
    const result = await syncFinalizedIndex(root, { getProvider: () => client, clock: { now: Date.now, random: () => 1, sleep } })
    expect(result).toMatchObject({ ok: false, failure: { httpStatus: 401, retryable: false }, state: { notice: { sessionId: 'owner-session' } } })
    expect(embed).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })

  it('损坏缓存重建保留自动更新与通知设置', async () => {
    chapter(1, '原文')
    await changeIndexState(root, state => ({ ...state, auto: true, recipientSession: 'owner-session' }))
    const client = provider()
    await syncFinalizedIndex(root, { getProvider: () => client })
    fs.writeFileSync(path.join(root, '.webnovel/finalized-search.sqlite'), 'broken')
    expect(await syncFinalizedIndex(root, { getProvider: () => client })).toMatchObject({ ok: true, state: { auto: true, recipientSession: 'owner-session', generated: 1 } })
  })

  it('v1 缓存只迁移能与当前来源、模型对应的向量', async () => {
    chapter(1, '已有向量')
    const client = provider(vi.fn(async () => { throw new Error('should not call API') }))
    const snapshot = await scanFinalized(root)
    const chunk = snapshot.documents[0]!.chunks[0]!
    fs.mkdirSync(path.join(root, '.webnovel'), { recursive: true })
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
    const db = new DatabaseSync(path.join(root, '.webnovel/finalized-search.sqlite'))
    try {
      db.exec("CREATE TABLE chunks(id TEXT PRIMARY KEY,body TEXT,vector BLOB,revision TEXT,dimensions INTEGER); CREATE VIRTUAL TABLE terms USING fts5(id UNINDEXED,body,tokenize='trigram case_sensitive 1'); CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT); PRAGMA user_version=1;")
      db.exec('PRAGMA application_id=' + 0x57565336)
      db.prepare('INSERT INTO chunks VALUES (?,?,?,?,?)').run(chunk.id, chunk.text, vectorBytes(normalizedVector([1, 0])), embeddingRevision(client)!, 2)
      db.prepare('INSERT INTO terms(id,body) VALUES (?,?)').run(chunk.id, chunk.text)
    } finally { db.close() }
    expect(await syncFinalizedIndex(root, { getProvider: () => client })).toMatchObject({ ok: true, state: { generated: 0, reused: 1 } })
    expect(client.embedBatch).not.toHaveBeenCalled()
  })

  it('实际进程中断后回收死亡租约，重启只补未落库批次', async () => {
    chapter(1, '已保存批次'); chapter(2, '尚未保存批次')
    const loader = pathToFileURL(path.resolve(__dirname, '../../../scripts/strip-types-loader.mjs')).href
    const module = pathToFileURL(path.resolve(__dirname, '../src/retrieval/sync.ts')).href
    const script = `import { register } from 'node:module'; register(${JSON.stringify(loader)});
      const { syncFinalizedIndex } = await import(${JSON.stringify(module)});
      let calls = 0;
      // Announce from inside the hanging second request: batch one is committed and no book
      // lock or acquire guard is held, so killing here orphans only the worker lease.
      const embed = async () => { if (++calls > 1) { process.stdout.write('CHECKPOINT\\n'); return new Promise(() => { setInterval(() => {}, 1000) }) } return [[1,0]] };
      const provider = { metadata: { provider:'fixture', model:'fixture', dimensions:2, revision:'v1', batchSize:1 }, embed, embedBatch:embed };
      await syncFinalizedIndex(${JSON.stringify(root)}, { getProvider: () => provider });`
    const child = spawn(process.execPath, ['--experimental-transform-types', '--input-type=module', '-e', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('child checkpoint timeout')), 10_000)
        child.stdout.on('data', data => { if (String(data).includes('CHECKPOINT')) { clearTimeout(timer); resolve() } })
        child.once('error', reject)
      })
      child.kill()
      await exited
      expect(readIndexState(root).completedChunks).toBe(1)
      const requested: string[] = []
      const restored = provider(async inputs => { requested.push(...inputs.map(input => input.text)); return inputs.map(() => [1, 0]) })
      expect(await syncFinalizedIndex(root, { getProvider: () => restored })).toMatchObject({ ok: true, state: { generated: 1, reused: 1 } })
      expect(requested).toEqual(['尚未保存批次'])
    } finally { if (child.exitCode === null) child.kill(); await exited }
  }, 15_000)
})
