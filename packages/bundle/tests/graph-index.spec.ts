import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { serializeDocument, type GraphModelInput, type GraphModelProvider } from '@webnovel/core'
import { removeSync } from '../../core/src/repo/remove'
import { StudyService } from '../src/study/service'
import { GraphIndexManager } from '../src/indexing/graph-manager'
import { readGraphState, readGraphCache } from '../src/indexing/graph-storage'
import { extractionInput, validateExtraction } from '../src/study/graph-extraction'

let root: string, book: string, manager: GraphIndexManager, provider: GraphModelProvider | undefined
let calls: GraphModelInput[]
const put = (relative: string, body: string) => { const target = path.join(book, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, body) }
const ref = () => new StudyService(root).indexBook('book:graph-index')
const graph = () => new StudyService(root).graph('book:graph-index')
const state = () => readGraphState(book, 'graph-index')
const factPath = '世界书/人物档案/甲.md'
function sampleProvider(revision = 'one'): GraphModelProvider {
  return { metadata: { provider: 'fixture', model: 'fixture', revision, timeoutMs: 1000 },
    inputChars: input => JSON.stringify(input).length,
    extract: async input => {
      calls.push(input)
      return { data: { relations: [{ from: '甲', to: '乙', relation: '救助', qualifier: 'asserted', quote: input.text }] }, usage: { inputTokens: 20, outputTokens: 10 } }
    }, close: async () => {} }
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-index-')); book = path.join(root, '测试书')
  put('作品契约/契约.md', serializeDocument({ 书id: 'graph-index', 书仓格式版本: 1 }, '测试书'))
  put(factPath, serializeDocument({ 名称: '甲', 类型: '人物', 性质: '计划' }, '未来计划。\n### 事实@第0001章\n甲救助了乙。'))
  put('世界书/人物档案/乙.md', serializeDocument({ 名称: '乙', 类型: '人物', 性质: '计划' }, '计划。\n### 事实@第0001章\n'))
  calls = []; provider = sampleProvider(); manager = new GraphIndexManager(() => provider)
})
afterEach(async () => { await manager.close(); removeSync(root) })
const enable = async () => manager.control(ref(), 'enable', manager.preview(ref(), 'enable').token)
const ready = () => vi.waitFor(() => expect(state().phase).toBe('ready'), { timeout: 5000, interval: 20 })

