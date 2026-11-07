import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { documentHash, parseLedgerHistory, serializeDocument, timelineStoryTime } from '@webnovel/core'
import { removeSync } from '../../core/src/repo/remove'
import { StudyService } from '../src/study/service'
import { projectStoryGraph } from '../src/study/graph-types'
import { createEditorStore, fileKey } from '../src/client/store'
import { callStudy } from '../src/client/api'
import { GRAPH_PROMPT_VERSION, graphIdentityHash, overlayExtractions } from '../src/study/graph-extraction'

vi.mock('../src/client/api', async original => ({ ...await original<typeof import('../src/client/api')>(), callStudy: vi.fn() }))
const request = vi.mocked(callStudy)
let root: string, book: string
const put = (relative: string, raw: string) => { const target = path.join(book, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, raw) }
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-evidence-')); book = path.join(root, '测试书')
  put('作品契约/契约.md', serializeDocument({ 书id: 'evidence', 书仓格式版本: 1 }, '证据样本'))
  request.mockReset()
})
afterEach(() => removeSync(root))
const service = () => new StudyService(root)

describe('完整沉淀与精确来源', () => {
  it('并发只读来源与同步路径一致，保留BOM并拒绝共享硬链接', async () => {
    const relative = '世界书/人物档案/甲.md'
    put(relative, '\uFEFF' + serializeDocument({ 名称: '甲', 类型: '人物', 性质: '事实', 来源: '第2章' }, '甲帮助乙。').replaceAll('\n', '\r\n'))
    const before = service().graph('book:evidence')
    const first = await service().graphForReader('book:evidence'), repeated = await service().graphForReader('book:evidence')
    expect(first).toEqual(before)
    expect(repeated.records).toBe(first.records)
    const target = path.join(book, relative), stat = fs.statSync(target)
    fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace('帮助', '反对')); fs.utimesSync(target, stat.atime, stat.mtime)
    expect((await service().graphForReader('book:evidence')).fingerprint).not.toBe(before.fingerprint)
    fs.linkSync(target, path.join(book, '世界书/人物档案/共享.md'))
    const refused = await service().graphForReader('book:evidence')
    expect(refused.records).toHaveLength(0); expect(refused.warnings).toHaveLength(2)
    await expect(service().graphForReader('book:evidence', AbortSignal.abort())).rejects.toThrow()
    expect(fs.existsSync(path.join(book, '.webnovel'))).toBe(false)
  })
  it('旧时间线前缀不再作为当前字段读取，普通正文不推断时间', () => {
    const fields = { 章号: '第3章', 来源: '定稿/卷01/0003-渡口.md', 裁决记录: '夹具批准' }
    expect(timelineStoryTime({ 字段: fields, 正文: '事件：两人相遇\n时点：次日清晨\n正文。' })).toBeUndefined()
    expect(timelineStoryTime({ 字段: { ...fields, 事件: '新格式事件' }, 正文: '事件：这是正文里的例子\n时点：并非字段' })).toBeUndefined()
    expect(timelineStoryTime({ 字段: { 来源: '第3章' }, 正文: '事件：例子\n时点：不能推断' })).toBeUndefined()
    expect(timelineStoryTime({ 字段: fields, 正文: '事件：例子\n时点：甲\n时点：乙' })).toBeUndefined()
    expect(timelineStoryTime({ 字段: fields, 正文: '```\n事件：围栏示例\n时点：不作字段\n```' })).toBeUndefined()
  })
  it('抽取后的子引文仍有精确原始字节范围，包含CRLF和非BMP字符', () => {
    const raw = '\uFEFF' + serializeDocument({ 名称: '甲', 性质: '计划' }, '计划。\n### 事实@第0002章\n前文。\n🌊甲帮助了乙。\n随后告别。\n后文。').replaceAll('\n', '\r\n')
    put('世界书/人物档案/甲.md', raw)
    put('世界书/人物档案/乙.md', serializeDocument({ 名称: '乙', 性质: '计划' }, '计划'))
    const graph = service().graph('book:evidence'), evidence = graph.evidence!.find(item => item.sourceKind === 'world-append')!
    const quote = '🌊甲帮助了乙。\n随后告别。'
    const result = overlayExtractions(graph, [{ version: GRAPH_PROMPT_VERSION, key: 'fixture', evidenceId: evidence.id, sourceHash: evidence.location.hash, identityHash: graphIdentityHash(graph), revision: 'one', model: 'fixture', rejected: 0,
      relations: [{ from: 'world:世界书/人物档案/甲.md', to: 'world:世界书/人物档案/乙.md', relation: '救助', qualifier: 'asserted', quote, offset: evidence.location.quote.indexOf(quote), assigned: true }] }])
    const extracted = result.evidence!.at(-1)!
    expect(raw.slice(extracted.rawFrom, extracted.rawTo).replaceAll('\r\n', '\n')).toBe(quote)
    expect(Buffer.from(raw).subarray(extracted.byteFrom, extracted.byteTo).toString().replaceAll('\r\n', '\n')).toBe(quote)
    expect(extracted.byteFrom).toBe(Buffer.byteLength(raw.slice(0, extracted.rawFrom)))
    expect(service().read(extracted.source).body.slice(extracted.location.from, extracted.location.to)).toBe(quote)
  })
  it('BOM、CRLF、重复引文和长事实按各自原始范围定位，读取不创建缓存', () => {
    const raw = '\uFEFF' + serializeDocument({ 名称: '林舟', 类型: '人物', 性质: '计划' },
      '计划不可抽取。\n### 事实@第0001章\n来源：定稿/卷01/0001-初见.md\n同一句事实。\n### 事实@第0002章\n来源：定稿/卷01/0002-回望.md\n同一句事实。\n' + '很长的补充。'.repeat(200)).replaceAll('\n', '\r\n')
    const relative = '世界书/人物档案/林舟.md'; put(relative, raw)
    const graph = service().graph('book:evidence'), evidence = graph.evidence!
    expect(evidence).toHaveLength(3)
    expect(evidence.map(item => item.eligible)).toEqual([false, true, true])
    expect(evidence[2]!.location.quote.length).toBeGreaterThan(600)
    expect(evidence[2]!.relatedChapters).toEqual([{ space: 'book:evidence', path: '定稿/卷01/0002-回望.md' }])
    expect(evidence[2]!.source.path).toBe(relative)
    for (const item of evidence) {
      expect(item.location.hash).toBe(documentHash(raw))
      expect(Buffer.from(raw).subarray(item.byteFrom, item.byteTo).toString()).toBe(raw.slice(item.rawFrom, item.rawTo))
      const doc = service().read(item.source)
      expect(doc.hash).toBe(documentHash(raw))
      expect(doc.body.slice(item.location.from, item.location.to)).toBe(item.location.quote)
    }
    expect(evidence[1]!.rawFrom).toBeLessThan(evidence[2]!.rawFrom)
    expect(fs.existsSync(path.join(book, '.webnovel'))).toBe(false)
    expect(fs.readFileSync(path.join(book, relative), 'utf8')).toBe(raw)
  })

  it('时间线保留完整字段与故事时点，围栏中的标题和字段不产生伪条目', () => {
    const raw = '# 时间线\n\n## 初见\n来源：第1章\n事件：林舟遇见沈青。\n时点：三日后\n```text\n## 并非第二个事件\n来源：第9999章\n```\n### 正文\n补充证言。\n\n## 分别\n来源：第2章\n事件：两人分别。\n'
    put('账本/时间线.md', raw)
    const parsed = parseLedgerHistory(raw, '时间线', '账本/时间线.md')
    expect(parsed.entries).toHaveLength(2)
    expect(parsed.entries[0]!.字段['来源']).toBe('第1章')
    const graph = service().graph('book:evidence')
    expect(graph.events).toHaveLength(2)
    expect(graph.evidence![0]).toMatchObject({ recordChapter: 1, storyTime: '三日后', eligible: true })
    expect(graph.evidence![0]!.location.quote).toContain('来源：第9999章')
    expect(graph.evidence![0]!.location.quote).not.toContain('两人分别')
  })

  it('自定义类型保真，更正后的首段不能沿旧章号伪造历史', () => {
    put('世界书/人物档案/林舟.md', serializeDocument({ 名称: '林舟', 类型: '神兽', 性质: '事实', 生成模块: '吃书补偿', 来源: '第1章' }, '更正后的事实。'))
    put('定稿/卷01/0005-现状.md', serializeDocument({ 角色: '已定稿' }, '当前正文'))
    const graph = service().graph('book:evidence')
    expect(graph.records[0]).toMatchObject({ kind: '神兽', historyBasis: 'current-only', recordChapter: 1 })
    expect(projectStoryGraph(graph, { chapter: 1, plans: false, reader: false, unknown: true }).nodes).toHaveLength(0)
    expect(projectStoryGraph(graph, { chapter: graph.maxChapter, plans: false, reader: false, unknown: true }).nodes).toHaveLength(1)
  })

  it('晚章入档的证据不因更早生效日期而泄露到早章', () => {
    for (const name of ['甲', '乙']) put(`世界书/人物档案/${name}.md`, serializeDocument({ 名称: name, 类型: '人物', 性质: '事实', 来源: '第1章' }, '人物资料。'))
    put('世界书/人物关系/盟友.md', serializeDocument({ 名称: '盟友', 类型: '关系', 性质: '事实', 来源: '第8章', 起始章: 2, 关系双方: ['甲', '乙'], 关系: '盟友' }, '第八章才得知双方早已结盟。'))
    const graph = service().graph('book:evidence')
    expect(graph.edges[0]).toMatchObject({ chapter: 2, recordChapter: 8 })
    expect(graph.maxChapter).toBe(8)
    expect(projectStoryGraph(graph, { chapter: 2, plans: false, reader: false, unknown: true }).edges).toHaveLength(0)
    expect(projectStoryGraph(graph, { chapter: 8, plans: false, reader: false, unknown: true }).edges).toHaveLength(1)
  })

  it('来源打开重新读磁盘并精确选中第二次重复引文，后续编辑不被定位覆盖', async () => {
    put('世界书/人物档案/林舟.md', serializeDocument({ 名称: '林舟', 性质: '计划' }, '计划。\n### 事实@第0001章\n同一句。\n### 事实@第0002章\n同一句。'))
    const graph = service().graph('book:evidence'), item = graph.evidence!.at(-1)!
    const doc = service().read(item.source), store = createEditorStore()
    request.mockResolvedValue(doc)
    await store.open('session', item.source, item.location)
    const key = fileKey(item.source)
    expect(store.get('session').buffers[key]!.location?.from).toBe(doc.body.lastIndexOf('同一句。'))
    store.updateBuffer('session', key, { text: doc.body + '未保存的字。' })
    await store.open('session', item.source, item.location)
    expect(store.get('session').buffers[key]!.text).toContain('未保存的字')
    expect(store.get('session').buffers[key]!.location).toBeUndefined()
    expect(store.get('session').notice).toContain('未保存编辑')
    store.dispose()
  })

  it('来源变化拒绝旧位置；只有元字段的来源可核对原始前缀', async () => {
    const relative = '世界书/人物关系/盟友.md'
    put(relative, serializeDocument({ 性质: '事实', 关系双方: ['甲', '乙'], 关系: '盟友' }, ''))
    const item = service().graph('book:evidence').evidence![0]!, store = createEditorStore()
    request.mockResolvedValue(service().read(item.source))
    await store.open('one', item.source, item.location)
    expect(store.get('one').buffers[fileKey(item.source)]!.location!.from).toBeLessThan(0)
    put(relative, serializeDocument({ 性质: '事实', 关系双方: ['甲', '乙'], 关系: '对手' }, ''))
    request.mockResolvedValue(service().read(item.source))
    await store.open('one', item.source, item.location)
    expect(store.get('one').notice).toContain('来源已变化')
    expect(store.get('one').buffers[fileKey(item.source)]!.location).toBeUndefined()
    store.dispose()
  })
})
