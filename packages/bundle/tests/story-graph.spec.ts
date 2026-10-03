import { describe, expect, it } from 'vitest'
import { graphCanvasData } from '../src/client/graph-appearance'
import { graphLayout } from '../src/client/graph-model'
import { projectStoryGraph, storyGraphHistory, type StoryGraph } from '../src/study/graph-types'
import sample from './fixtures/story-graph-sample.json'

const graph: StoryGraph = sample
const filter = { chapter: 33, reader: false, unknown: true, plans: false }
describe('adopted story graph', () => {
  it('keeps historical identities, excludes future versions and shares disclosure rules', () => {
    expect(storyGraphHistory(graph, 'missing', { ...filter, chapter: 3 }).map(n => n.status)).toEqual(['已埋'])
    expect(storyGraphHistory(graph, 'missing', { ...filter, chapter: 4 }).map(n => n.status)).toEqual(['已埋', '已收'])
    for (const chapter of [1, 3, 4, 8, 13, 16, 18, 23, 27, 28, 33]) for (const reader of [true, false]) for (const plans of [true, false]) for (const unknown of [true, false]) {
      const f = { chapter, reader, plans, unknown }
      const projected = projectStoryGraph(graph, f)
      for (const node of [...projected.nodes, ...projected.edges]) {
        const history = storyGraphHistory(graph, node.id, f)
        expect(history.at(-1)).toEqual(node)
        expect(history.every(n => n.chapter === undefined ? unknown && !reader : n.chapter <= chapter)).toBe(true)
        if (reader) expect(history.every(n => n.revealChapter !== undefined && n.revealChapter <= chapter)).toBe(true)
        if (!plans) expect(history.every(n => !n.plan)).toBe(true)
      }
    }
  })
  it('shows five shapes, planned dashes and reference arrows without changing the model', () => {
    const projected = projectStoryGraph(graph, { ...filter, plans: true })
    const positions = graphLayout(graph.records, graph.edges)
    const before = JSON.stringify(graph)
    const data = graphCanvasData(projected.nodes.map(n => ({ ...n, ...positions.get(n.id)! })), projected.edges.map(e => ({ ...e, dashed: !e.relation })), { text: 'black', line: 'grey', active: 'blue' })
    expect(new Set(data.nodes!.map(n => n.type))).toEqual(new Set(['circle', 'rect', 'ellipse', 'diamond']))
    expect(data.nodes!.find(n => n.id === 'poetry')!.style!.lineDash).toEqual([5, 3])
    for (const e of projected.edges) expect(data.edges!.find(n => n.id === e.id)!.style!.endArrow).toBe(!e.relation)
    expect(JSON.stringify(graph)).toBe(before)
  })
  it('keeps the selected edge endpoints visible and distinguishes full long labels from canvas captions', () => {
    const nodes = [{ id: 'a', label: '这是一个超过九个汉字的人物全名', kind: '人物', x: 0, y: 0 }, { id: 'b', label: '乙', kind: '人物', x: 100, y: 0 }, { id: 'c', label: '丙', kind: '人物', x: 200, y: 0 }]
    const data = graphCanvasData(nodes, [{ id: 'e', from: 'a', to: 'b', label: '朋友' }], {}, 'e')
    expect(data.nodes!.map(n => n.style!.opacity)).toEqual([1, 1, .23])
    expect(data.nodes![0]!.data!.label).toBe(nodes[0]!.label)
    expect(data.nodes![0]!.style!.labelText).toMatch(/…$/)
  })
})
