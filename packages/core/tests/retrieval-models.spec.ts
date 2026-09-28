import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { changeIndexState, forgetSceneBoundaries, readIndexState, searchFinalized, syncFinalizedIndex, withBookWrite, type EmbeddingProvider, type RerankingProvider, type SceneProvider } from '../src'
import { scanFinalized } from '../src/retrieval/source'
import { readSceneRecords, SCENE_CACHE_PATH, validateSceneEnds } from '../src/retrieval/scenes'
import { removeSync } from '../src/repo/remove'

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-retrieval-models-')) })
afterEach(() => { removeSync(root) })
function chapter(n: number, body = '甲说：救人。\n\n乙跳进河中。\n\n另一边，城门关闭。') {
  const file = path.join(root, '定稿', '卷01', String(n).padStart(4, '0') + '-章' + n + '.md')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '---\n版本: 1\n角色: 已定稿\n---\n' + body)
  return file
}
const embedding = (model = 'fixture'): EmbeddingProvider => {
  const run: EmbeddingProvider['embed'] = async inputs => inputs.map(() => [1, 0])
  return { metadata: { provider: 'test', model, revision: model, dimensions: 2 }, embed: run, embedBatch: run }
}
const scenes = (segment: SceneProvider['segment'] = async paragraphs => [paragraphs.length], concurrency = 1): SceneProvider => ({
  metadata: { provider: 'test', model: 'scene', revision: 'v1', concurrency }, segment,
})
const ranker = (rerank: RerankingProvider['rerank']): RerankingProvider => ({ metadata: { provider: 'test', model: 'rank', revision: 'v1', candidates: 40 }, rerank })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function deadlineClock() {
  const deadlines: Array<{ milliseconds: number; controller: AbortController }> = []
  const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
    const controller = new AbortController()
    deadlines.push({ milliseconds, controller })
    return controller.signal
  })
  return { advanceTo: (milliseconds: number) => {
    for (const deadline of deadlines) if (deadline.milliseconds <= milliseconds) deadline.controller.abort()
  }, restore: () => spy.mockRestore() }
}

