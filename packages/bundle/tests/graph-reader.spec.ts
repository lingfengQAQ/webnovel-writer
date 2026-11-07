import { describe, expect, it } from 'vitest'
import { readGraphPage } from '../src/study/graph-reader'
import { readStoryGraph } from '../src/study/graph'
import type { StoryGraph, StoryGraphRecord } from '../src/study/graph-types'
import { graphScaleSource, addScaleRelations } from './fixtures/graph-scale-data'

const record = (id: string, chapter: number, label = id): StoryGraphRecord => ({ id, label, chapter, recordChapter: chapter, kind: '人物', status: '已成事实', plan: false, line: 1, preview: '', source: { space: 'book:test', path: `世界书/人物档案/${id}.md` } })
const fixture = (): StoryGraph => {
  const records = [record('a', 1), { ...record('b', 2), affiliations: [{ field: '势力', label: '青云宗' }, { field: '家族', label: '沈家' }] }, record('c', 700), { ...record('future', 999), affiliations: [{ field: '势力', label: '未来宗门' }] }]
  return { bookId: 'test', bookName: '标签反例', maxChapter: 1000, records, events: [], warnings: [], entities: records.map(r => ({ id: r.id, label: r.label, aliases: [], kind: r.kind })),
    edges: [10, 11, 12].map((chapter, i) => ({ ...record(`e${i}`, chapter), from: 'a', to: 'b', relation: true, label: i === 2 ? '立场分歧' : '同盟', qualifier: i === 2 ? 'reported' : 'asserted' })).concat([
      { ...record('recent', 990), from: 'a', to: 'c', relation: true, label: '救助', qualifier: 'asserted' },
      { ...record('future-edge', 999), from: 'a', to: 'future', relation: true, label: '新盟友', qualifier: 'asserted' },
    ]) }
}
describe('星团与分页关系阅读', () => {
  it('较早关系按明确势力/家族折叠，展开保留同一对人物的全部证据', () => {
    const graph = fixture(), closed = readGraphPage(graph, { chapter: 995, person: 'a' })
    expect(closed.clusters.items).toMatchObject([{ label: '青云宗', members: 1, evidence: 3, lastChapter: 12 }])
    expect(closed.graph.records.some(item => item.id === 'b')).toBe(false)
    expect(closed.graph.records.some(item => item.kind === '星团')).toBe(true)
    const opened = readGraphPage(graph, { chapter: 995, person: 'a', cluster: closed.clusters.items[0]!.id })
    expect(opened.relations.total).toBe(1)
    expect(opened.relations.items[0]).toMatchObject({ count: 3, labels: ['同盟', '立场分歧'] })
    expect(opened.graph.records.some(item => item.id === 'b')).toBe(true)
    const detail = readGraphPage(graph, { chapter: 995, person: 'a', relation: opened.relations.items[0]!.id })
    expect(detail.details.total).toBe(3)
    expect(detail.details.items[0]).toMatchObject({ label: '立场分歧', qualifier: 'reported' })
    expect(readGraphPage(graph, { chapter: 995, person: 'a', groupField: '家族' }).clusters.items[0]!.label).toBe('沈家')
  })
  it('所有分页参数各自独立，星团成员不借人物目录页、未归属不借证据页', () => {
    const graph = fixture()
    const records = [...graph.records, ...Array.from({ length: 100 }, (_, i) => ({ ...record(`p${i}`, 1), affiliations: [{ field: '势力', label: i < 50 ? '共同势力' : `势力${i}` }] }))]
    const edges = [...graph.edges, ...records.slice(4).flatMap((node, i) => [{ ...record(`old-${i}`, 10), from: 'a', to: node.id, relation: true }, { ...record(`new-${i}`, 995), from: 'a', to: node.id, relation: true }]),
      ...Array.from({ length: 55 }, (_, i) => ({ ...record(`many-${i}`, i + 1), from: 'a', to: 'b', relation: true, label: i % 2 ? '朋友' : '反目', qualifier: i % 2 ? 'asserted' : 'reported' }))]
    const model: StoryGraph = { ...graph, records, edges, unassigned: Array.from({ length: 55 }, (_, i) => ({ ...record(`u${i}`, 2), from: '甲', to: '未知', qualifier: 'uncertain', evidenceId: `u${i}` })) }
    const common = { person: 'a', chapter: 995, mode: 'all' as const, relation: JSON.stringify(['a', 'b']) }
    const whole = readGraphPage(model, common), cluster = whole.clusters.items.find(item => item.label === '共同势力')!.id
    const options = { ...common, cluster }, base = readGraphPage(model, options)
    const pages = { catalogPage: 'catalog', relationPage: 'relations', clusterPage: 'clusters', memberPage: 'members', evidencePage: 'details', unassignedPage: 'unassigned', transitionPage: 'transitions' } as const
    for (const [parameter, target] of Object.entries(pages)) {
      expect(base[target as typeof pages[keyof typeof pages]].pages).toBeGreaterThan(1)
      const flipped = readGraphPage(model, { ...options, [parameter]: 1 })
      for (const list of Object.values(pages)) expect(flipped[list].page, `${parameter} must only change ${target}`).toBe(list === target ? 1 : 0)
    }
  })
  it('最近记载与按章变化序列保留证言/否定，早章不会看到后来的反目', () => {
    const graph = fixture()
    const rows = [[12, '结义', 'asserted'], [100, '结义', 'asserted'], [340, '反目', 'reported'], [500, '反目', 'negated'], [801, '和解', 'asserted']] as const
    const model: StoryGraph = { ...graph, edges: rows.map(([at, label, qualifier], i) => ({ ...record(`change-${i}`, at, label), evidenceId: `quote-${i}`, from: 'a', to: 'b', relation: true, qualifier })) }
    const relation = JSON.stringify(['a', 'b'])
    const early = readGraphPage(model, { person: 'a', chapter: 200, relation })
    expect(early.selectedRelation!.latest).toMatchObject({ label: '结义', chapter: 100, qualifier: 'asserted' })
    expect(JSON.stringify(early)).not.toContain('反目')
    const reported = readGraphPage(model, { person: 'a', chapter: 400, relation })
    expect(reported.graph.edges[0]).toMatchObject({ label: '反目 · 最近记载', qualifier: 'reported' })
    const latest = readGraphPage(model, { person: 'a', chapter: 995, relation })
    expect(latest.transitions.items.map(item => [item.chapter, item.label, item.qualifier])).toEqual([[12, '结义', 'asserted'], [340, '反目', 'reported'], [500, '反目', 'negated'], [801, '和解', 'asserted']])
    const located = readGraphPage(model, { person: 'a', chapter: 995, relation, evidenceId: 'quote-2' })
    expect(located.details.items.some(item => item.evidenceId === 'quote-2')).toBe(true)
  })
  it('有大量跨章证据的核心关系优先于近日的一次性关联', () => {
    const graph = fixture(), records = [...graph.records, ...Array.from({ length: 10 }, (_, i) => record(`guest-${i}`, 1))]
    const model: StoryGraph = { ...graph, records, edges: [
      ...Array.from({ length: 600 }, (_, i) => ({ ...record(`core-${i}`, 200 + i), from: 'a', to: 'b', label: '同盟', relation: true })),
      ...Array.from({ length: 10 }, (_, i) => ({ ...record(`guest-edge-${i}`, 830 + i), from: 'a', to: `guest-${i}`, label: '问路', relation: true })),
    ] }
    const page = readGraphPage(model, { person: 'a', chapter: 850 })
    expect(page.relations.items[0]).toMatchObject({ to: 'b', count: 600 })
    expect(page.graph.records.some(item => item.id === 'b')).toBe(true)
  })
  it('分组字段按原名选择，宗门/血脉不重分类；未知时间关系单列', () => {
    const graph = fixture(), model: StoryGraph = { ...graph, records: graph.records.map(item => item.id === 'b' ? { ...item, affiliations: [{ field: '宗门', label: '青云门' }, { field: '血脉', label: '青龙' }] } : item),
      edges: [...graph.edges, { ...record('undated', 1), chapter: undefined, recordChapter: undefined, from: 'a', to: 'c', label: '旧友', relation: true }] }
    expect(readGraphPage(model, { person: 'a', chapter: 995, groupField: '宗门' }).groupFields).toContain('血脉')
    const page = readGraphPage(model, { person: 'a', chapter: 995, groupField: '血脉' })
    expect(page.clusters.items.map(item => item.label)).toContain('青龙')
    // A separate pair with no dated evidence must never enter the recent group.
    const onlyUnknown = { ...model, edges: model.edges.filter(item => item.id === 'undated') }
    const unknown = readGraphPage(onlyUnknown, { person: 'a', chapter: 995 })
    expect(unknown.relations.total).toBe(0)
    expect(unknown.clusters.items).toMatchObject([{ id: 'unknown-time', label: '时间未知' }])
    expect(readGraphPage(onlyUnknown, { mode: 'all', chapter: 995 }).clusters.items.some(item => item.id === 'unknown-time')).toBe(true)
    expect(readGraphPage(onlyUnknown, { person: 'a', chapter: 995, unknown: false }).clusters.total).toBe(0)
  })
  it('未来标签/证据不可见，无标签保持未分类，不把较早关系删除', () => {
    const graph = fixture(), page = readGraphPage(graph, { chapter: 995, person: 'a' })
    expect(JSON.stringify(page)).not.toContain('未来宗门')
    expect(page.catalog.total).toBe(3)
    const noTags = { ...graph, records: graph.records.map(row => ({ ...row, affiliations: undefined })) }
    expect(readGraphPage(noTags, { chapter: 995, person: 'a' }).clusters.items[0]!.label).toBe('其他较早关系')
  })
  it('两千章/两千实体的读取与分页不溢出，HTTP视图保持有界', () => {
    const fixture = graphScaleSource(), graph = addScaleRelations(readStoryGraph(fixture.source))
    expect(graph.records.length).toBeGreaterThan(40000)
    const page = readGraphPage(graph, { person: graph.entities![0]!.id, chapter: 2000 })
    expect(page.catalog.total).toBe(2000)
    expect(page.catalog.items.length).toBeLessThanOrEqual(24)
    expect(page.relations.items.length).toBeLessThanOrEqual(24)
    expect(page.details.items.length).toBeLessThanOrEqual(20)
    expect(page.graph.records.length).toBeLessThanOrEqual(10)
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(150000)
    const last = readGraphPage(graph, { query: '别名2000', person: graph.entities![0]!.id })
    expect(last.catalog.items.map(item => item.label)).toEqual(['人物2000'])
  }, 15000)
})
