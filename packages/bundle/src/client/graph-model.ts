import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force'
import type { StoryGraphEdge, StoryGraphRecord } from '../study/graph-types'

export interface Point { x: number; y: number }
export function neighbors(id: string, edges: readonly StoryGraphEdge[], depth: number): Set<string> {
  const found = new Set([id]); let frontier = [id]
  for (let step = 0; step < depth; step++) {
    const next: string[] = []
    for (const node of frontier) for (const edge of edges) {
      const other = edge.from === node ? edge.to : edge.to === node ? edge.from : undefined
      if (other && !found.has(other)) { found.add(other); next.push(other) }
    }
    frontier = next
  }
  return found
}
/** Relationships are mutual; an explicit reference keeps its authored direction. */
export function graphPath(from: string, to: string, edges: readonly StoryGraphEdge[]): string[] | undefined {
  const previous = new Map<string, string | null>([[from, null]])
  const queue = [from]
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!
    if (current === to) {
      const result = [to]; let parent = previous.get(to)
      while (parent) { result.unshift(parent); parent = previous.get(parent) }
      return result
    }
    for (const edge of edges) {
      const next = edge.from === current ? edge.to : edge.relation && edge.to === current ? edge.from : undefined
      if (next && !previous.has(next)) { previous.set(next, current); queue.push(next) }
    }
  }
  return undefined
}
/** Complete identities determine the layout, never the current chapter projection. */
export function graphLayout(records: readonly StoryGraphRecord[], edges: readonly StoryGraphEdge[], previous?: ReadonlyMap<string, Point>): Map<string, Point> {
  const unique = [...new Map(records.map(n => [n.id, n])).values()].sort((a, b) => a.id.localeCompare(b.id))
  const ids = new Set(unique.map(n => n.id))
  const anchors: Record<string, Point> = { 人物: { x: 360, y: 230 }, 组织: { x: 600, y: 150 }, 地点: { x: 560, y: 520 }, 事件: { x: 300, y: 530 }, 线索: { x: 120, y: 310 } }
  const nodes = unique.map((n, i) => {
    const anchor = anchors[n.kind] ?? { x: 360, y: 360 }, old = previous?.get(n.id)
    return { id: n.id, kind: n.kind, x: old?.x ?? anchor.x + Math.cos(i * 2.399) * Math.sqrt(i + 1) * 22,
      y: old?.y ?? anchor.y + Math.sin(i * 2.399) * Math.sqrt(i + 1) * 22, fx: old?.x, fy: old?.y }
  })
  // Repeated reads and chapter changes reuse coordinates without another simulation.
  if (nodes.every(n => previous?.has(n.id))) return new Map(nodes.map(n => [n.id, previous!.get(n.id)!]))
  if (nodes.length <= 600) {
    const links = [...new Map(edges.filter(e => ids.has(e.from) && ids.has(e.to)).map(e => [e.id, { source: e.from, target: e.to }])).values()]
      .sort((a, b) => String(a.source).localeCompare(String(b.source)) || String(a.target).localeCompare(String(b.target)))
    type Node = SimulationNodeDatum & { id: string; kind: string; x: number; y: number }
    const simulation = forceSimulation<Node>(nodes).stop()
      .force('link', forceLink<Node, typeof links[number]>(links).id(n => n.id).distance(99).strength(.3))
      .force('charge', forceManyBody().strength(-65))
      .force('collide', forceCollide<Node>(n => n.kind === '人物' ? 40 : 53).iterations(3))
      .force('x', forceX<Node>(n => (anchors[n.kind] ?? { x: 360 }).x).strength(.065))
      .force('y', forceY<Node>(n => (anchors[n.kind] ?? { y: 360 }).y).strength(.065))
    simulation.tick(360)
  }
  // Guarantee separation, including newly added nodes near pinned/dragged positions.
  const layout = new Map<string, Point>()
  for (const n of nodes) if (previous?.has(n.id)) layout.set(n.id, previous.get(n.id)!)
  const radius = new Map(nodes.map(n => [n.id, n.kind === '人物' ? 35 : 53]))
  let slot = 0
  for (const n of nodes) if (!layout.has(n.id)) {
    let point = { x: n.x, y: n.y }
    const overlaps = () => [...layout].some(([id, p]) => Math.hypot(p.x - point.x, p.y - point.y) < radius.get(id)! + radius.get(n.id)! + 2)
    if (nodes.length > 600) {
      do { point = { x: slot % 12 * 130, y: Math.floor(slot / 12) * 112 }; slot++ } while (overlaps())
    } else {
      let step = 0
      while (overlaps()) { step++; point = { x: n.x + Math.cos(step * 2.399) * Math.sqrt(step) * 24, y: n.y + Math.sin(step * 2.399) * Math.sqrt(step) * 24 } }
    }
    layout.set(n.id, point)
  }
  return new Map(unique.map(n => [n.id, layout.get(n.id)!]))
}