describe('场景边界与独立缓存', () => {
  it('缓存恢复与场景模型更换共同拒绝迟到边界，换维度后只复用已经验证的场景', async () => {
    chapter(1)
    const client = embedding()
    await syncFinalizedIndex(root, { getProvider: () => client })
    const entered = deferred<void>(), late = deferred<readonly number[]>()
    let sceneClient = scenes(async () => { entered.resolve(); return late.promise })
    const pending = syncFinalizedIndex(root, { getProvider: () => client, getSceneProvider: () => sceneClient })
    await entered.promise
    const before = readIndexState(root)
    fs.writeFileSync(path.join(root, '.webnovel/finalized-search.sqlite'), 'broken')
    expect(await searchFinalized(root, { query: '救人', provider: client })).toMatchObject({ ok: true, index: { ready: false } })
    expect(readIndexState(root)).toMatchObject({ generation: before.generation + 1, completedChunks: 0, phase: 'disabled' })
    sceneClient = scenes()
    late.resolve([3])
    expect(await pending).toMatchObject({ ok: false, failure: { code: 'cancelled' } })
    expect(Object.keys(readSceneRecords(root))).toHaveLength(0)
    const segment = vi.fn<SceneProvider['segment']>(async paragraphs => [paragraphs.length])
    sceneClient = scenes(segment)
    const newEmbed = vi.fn<EmbeddingProvider['embed']>(async inputs => inputs.map(() => [1, 0, 0]))
    const newClient: EmbeddingProvider = { metadata: { ...client.metadata, dimensions: 3, revision: 'new-dimensions' }, embed: newEmbed, embedBatch: newEmbed }
    expect(await syncFinalizedIndex(root, { getProvider: () => newClient, getSceneProvider: () => sceneClient })).toMatchObject({ ok: true, state: { provider: { dimensions: 3 }, generated: 1 } })
    const boundaries = fs.readFileSync(path.join(root, SCENE_CACHE_PATH))
    fs.writeFileSync(path.join(root, '.webnovel/finalized-search.sqlite'), 'broken again')
    await searchFinalized(root, { query: '救人', provider: newClient })
    sceneClient = { ...sceneClient, metadata: { ...sceneClient.metadata, revision: 'new-scene-model' } }
    expect(await syncFinalizedIndex(root, { getProvider: () => newClient, getSceneProvider: () => sceneClient })).toMatchObject({ ok: true, state: { generated: 1 } })
    expect(segment).toHaveBeenCalledTimes(1)
    expect(fs.readFileSync(path.join(root, SCENE_CACHE_PATH))).toEqual(boundaries)
    expect(newEmbed.mock.calls.map(call => call[1])).toEqual(['document', 'document'])
  })
  it('并发识别通过串行短锁保存，不把同任务的进度写入误判为外部锁竞争', async () => {
    chapter(1); chapter(2, '另一章。\n\n另一段。'); chapter(3, '第三章独立正文。')
    const client = embedding(), sceneClient = scenes(async paragraphs => [paragraphs.length], 2)
    expect(await syncFinalizedIndex(root, { getProvider: () => client, getSceneProvider: () => sceneClient })).toMatchObject({
      ok: true, state: { phase: 'ready', scenes: { completed: 3, generated: 3, fallback: 0 } },
    })
    expect(Object.keys(readSceneRecords(root))).toHaveLength(3)
  })
  it.each([[], [1], [2, 2, 3], [3, 2], [0, 3], [1, 4], [1, NaN, 3], new Array(3)])('拒绝遗漏、重叠、越界与稀疏边界 %j', ends => {
    expect(() => validateSceneEnds(ends, 3)).toThrow()
  })

  it('按场景截取原文，长场景分块不跨场景，查询不请求场景模型', async () => {
    const body = Array.from({ length: 16 }, (_, i) => '段' + i + '山'.repeat(99)).join('\n\n')
    chapter(1, body)
    const segment = vi.fn<SceneProvider['segment']>(async () => [8, 16])
    const client = embedding()
    const scenesClient = scenes(segment)
    expect(await syncFinalizedIndex(root, { getProvider: () => client, getSceneProvider: () => scenesClient })).toMatchObject({ ok: true })
    const snapshot = await scanFinalized(root)
    const chunks = snapshot.documents[0]!.chunks
    expect(chunks.length).toBeGreaterThan(2)
    expect(new Set(chunks.map(chunk => chunk.scene?.id)).size).toBe(2)
    for (const chunk of chunks) {
      expect(chunk.text).toBe(body.slice(chunk.start, chunk.end))
      expect(chunk.startLine).toBeGreaterThanOrEqual(chunk.scene!.startLine)
      expect(chunk.endLine).toBeLessThanOrEqual(chunk.scene!.endLine)
    }
    const result = await searchFinalized(root, { query: '段8', provider: client })
    expect(result.ok && result.hits[0]?.scene).toBeDefined()
    expect(segment).toHaveBeenCalledTimes(1)
  })

  it('重启、改名、元数据、更换模型和向量重建复用场景，正文改动仅识别该章', async () => {
    const file = chapter(1)
    chapter(2, '别章。\n\n另一幕。')
    const segment = vi.fn<SceneProvider['segment']>(async p => [p.length])
    let client = embedding()
    let sceneClient = scenes(segment)
    const run = () => syncFinalizedIndex(root, { getProvider: () => client, getSceneProvider: () => sceneClient })
    expect((await run()).ok).toBe(true)
    expect(segment).toHaveBeenCalledTimes(2)
    fs.renameSync(file, path.join(path.dirname(file), '0001-改名.md'))
    const renamed = path.join(path.dirname(file), '0001-改名.md')
    fs.writeFileSync(renamed, fs.readFileSync(renamed, 'utf8').replace('版本: 1', '版本: 2'))
    client = embedding('new-embedding')
    sceneClient = { ...scenes(segment), metadata: { provider: 'another', model: 'new-scene-model', revision: 'v2' } }
    await changeIndexState(root, state => ({ ...state, rebuild: true }))
    expect((await run()).ok).toBe(true)
    expect(segment).toHaveBeenCalledTimes(2)
    fs.appendFileSync(renamed, '\n\n新增场景。')
    expect((await run()).ok).toBe(true)
    expect(segment).toHaveBeenCalledTimes(3)
    expect(fs.readFileSync(path.join(root, SCENE_CACHE_PATH), 'utf8')).not.toContain('新增场景')
  })

  it('取消保留成功章，未配合取消的模型不会发布迟到边界', async () => {
    chapter(1); chapter(2, '第二章。\n\n对话。')
    const entered = deferred<void>(), late = deferred<readonly number[]>()
    let calls = 0
    const abort = new AbortController()
    const client = embedding()
    const sceneClient = scenes(async p => { if (++calls === 2) { entered.resolve(); return late.promise }; return [p.length] })
    const running = syncFinalizedIndex(root, { getProvider: () => client, getSceneProvider: () => sceneClient, signal: abort.signal })
    await entered.promise
    abort.abort()
    expect(await running).toMatchObject({ ok: false, failure: { code: 'cancelled' } })
    expect(Object.keys(readSceneRecords(root))).toHaveLength(1)
    late.resolve([99])
    const resumed = vi.fn<SceneProvider['segment']>(async p => [p.length])
    const next = scenes(resumed)
    expect(await syncFinalizedIndex(root, { getProvider: () => client, getSceneProvider: () => next })).toMatchObject({ ok: true })
    expect(resumed).toHaveBeenCalledTimes(1)
    expect(Object.keys(readSceneRecords(root))).toHaveLength(2)
  })

  it('无效边界明确回退，普通更新不反复调用；显式重新识别仅清理指定章', async () => {
    chapter(1); chapter(2, '其他章。\n\n第二段。')
    const client = embedding()
    const invalid = vi.fn<SceneProvider['segment']>(async () => [999])
    const bad = scenes(invalid)
    expect(await syncFinalizedIndex(root, { getProvider: () => client, getSceneProvider: () => bad })).toMatchObject({ ok: true, state: { scenes: { fallback: 2 } } })
    expect((await syncFinalizedIndex(root, { getProvider: () => client, getSceneProvider: () => bad })).ok).toBe(true)
    expect(invalid).toHaveBeenCalledTimes(2)
    await forgetSceneBoundaries(root, 1)
    await changeIndexState(root, state => ({ ...state, paused: false }))
    const valid = vi.fn<SceneProvider['segment']>(async p => [p.length])
    const restored = scenes(valid)
    expect((await syncFinalizedIndex(root, { getProvider: () => client, getSceneProvider: () => restored })).ok).toBe(true)
    expect(valid).toHaveBeenCalledTimes(1)
    expect((await scanFinalized(root)).documents.map(doc => doc.sceneStatus)).toEqual(['ready', 'fallback'])
  })

  it('识别期间允许保存，源变化后不写入旧边界', async () => {
    const file = chapter(1)
    const entered = deferred<void>(), response = deferred<readonly number[]>()
    const client = embedding(), sceneClient = scenes(async () => { entered.resolve(); return response.promise })
    const run = syncFinalizedIndex(root, { getProvider: () => client, getSceneProvider: () => sceneClient })
    await entered.promise
    withBookWrite(root, () => fs.appendFileSync(file, '\n\n作者新写一段。'))
    response.resolve([3])
    expect(await run).toMatchObject({ ok: false, failure: { code: 'source-changed' } })
    expect(Object.keys(readSceneRecords(root))).toHaveLength(0)
  })

  it('损坏场景缓存被保留，不隐式清空后产生全书 LLM 请求', async () => {
    chapter(1)
    const client = embedding()
    await syncFinalizedIndex(root, { getProvider: () => client })
    const file = path.join(root, SCENE_CACHE_PATH)
    fs.writeFileSync(file, '{broken')
    const segment = vi.fn<SceneProvider['segment']>()
    const sceneClient = scenes(segment)
    expect(await syncFinalizedIndex(root, { getProvider: () => client, getSceneProvider: () => sceneClient })).toMatchObject({ ok: false, failure: { code: 'scene-cache-error' } })
    expect(segment).not.toHaveBeenCalled()
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken')
  })
})

