import type { FileRef } from './types'

export interface StoryGraphRecord {
  readonly id: string
  readonly label: string
  readonly kind: string
  readonly status: string
  readonly chapter?: number
  readonly endChapter?: number
  readonly revealChapter?: number
  readonly plan: boolean
  readonly source: FileRef
  readonly line: number
  readonly preview: string
}
export interface StoryGraphEdge extends StoryGraphRecord {
  readonly from: string
  readonly to: string
  readonly relation: boolean
}
export interface StoryGraph {
  readonly bookId: string
  readonly bookName: string
  readonly maxChapter: number
  readonly records: readonly StoryGraphRecord[]
  readonly edges: readonly StoryGraphEdge[]
  readonly events: readonly StoryGraphRecord[]
  readonly warnings: readonly { path: string; message: string }[]
}
export interface GraphFilter { readonly chapter: number; readonly reader: boolean; readonly unknown: boolean; readonly plans: boolean }

/** The same visibility rule applies to the current projection and its history. */
export function graphRecordVisible(item: StoryGraphRecord, filter: GraphFilter): boolean {
  return (!item.plan || filter.plans)
    && (item.chapter === undefined ? filter.unknown && !filter.reader : item.chapter <= filter.chapter)
    && (!filter.reader || item.revealChapter !== undefined && item.revealChapter <= filter.chapter)
}

export function storyGraphHistory(graph: StoryGraph, id: string, filter: GraphFilter): StoryGraphRecord[] {
  return [...graph.records, ...graph.edges].filter(item => item.id === id && graphRecordVisible(item, filter))
    .sort((a, b) => (a.chapter ?? -1) - (b.chapter ?? -1) || a.line - b.line)
}

/** Filter before folding, so later changes never hide the historical state of a relationship. */
export function projectStoryGraph(graph: StoryGraph, filter: GraphFilter) {
  const visible = (item: StoryGraphRecord) => graphRecordVisible(item, filter)
  const fold = <T extends StoryGraphRecord>(records: readonly T[]) => {
    const found = new Map<string, T>()
    for (const item of records.filter(visible).slice().sort((a, b) => (a.chapter ?? -1) - (b.chapter ?? -1) || a.line - b.line)) found.set(item.id, item)
    return [...found.values()].filter(item => item.endChapter === undefined || filter.chapter < item.endChapter)
  }
  const candidates = fold(graph.records)
  const ids = new Set(candidates.map(node => node.id))
  const edges = fold(graph.edges).filter(edge => ids.has(edge.from) && ids.has(edge.to))
  const relations = new Set(edges.filter(edge => edge.relation).map(edge => edge.source.path))
  const nodes = candidates.filter(node => node.kind !== '关系' || !relations.has(node.source.path) && !filter.reader)
  const shown = new Set(nodes.map(node => node.id))
  return { nodes, edges: edges.filter(edge => shown.has(edge.from) && shown.has(edge.to)), events: graph.events.filter(visible).slice().sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0) || a.line - b.line),
    unknown: graph.records.filter(item => item.chapter === undefined).length,
    unrevealed: graph.records.filter(item => item.revealChapter === undefined).length }
}
