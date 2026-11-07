import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { planSettlement, serializeDocument, writeBatchAtomic } from '@webnovel/core'
import { removeSync } from '../../core/src/repo/remove'
import { StudyService } from '../src/study/service'
import { projectStoryGraph, storyGraphHistory, type StoryGraph } from '../src/study/graph-types'

let root: string
const put = (relative: string, value: string) => { const file = path.join(root, '测试书', relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value) }
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-graph-')); put('作品契约/契约.md', serializeDocument({ 书id: 'graph-book' }, '测试书')) })
afterEach(() => removeSync(root))
const read = () => new StudyService(root).graph('book:graph-book')
const project = (graph: StoryGraph, chapter: number, reader = false, unknown = true) => projectStoryGraph(graph, { chapter, reader, unknown, plans: false })
function fixture() {
  const fields = { 性质: '事实', 状态: '已成事实', 起始章: 1, 披露章: 1 }
  put('世界书/人物档案/林舟.md', serializeDocument({ ...fields, 名称: '林舟', 别名: ['阿舟'] }, '守着渡口的人。'))
  put('世界书/人物档案/沈青.md', serializeDocument({ ...fields, 名称: '沈青', 披露章: 3 }, '携带信件的人。'))
  put('世界书/人物关系/盟约.md', serializeDocument({ ...fields, 名称: '渡口盟约', 关系双方: ['阿舟', '沈青'], 关系: '盟友', 起始章: 3, 失效章: 6, 披露章: 3 }, '关系来自既有记录。'))
  put('账本/线索.md', '# 线索\n\n## 旧信\n类型: 线索\n状态: 已埋\n来源: 第2章\n### 正文\n[[林舟]] 收下旧信。\n\n## 旧信\n类型: 线索\n状态: 已收\n来源: 第6章\n### 正文\n[[林舟]] 找到答案。')
  put('账本/时间线.md', '# 时间线\n\n## 渡口相遇\n来源: 第2章\n实际落点: 定稿/卷01/0002-归航.md\n### 正文\n[[林舟]] 与 [[沈青]] 相遇。\n')
}
describe('读取既有沉淀的时序图谱', () => {
  it('实际时间线产物的结构字段进入事件预览和显式引用', () => {
    put('世界书/人物档案/林舟.md', serializeDocument({ 名称: '林舟', 性质: '事实', 起始章: 1 }, '渡口人物。'))
    put('账本/时间线.md', '# 时间线\n')
    const relative = '草稿区/定稿准备/timeline-graph'
    put(`${relative}/时间线变更.md`, '## 渡口事件\n事件：[[林舟]] 抵达渡口。\n时点：三日后\n')
    const bookRoot = path.join(root, '测试书')
    const key = { 卷: 1, 章: 2, 章名: '归航' }
    const plan = planSettlement(bookRoot, path.join(bookRoot, relative), { 章节: key, 批准: true, 裁决记录: '作者确认' }, key)
    expect(plan.ok, !plan.ok ? plan.reason : '').toBe(true)
    if (!plan.ok) throw new Error(plan.reason)
    writeBatchAtomic(bookRoot, plan.ops)
    const graph = read()
    expect(graph.events).toHaveLength(1)
    expect(graph.events[0]).toMatchObject({ chapter: 2, preview: '事件：[[林舟]] 抵达渡口。\n时点：三日后' })
    expect(graph.edges.some(edge => edge.from === graph.events[0]!.id && edge.to === 'world:世界书/人物档案/林舟.md' && !edge.relation)).toBe(true)
    expect(project(graph, 1).edges).toHaveLength(0)
  })

  it('正文导入不伪造关系，空图与章节进度分开', () => {
    put('定稿/卷01/0001-开篇.md', serializeDocument({ 角色: '已定稿' }, '甲与乙谈话。'))
    const graph = read()
    expect(graph.records).toEqual([])
    expect(graph.edges).toEqual([])
    expect(graph.maxChapter).toBe(1)
  })
  it('复用人物、显式关系与完整账本历史，按章显示当时状态', () => {
    fixture()
    const graph = read()
    expect(graph.records.filter(node => node.kind === '线索')).toHaveLength(2)
    expect(project(graph, 2).edges.some(edge => edge.relation)).toBe(false)
    expect(project(graph, 4).edges.find(edge => edge.relation)?.label).toBe('盟友')
    expect(project(graph, 7).edges.some(edge => edge.relation)).toBe(false)
    expect(project(graph, 4).nodes.find(node => node.kind === '线索')?.status).toBe('已埋')
    expect(project(graph, 7).nodes.find(node => node.kind === '线索')?.status).toBe('已收')
    expect(graph.events[0]).toMatchObject({ chapter: 2, source: { space: 'book:graph-book', path: '账本/时间线.md' } })
  })
  it('未披露和披露章未知的记录不进入读者过滤', () => {
    fixture()
    expect(project(read(), 2, true).nodes.map(node => node.label)).toEqual(['林舟'])
    expect(project(read(), 4, true).edges.some(edge => edge.relation)).toBe(true)
    expect(project(read(), 4, true).nodes.some(node => node.kind === '线索')).toBe(false)
  })
  it('未知时间可单列，计划不冒充事实，同名不自动合并', () => {
    fixture()
    put('世界书/人物档案/同名甲.md', serializeDocument({ 名称: '同名', 性质: '事实' }, '甲'))
    put('世界书/人物档案/同名乙.md', serializeDocument({ 名称: '同名', 性质: '事实' }, '乙'))
    put('世界书/人物关系/不明确.md', serializeDocument({ 名称: '不明确关系', 性质: '事实', 关系双方: ['同名', '林舟'] }, '不得猜测'))
    put('世界书/人物档案/计划人物.md', serializeDocument({ 名称: '计划人物', 性质: '计划', 起始章: 1 }, '尚未发生'))
    const graph = read()
    expect(graph.warnings.some(item => item.message.includes('不唯一'))).toBe(true)
    expect(project(graph, 4).nodes.filter(node => node.label === '同名')).toHaveLength(2)
    expect(project(graph, 4, false, false).nodes.some(node => node.label === '同名')).toBe(false)
    expect(project(graph, 4).nodes.some(node => node.label === '计划人物')).toBe(false)
  })
  it('缺失引用和坏格式明确提示，读取不改写原文件', () => {
    put('世界书/人物档案/坏文件.md', '---\n名称: [\n---\n内容')
    const content = serializeDocument({ 名称: '林舟' }, '[[不存在的人]]')
    put('世界书/人物档案/林舟.md', content)
    const graph = read()
    expect(graph.warnings).toHaveLength(2)
    expect(fs.readFileSync(path.join(root, '测试书/世界书/人物档案/林舟.md'), 'utf8')).toBe(content)
    expect(() => new StudyService(root).graph('book:another')).toThrow()
  })
  it('历史状态结束后不能把更早的已过时关系重新显示', () => {
    fixture()
    const graph = read()
    const original = graph.edges.find(edge => edge.relation)!
    const model = { ...graph, edges: [{ ...original, chapter: 1, endChapter: undefined }, { ...original, chapter: 3, endChapter: 6 }] }
    expect(project(model, 7).edges.some(edge => edge.relation)).toBe(false)
  })
  it('世界书链接不读取工作范围外的资料', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-graph-outside-'))
    try {
      fs.writeFileSync(path.join(outside, '外部.md'), serializeDocument({ 名称: '外部秘密' }, '不可读取'))
      fs.mkdirSync(path.join(root, '测试书/世界书'), { recursive: true })
      fs.symlinkSync(outside, path.join(root, '测试书/世界书/链接'), 'junction')
      const graph = read()
      expect(graph.records.some(node => node.label === '外部秘密')).toBe(false)
      expect(graph.warnings.length).toBeGreaterThan(0)
      fs.unlinkSync(path.join(root, '测试书/世界书/链接'))
    } finally { removeSync(outside) }
  })

  it('计划头与逐章事实分开读取，事实有实际行号且不包含未来追加', () => {
    const relative = '世界书/人物档案/林舟.md'
    const content = serializeDocument({ 名称: '林舟', 性质: '计划', 起始章: 9, 披露章: 1 }, [
      '未来计划，不是已发生事实。', '### 事实@第0001章', '来源：定稿/卷01/0001-初见.md', '第一章已经救下沈青。',
      '### 事实@第0008章', '来源：定稿/卷01/0008-决裂.md', '第八章与沈青决裂。',
    ].join('\n'))
    put(relative, content)
    const graph = read()
    expect(graph.records).toHaveLength(3)
    const early = project(graph, 1).nodes[0]!
    expect(early).toMatchObject({ plan: false, chapter: 1, status: '已成事实' })
    expect(early.preview).toBe('第一章已经救下沈青。')
    expect(early.line).toBe(content.split('\n').indexOf('### 事实@第0001章') + 1)
    expect(project(graph, 8).nodes[0]?.preview).toBe('第八章与沈青决裂。')
    expect(storyGraphHistory(graph, early.id, { chapter: 8, reader: false, plans: false, unknown: true }).map(record => record.chapter)).toEqual([1, 8])
    expect(project(graph, 8, true).nodes).toHaveLength(0)
  })

  it('保留新建首段，后章引用与事实不会进入早章视图', () => {
    put('世界书/人物档案/林舟.md', serializeDocument({ 名称: '林舟', 性质: '事实', 来源: '定稿/卷01/0001-初见.md', 披露章: 1 },
      '第一章守着渡口。\n### 事实@第0008章\n来源：定稿/卷01/0008-来信.md\n后来收到 [[沈青]] 的信。'))
    put('世界书/人物档案/沈青.md', serializeDocument({ 名称: '沈青', 性质: '事实', 起始章: 1, 披露章: 1 }, '另一名人物。'))
    const graph = read()
    expect(project(graph, 1).nodes.find(record => record.label === '林舟')?.preview).toBe('第一章守着渡口。')
    expect(project(graph, 1).edges).toHaveLength(0)
    expect(project(graph, 8).edges).toHaveLength(1)
    expect(project(graph, 8, true).nodes.find(record => record.label === '林舟')?.preview).toBe('第一章守着渡口。')
    expect(project(graph, 8, true).edges).toHaveLength(0)
  })

  it('计划关系不会因事实追加变成已确认关系，失效关系不会复活', () => {
    fixture()
    put('世界书/人物关系/计划.md', serializeDocument({ 名称: '计划结盟', 性质: '计划', 关系双方: ['林舟', '沈青'], 关系: '未来盟友', 起始章: 1, 披露章: 1 },
      '计划结盟。\n### 事实@第0003章\n来源：定稿/卷01/0003-争论.md\n两人进行了一次争论。'))
    const expired = '世界书/人物关系/盟约.md'
    const original = fs.readFileSync(path.join(root, '测试书', expired), 'utf8')
    put(expired, original + '\n### 事实@第0007章\n来源：定稿/卷01/0007-回忆.md\n回忆过去盟约。\n')
    expect(project(read(), 4).edges.some(edge => edge.label === '未来盟友')).toBe(false)
    expect(project(read(), 7).edges.some(edge => edge.relation)).toBe(false)
  })

  it('围栏内事实标题不分段，CRLF 与只有追加段的旧文件仍可读取', () => {
    const content = serializeDocument({ 名称: '林舟', 性质: '事实', 起始章: 1 },
      '首段。\n```text\n### 事实@第0999章\n示例而非历史。\n```\n### 事实@第0002章\n来源：定稿/卷01/0002-来信.md\n第二章事实。').replaceAll('\n', '\r\n')
    put('世界书/人物档案/林舟.md', content)
    put('世界书/人物档案/沈青.md', '### 事实@第0001章\n来源：定稿/卷01/0001-初见.md\n第一章事实。\n')
    const graph = read()
    expect(graph.records.filter(record => record.label === '林舟')).toHaveLength(2)
    expect(project(graph, 1).nodes.find(record => record.label === '林舟')?.preview).toContain('示例而非历史')
    expect(project(graph, 2).nodes.find(record => record.label === '林舟')?.preview).toBe('第二章事实。')
    expect(project(graph, 1).nodes.find(record => record.label === '沈青')).toMatchObject({ chapter: 1, preview: '第一章事实。' })
  })
})