describe('查询阶段的可选重排序', () => {
  it('重排等待期间另一查询重建缓存，迟到排序不能发布旧代次', async () => {
    chapter(1); chapter(2, '城门关闭。')
    const client = embedding()
    await syncFinalizedIndex(root, { getProvider: () => client })
    const entered = deferred<void>(), late = deferred<readonly number[]>()
    const reranker = ranker(async () => { entered.resolve(); return late.promise })
    const pending = searchFinalized(root, { query: '城门', provider: client, getReranker: () => reranker })
    await entered.promise
    fs.writeFileSync(path.join(root, '.webnovel/finalized-search.sqlite'), 'broken')
    await searchFinalized(root, { query: '城门', provider: client, mode: 'keyword' })
    late.resolve([0, 1])
    expect(await pending).toMatchObject({ ok: false, code: 'index-changed' })
    expect(readIndexState(root)).toMatchObject({ completedChunks: 0, phase: 'disabled' })
  })
  async function ready() {
    chapter(1, '测试：城门的争吵。'); chapter(2, '测试：河边救人的经过。')
    const client = embedding()
    expect((await syncFinalizedIndex(root, { getProvider: () => client })).ok).toBe(true)
    return client
  }
  it('遵循提供方的自定义等待时间，不在旧 15 秒处提前回退', async () => {
    const client = await ready()
    const clock = deadlineClock()
    const entered = deferred<void>(), reply = deferred<readonly number[]>()
    let requestSignal: AbortSignal | undefined
    const ranking: RerankingProvider = {
      metadata: { provider: 'test', model: 'rank', revision: 'v1', candidates: 40, timeoutMs: 45_000 },
      rerank: async (_query, _inputs, signal) => { requestSignal = signal; entered.resolve(); return reply.promise },
    }
    try {
      const running = searchFinalized(root, { query: '测试', limit: 1, provider: client, getReranker: () => ranking })
      await entered.promise
      clock.advanceTo(20_000)
      expect(requestSignal?.aborted).toBe(false)
      reply.resolve([0, 1])
      expect(await running).toMatchObject({ ok: true, reranking: { applied: true }, hits: [{ chapter: 2 }] })
    } finally { reply.resolve([0, 1]); clock.restore() }
  })
  it('达到自定义预算后仍能回退，即使提供方不配合取消', async () => {
    const client = await ready()
    const clock = deadlineClock()
    const entered = deferred<void>(), late = deferred<readonly number[]>()
    const ranking: RerankingProvider = { metadata: { provider: 'test', model: 'rank', revision: 'v1', timeoutMs: 45_000 },
      rerank: async () => { entered.resolve(); return late.promise } }
    try {
      const running = searchFinalized(root, { query: '测试', limit: 1, provider: client, getReranker: () => ranking })
      await entered.promise
      clock.advanceTo(45_000)
      expect(await running).toMatchObject({ ok: true, reranking: { applied: false, reason: '重排等待超过 45 秒，本次使用原排序' }, hits: [{ chapter: 1 }] })
    } finally { late.resolve([0, 1]); clock.restore() }
  })
  it.each([undefined, 0, NaN, Infinity, 120_001, 1.5])('旧提供方或非法超时声明 %s 使用 30 秒有界默认', async timeoutMs => {
    const client = await ready()
    const clock = deadlineClock()
    const entered = deferred<void>(), late = deferred<readonly number[]>()
    let requestSignal: AbortSignal | undefined
    const ranking: RerankingProvider = { metadata: { provider: 'test', model: 'rank', revision: 'v1', timeoutMs },
      rerank: async (_query, _inputs, signal) => { requestSignal = signal; entered.resolve(); return late.promise } }
    try {
      const running = searchFinalized(root, { query: '测试', provider: client, getReranker: () => ranking })
      await entered.promise
      clock.advanceTo(20_000)
      expect(requestSignal?.aborted).toBe(false)
      clock.advanceTo(30_000)
      expect(await running).toMatchObject({ ok: true, reranking: { applied: false, reason: '重排等待超过 30 秒，本次使用原排序' } })
    } finally { late.resolve([0, 1]); clock.restore() }
  })
  it('等待中超时声明发生变化时不发布旧结果', async () => {
    const client = await ready()
    const entered = deferred<void>(), reply = deferred<readonly number[]>()
    const metadata = { provider: 'test', model: 'rank', revision: 'v1', timeoutMs: 45_000 }
    const ranking: RerankingProvider = { metadata, rerank: async () => { entered.resolve(); return reply.promise } }
    const running = searchFinalized(root, { query: '测试', provider: client, getReranker: () => ranking })
    await entered.promise
    metadata.timeoutMs = 60_000
    reply.resolve([0, 1])
    expect(await running).toMatchObject({ ok: false, code: 'provider-changed' })
  })
  it('从最终 limit 之外重排候选，并保留原文定位', async () => {
    const client = await ready()
    const rerank = vi.fn<RerankingProvider['rerank']>(async (_q, inputs) => inputs.map(input => input.text.includes('救人') ? 1 : 0))
    const ranking = ranker(rerank)
    const result = await searchFinalized(root, { query: '测试', limit: 1, provider: client, getReranker: () => ranking })
    expect(result).toMatchObject({ ok: true, reranking: { applied: true, candidates: 2 }, hits: [{ chapter: 2 }] })
    expect(rerank.mock.calls[0]![1]).toHaveLength(2)
    if (result.ok) expect(fs.readFileSync(result.hits[0]!.absolutePath, 'utf8')).toContain(result.hits[0]!.snippet)
  })
  it.each([[], [1, NaN], new Array(2)])('无效评分降级到原排序 %j', scores => {
    return (async () => {
      const client = await ready()
      const ranking = ranker(async () => scores)
      expect(await searchFinalized(root, { query: '测试', limit: 1, provider: client, getReranker: () => ranking })).toMatchObject({ ok: true, reranking: { applied: false }, hits: [{ chapter: 1 }] })
    })()
  })
  it('明确关键词模式和重排关闭时不额外调用模型', async () => {
    const client = await ready()
    const embed = vi.spyOn(client, 'embed')
    const rerank = vi.fn<RerankingProvider['rerank']>(async () => [0, 1])
    const ranking = ranker(rerank)
    expect(await searchFinalized(root, { query: '测试', mode: 'keyword', provider: client, getReranker: () => ranking })).toMatchObject({ ok: true, mode: 'keyword' })
    expect(embed).not.toHaveBeenCalled()
    expect(rerank).not.toHaveBeenCalled()
    await searchFinalized(root, { query: '测试', provider: client, rerank: false, getReranker: () => ranking })
    expect(rerank).not.toHaveBeenCalled()
  })
  it('重排网络等待不持写锁，源变化后拒收结果', async () => {
    const client = await ready()
    const entered = deferred<void>(), reply = deferred<readonly number[]>()
    const ranking = ranker(async () => { entered.resolve(); return reply.promise })
    const result = searchFinalized(root, { query: '测试', provider: client, getReranker: () => ranking })
    await entered.promise
    withBookWrite(root, () => fs.appendFileSync(path.join(root, '定稿/卷01/0001-章1.md'), '作者改动'))
    reply.resolve([0, 1])
    expect(await result).toMatchObject({ ok: false, code: 'source-changed' })
  })
  it('配置变化和取消均不会发布迟到重排', async () => {
    const client = await ready()
    const entered = deferred<void>(), reply = deferred<readonly number[]>()
    let ranking = ranker(async () => { entered.resolve(); return reply.promise })
    const result = searchFinalized(root, { query: '测试', provider: client, getReranker: () => ranking })
    await entered.promise
    ranking = ranker(async () => [1, 0])
    reply.resolve([0, 1])
    expect(await result).toMatchObject({ ok: false, code: 'provider-changed' })
    const abort = new AbortController(), waiting = deferred<void>(), late = deferred<readonly number[]>()
    ranking = ranker(async () => { waiting.resolve(); return late.promise })
    const cancelled = searchFinalized(root, { query: '测试', provider: client, getReranker: () => ranking, signal: abort.signal })
    await waiting.promise
    abort.abort()
    expect(await cancelled).toMatchObject({ ok: false, code: 'cancelled' })
    late.resolve([0, 1])
  })
})