describe('独立图谱缓存与模型任务', () => {
  it('未启用时读取/预览/刷新均零模型调用、零运行目录，明确构建不需模型', async () => {
    provider = undefined
    const first = graph(); manager.track(ref()); await manager.refresh()
    const preview = manager.preview(ref(), 'build')
    expect(first.index?.cache).toBe('missing'); expect(preview.provider).toBeUndefined()
    expect(calls).toHaveLength(0); expect(fs.existsSync(path.join(book, '.webnovel'))).toBe(false)
    await manager.control(ref(), 'build', preview.token)
    expect(state().enabled).toBe(false); expect(graph().index?.cache).toBe('ready')
    expect(calls).toHaveLength(0)
  })
  it('手动启用后逐条发布，重开/刷新复用；新增事实只抽新增输入', async () => {
    await enable(); await ready()
    expect(calls).toHaveLength(1)
    expect(graph().edges.filter(edge => edge.evidenceKind === 'extracted')).toHaveLength(1)
    expect(calls[0]!.text).not.toContain('未来计划')
    const used = state().calls
    await manager.refresh(); graph(); graph(); expect(calls).toHaveLength(1)
    fs.appendFileSync(path.join(book, factPath), '\n### 事实@第0002章\n甲再次救助了乙。\n')
    expect(graph().edges.filter(edge => edge.evidenceKind === 'extracted')).toHaveLength(0)
    await manager.refresh(); await ready()
    expect(calls).toHaveLength(2)
    expect(state().calls).toBe(used + 1)
    expect(graph().edges.filter(edge => edge.evidenceKind === 'extracted')).toHaveLength(2)
    expect(fs.existsSync(path.join(book, '.webnovel/finalized-search.sqlite'))).toBe(false)
  })
  it('累计调用和用量仅统计，不阻止后续增量', async () => {
    await enable(); await ready()
    const filename = path.join(book, '.webnovel/story-graph-state.json')
    fs.writeFileSync(filename, JSON.stringify({ ...state(), calls: 2000, inputTokens: 20000000 }))
    fs.appendFileSync(path.join(book, factPath), '\n### 事实@第0002章\n甲仍在帮助乙。\n')
    await manager.refresh()
    await ready(); expect(calls).toHaveLength(2)
    expect(state()).toMatchObject({ calls: 2001, inputTokens: 20000020, outputTokens: 20 })
    expect(JSON.parse(fs.readFileSync(filename, 'utf8'))).not.toHaveProperty('budget')
  })
  it('超时保留已完成结果，暂停与失败刷新不再发请求', async () => {
    fs.appendFileSync(path.join(book, factPath), '\n### 事实@第0002章\n甲仍在帮助乙。\n')
    const original = sampleProvider()
    provider = { ...original, metadata: { ...original.metadata, timeoutMs: 100 }, extract: async input => {
      if (input.text.includes('仍在')) { calls.push(input); return new Promise(() => {}) }
      return original.extract(input)
    } }
    await enable()
    await vi.waitFor(() => expect(state().phase).toBe('failed'))
    expect(readGraphCache(book, 'graph-index').extractions.filter(row => !row.error)).toHaveLength(1)
    expect(calls).toHaveLength(2)
    await manager.refresh(); expect(calls).toHaveLength(2)
  })
  it('实体上下文只发送相关名字，保留所有同名候选；无关新人物不重抽旧事实', async () => {
    put('世界书/人物档案/旁人.md', serializeDocument({ 名称: '旁人', 类型: '人物', 性质: '计划' }, '计划'))
    const source = new StudyService(root).graphSource('book:graph-index'), evidence = source.evidence!.find(item => item.eligible)!
    expect(extractionInput(source, evidence).entities.map(item => item.label).sort()).toEqual(['甲', '乙'].sort())
    await enable(); await ready(); expect(calls).toHaveLength(1)
    put('世界书/人物档案/新旁人.md', serializeDocument({ 名称: '新旁人', 类型: '人物', 性质: '计划' }, '计划'))
    await manager.refresh(); await ready(); expect(calls).toHaveLength(1)
    expect(graph().edges.filter(item => item.evidenceKind === 'extracted')).toHaveLength(1)
    put('世界书/人物档案/乙同名.md', serializeDocument({ 名称: '乙', 类型: '人物', 性质: '计划' }, '计划'))
    const ambiguous = new StudyService(root).graphSource('book:graph-index')
    expect(extractionInput(ambiguous, ambiguous.evidence!.find(item => item.eligible)!).entities.filter(item => item.label === '乙')).toHaveLength(2)
    await manager.refresh(); await ready(); expect(calls).toHaveLength(2)
    expect(graph().edges.filter(item => item.evidenceKind === 'extracted')).toHaveLength(0)
  })
  it('暂停可取消不配合响应，迟到结果不得发布；恢复保留调用记录', async () => {
    let finish!: (value: Awaited<ReturnType<GraphModelProvider['extract']>>) => void
    const hang = new Promise<Awaited<ReturnType<GraphModelProvider['extract']>>>(resolve => { finish = resolve })
    provider = { ...sampleProvider(), extract: input => { calls.push(input); return hang } }
    await enable(); await vi.waitFor(() => expect(calls).toHaveLength(1))
    await manager.control(ref(), 'pause')
    await manager.close()
    finish({ data: { relations: [{ from: '甲', to: '乙', relation: '救助', qualifier: 'asserted', quote: calls[0]!.text }] } })
    await Promise.resolve()
    expect(state().phase).toBe('paused'); expect(state().calls).toBe(1)
    expect(graph().edges).toHaveLength(0)
    provider = sampleProvider(); manager = new GraphIndexManager(() => provider)
    await manager.control(ref(), 'resume', manager.preview(ref(), 'resume').token)
    await ready(); expect(state().calls).toBe(2)
  })
  it('模型变更暂停，改名或同mtime改字立即使原来源证据失效', async () => {
    await enable(); await ready()
    provider = sampleProvider('two'); await manager.refresh()
    expect(state().phase).toBe('model-changed'); expect(calls).toHaveLength(1)
    const target = path.join(book, factPath), before = fs.statSync(target)
    fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace('救助', '反对'))
    fs.utimesSync(target, before.atime, before.mtime)
    expect(graph().edges).toHaveLength(0)
    await manager.control(ref(), 'update', manager.preview(ref()).token); await ready()
    expect(calls).toHaveLength(2)
    fs.renameSync(target, path.join(book, '世界书/人物档案/甲改名.md'))
    expect(graph().edges).toHaveLength(0)
  })
  it('陈旧预览、坏缓存与链接缓存不能触发模型或静默修复', async () => {
    const preview = manager.preview(ref(), 'enable')
    fs.appendFileSync(path.join(book, factPath), '\n有改动。')
    await expect(manager.control(ref(), 'enable', preview.token)).rejects.toThrow('重新预览')
    fs.mkdirSync(path.join(book, '.webnovel'), { recursive: true })
    const file = path.join(book, '.webnovel/story-graph.sqlite')
    fs.writeFileSync(file, 'not-a-database')
    expect(graph().index?.cache).toBe('invalid'); expect(fs.readFileSync(file, 'utf8')).toBe('not-a-database')
    fs.unlinkSync(file)
    const outside = path.join(root, 'outside-cache'); fs.writeFileSync(outside, 'keep')
    fs.linkSync(outside, file)
    expect(readGraphCache(book, 'graph-index').status).toBe('invalid')
    expect(calls).toHaveLength(0)
  })
  it('源不变的失败不会因轮询自动重试，显式重试后才再调用', async () => {
    provider = { ...sampleProvider(), extract: async input => { calls.push(input); throw new Error('fixture-failure') } }
    await enable(); await vi.waitFor(() => expect(state().phase).toBe('failed'))
    await manager.refresh(); expect(calls).toHaveLength(1)
    provider = sampleProvider()
    const preview = manager.preview(ref(), 'retry')
    expect(preview.pending).toBe(1)
    await manager.control(ref(), 'retry', preview.token); await ready()
    expect(calls).toHaveLength(2)
  })
  it('完整重建预览计入全部来源，确认后保留旧库和累计用量', async () => {
    await enable(); await ready()
    const preview = manager.preview(ref(), 'rebuild')
    expect(preview.pending).toBe(1)
    await expect(manager.control(ref(), 'update', preview.token)).rejects.toThrow('重新预览')
    await manager.control(ref(), 'rebuild', preview.token); await ready()
    expect(calls).toHaveLength(2); expect(state().calls).toBe(2)
    expect(fs.readdirSync(path.join(book, '.webnovel')).some(name => name.startsWith('story-graph.sqlite.replaced-'))).toBe(true)
  })
  it('读取WAL模式缓存不创建shm/wal或恢复文件', async () => {
    await enable(); await ready(); await manager.close()
    const file = path.join(book, '.webnovel/story-graph.sqlite')
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
    const db = new DatabaseSync(file); db.exec('PRAGMA journal_mode=WAL'); db.close()
    const before = fs.readdirSync(path.dirname(file)), bytes = fs.readFileSync(file)
    expect(readGraphCache(book, 'graph-index').status).toBe('invalid')
    expect(fs.readdirSync(path.dirname(file))).toEqual(before)
    expect(fs.readFileSync(file)).toEqual(bytes)
  })
  it('抽取规则升级使已启用旧缓存待更新，普通读取不发请求', async () => {
    await enable(); await ready()
    const file = path.join(book, '.webnovel/story-graph.sqlite')
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
    const db = new DatabaseSync(file), row = db.prepare('SELECT payload FROM extractions').get()!
    const payload = JSON.parse(String(row.payload)); payload.version = 'older-rule'
    db.prepare('UPDATE extractions SET payload=?').run(JSON.stringify(payload)); db.close()
    expect(graph().index?.cache).toBe('stale'); expect(calls).toHaveLength(1)
    await manager.refresh(); await vi.waitFor(() => expect(calls).toHaveLength(2)); await ready()
    expect(graph().index?.cache).toBe('ready')
  })
  it('缺失缓存只由已启用后台重建，普通读取与暂停刷新不发请求', async () => {
    await enable(); await ready()
    fs.unlinkSync(path.join(book, '.webnovel/story-graph.sqlite'))
    expect(graph().index?.cache).toBe('missing'); expect(calls).toHaveLength(1)
    await manager.refresh(); await ready(); expect(calls).toHaveLength(2)
    await manager.control(ref(), 'pause')
    fs.unlinkSync(path.join(book, '.webnovel/story-graph.sqlite'))
    await manager.refresh()
    expect(graph().index?.cache).toBe('missing'); expect(calls).toHaveLength(2)
  })
  it('确定性更新保留暂停与累计用量，不隐式恢复抽取', async () => {
    await enable(); await ready(); await manager.control(ref(), 'pause')
    const previous = state()
    fs.appendFileSync(path.join(book, factPath), '\n### 事实@第0002章\n甲再次帮助乙。\n')
    await manager.control(ref(), 'build', manager.preview(ref(), 'build').token)
    await manager.refresh()
    expect(state()).toMatchObject({ enabled: true, paused: true, phase: 'paused', generation: previous.generation, calls: previous.calls })
    expect(calls).toHaveLength(1)
    await manager.control(ref(), 'resume', manager.preview(ref(), 'resume').token)
    await ready(); expect(calls).toHaveLength(2)
  })
  it('损坏的深层关系缓存保留现场，后台明确失败而非复用为成功', async () => {
    await enable(); await ready()
    const file = path.join(book, '.webnovel/story-graph.sqlite')
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
    const db = new DatabaseSync(file)
    const row = db.prepare('SELECT payload FROM extractions').get()!
    const payload = JSON.parse(String(row.payload)); payload.relations[0].offset = -1
    db.prepare('UPDATE extractions SET payload=?').run(JSON.stringify(payload)); db.close()
    const bytes = fs.readFileSync(file)
    expect(graph().index?.cache).toBe('invalid')
    await manager.refresh(); await vi.waitFor(() => expect(state().phase).toBe('failed'))
    expect(fs.readFileSync(file)).toEqual(bytes); expect(calls).toHaveLength(1)
  })
})

it('结构校验保留否定/证言，重复引文需明确序号，歧义身份留作未归属', () => {
  const input: GraphModelInput = { sourceKind: 'world-append', fields: {}, text: '甲并非乙的师父。有人声称甲是乙的师父。重复。重复。',
    entities: [{ id: 'a', label: '甲', aliases: [] }, { id: 'b', label: '乙', aliases: [] }, { id: 'c', label: '乙', aliases: [] }] }
  const result = validateExtraction({ relations: [
    { from: '甲', to: '乙', relation: '师徒', qualifier: 'negated', quote: '甲并非乙的师父。' },
    { from: 'a', to: 'b', relation: '师徒', qualifier: 'reported', quote: '有人声称甲是乙的师父。' },
    { from: 'a', to: 'b', relation: '重复', qualifier: 'uncertain', quote: '重复。' },
    { from: 'a', to: 'b', relation: '伪造', qualifier: 'asserted', quote: '原文不存在。' },
  ] }, input)
  expect(result.relations).toHaveLength(2); expect(result.rejected).toBe(2)
  expect(result.relations[0]).toMatchObject({ assigned: false, qualifier: 'negated' })
  expect(result.relations[1]).toMatchObject({ assigned: false, qualifier: 'reported' })
})
