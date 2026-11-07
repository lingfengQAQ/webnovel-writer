import { graphRecordVisible, projectStoryGraph, type GraphFilter, type StoryGraph, type StoryGraphEdge, type StoryGraphRecord } from './graph-types'
import type { GraphEvidence } from './graph-evidence'

export interface GraphReaderRequest extends Partial<GraphFilter> {
  mode?: 'person' | 'chapter' | 'all'
  person?: string
  query?: string
  cluster?: string
  relation?: string
  catalogPage?: number
  relationPage?: number
  clusterPage?: number
  memberPage?: number
  unassignedPage?: number
  transitionPage?: number
  evidencePage?: number
  evidenceId?: string
  foldAfter?: number
  groupField?: string
}
export interface ReaderPerson extends StoryGraphRecord { aliases: readonly string[]; displayName: string }
export interface ReaderTransition { id: string; label: string; qualifier?: string; chapter?: number; evidenceId?: string; from: string; to: string }
export interface ReaderRelation {
  id: string; from: string; to: string; labels: string[]; count: number; lastChapter?: number; firstChapter?: number
  changed: boolean; kinds: string[]; qualifiers: string[]
  latest?: ReaderTransition
  transitions: ReaderTransition[]
}
export interface ReaderCluster { id: string; label: string; members: number; evidence: number; lastChapter?: number }
export interface ReaderPage<T> { items: T[]; total: number; page: number; pages: number }
export interface GraphReaderView {
  graph: StoryGraph
  filter: GraphFilter
  mode: 'person' | 'chapter' | 'all'
  person?: ReaderPerson
  catalog: ReaderPage<ReaderPerson>
  relations: ReaderPage<ReaderRelation>
  clusters: ReaderPage<ReaderCluster>
  cluster?: ReaderCluster
  members: ReaderPage<ReaderPerson>
  selectedRelation?: ReaderRelation
  transitions: ReaderPage<ReaderTransition>
  groupFields: string[]
  groupField?: string
  foldAfter: number
  details: ReaderPage<StoryGraphRecord>
  evidence: readonly GraphEvidence[]
  unassigned: ReaderPage<NonNullable<StoryGraph['unassigned']>[number]>
  recordChapters: number[]
  totals: { entities: number; records: number; relations: number; evidence: number }
}
const pageOf = <T>(items: T[], requested = 0, size = 24): ReaderPage<T> => {
  const pages = Math.max(1, Math.ceil(items.length / size)), page = Math.max(0, Math.min(pages - 1, Math.trunc(requested) || 0))
  return { items: items.slice(page * size, (page + 1) * size), total: items.length, page, pages }
}
const recordChapter = (record: StoryGraphRecord) => record.recordChapter ?? record.chapter
const kind = (edge: StoryGraphEdge) => edge.evidenceKind === 'extracted' ? '沉淀抽取' : edge.relation ? '明确关系' : '关联引用'
const pairId = (a: string, b: string) => JSON.stringify([a, b].sort())

type Pair = { summary: ReaderRelation; rows: StoryGraphEdge[] }
interface Prepared {
  projected: ReturnType<typeof projectStoryGraph>; visibleRecords: StoryGraphRecord[]; people: ReaderPerson[]; personById: Map<string, ReaderPerson>
  pairs: Map<string, Pair>; pairsByPerson: Map<string, Pair[]>; recordChapters: number[]; sourceById: Map<string, GraphEvidence>
}
const projections = new WeakMap<StoryGraph['records'], { edges: StoryGraph['edges']; fingerprint?: string; values: Map<string, Prepared> }>()
function prepare(source: StoryGraph, filter: GraphFilter, chapterOnly: boolean): Prepared {
  let entry = projections.get(source.records)
  if (!entry || entry.edges !== source.edges || entry.fingerprint !== source.fingerprint) {
    entry = { edges: source.edges, fingerprint: source.fingerprint, values: new Map() }; projections.set(source.records, entry)
  }
  const key = JSON.stringify([filter, chapterOnly]), cached = entry.values.get(key)
  if (cached) return cached
  const projected = projectStoryGraph(source, filter), entityById = new Map(source.entities?.map(item => [item.id, item]))
  const visibleRecords = source.records.filter(item => graphRecordVisible(item, filter)).sort((a, b) => (recordChapter(a) ?? -1) - (recordChapter(b) ?? -1) || a.line - b.line)
  const affiliations = new Map<string, NonNullable<StoryGraphRecord['affiliations']>>()
  const chapterSet = new Set<number>()
  for (const item of visibleRecords) {
    const at = recordChapter(item); if (at) chapterSet.add(at)
    if (item.affiliations?.length && (item.endChapter === undefined || filter.chapter < item.endChapter)) affiliations.set(item.id, item.affiliations)
  }
  const labelCounts = new Map<string, number>()
  for (const node of projected.nodes) labelCounts.set(node.label, (labelCounts.get(node.label) ?? 0) + 1)
  const people: ReaderPerson[] = projected.nodes.map(node => ({ ...node, preview: '', affiliations: affiliations.get(node.id), aliases: entityById.get(node.id)?.aliases ?? [],
    displayName: (labelCounts.get(node.label) ?? 0) > 1 ? `${node.label} · ${node.source.path.split('/').slice(-2).join('/').replace(/\.md$/, '')}` : node.label }))
  const personById = new Map(people.map(item => [item.id, item]))
  const pairs = new Map<string, { summary: ReaderRelation; rows: StoryGraphEdge[] }>()
  for (const edge of projected.edges) {
    if (chapterOnly && recordChapter(edge) !== filter.chapter) continue
    const id = pairId(edge.from, edge.to), at = recordChapter(edge)
    let pair = pairs.get(id)
    if (!pair) {
      pair = { summary: { id, from: edge.from, to: edge.to, labels: [], count: 0, changed: false, kinds: [], qualifiers: [], transitions: [] }, rows: [] }
      pairs.set(id, pair)
    }
    pair.rows.push(edge)
    const s = pair.summary
    s.count++; s.changed ||= at === filter.chapter
    if (at !== undefined) { s.lastChapter = Math.max(s.lastChapter ?? at, at); s.firstChapter = Math.min(s.firstChapter ?? at, at) }
    if (!s.labels.includes(edge.label)) s.labels.push(edge.label)
    if (!s.kinds.includes(kind(edge))) s.kinds.push(kind(edge))
    if (edge.qualifier && !s.qualifiers.includes(edge.qualifier)) s.qualifiers.push(edge.qualifier)
  }
  for (const pair of pairs.values()) {
    pair.rows.sort((a, b) => (recordChapter(a) ?? -1) - (recordChapter(b) ?? -1) || a.line - b.line || a.id.localeCompare(b.id))
    for (const row of pair.rows) {
      const point: ReaderTransition = { id: row.id, label: row.label, qualifier: row.qualifier, chapter: recordChapter(row), evidenceId: row.evidenceId, from: row.from, to: row.to }
      const previous = pair.summary.transitions.at(-1)
      if (!previous || previous.label !== point.label || previous.qualifier !== point.qualifier || previous.from !== point.from || previous.to !== point.to) pair.summary.transitions.push(point)
      // Undated statements do not supersede a dated latest statement.
      pair.summary.latest = point
    }
  }
  people.sort((a, b) => Number(b.kind === '人物') - Number(a.kind === '人物') || (recordChapter(b) ?? 0) - (recordChapter(a) ?? 0) || a.displayName.localeCompare(b.displayName, 'zh-CN'))
  const pairsByPerson = new Map<string, Pair[]>()
  for (const pair of pairs.values()) for (const id of new Set([pair.summary.from, pair.summary.to])) {
    const rows = pairsByPerson.get(id) ?? []; rows.push(pair); pairsByPerson.set(id, rows)
  }
  const result = { projected, visibleRecords, people, personById, pairs, pairsByPerson, recordChapters: [...chapterSet].sort((a, b) => a - b), sourceById: new Map(source.evidence?.map(item => [item.id, item])) }
  entry.values.set(key, result)
  while (entry.values.size > 4) entry.values.delete(entry.values.keys().next().value!)
  return result
}

/** Filter before aggregation. Only bounded pages, scene and selected quotes cross HTTP. */
export function readGraphPage(source: StoryGraph, request: GraphReaderRequest): GraphReaderView {
  const filter: GraphFilter = { chapter: Math.max(1, Math.min(source.maxChapter, request.chapter ?? source.maxChapter)),
    reader: request.reader ?? false, unknown: request.unknown ?? true, plans: request.plans ?? false }
  const mode = request.mode ?? 'person', needle = (request.query ?? '').trim().toLocaleLowerCase()
  const prepared = prepare(source, filter, mode === 'chapter')
  const { projected, visibleRecords, people, personById, sourceById } = prepared
  const matches = (node: ReaderPerson) => !needle || [node.label, node.source.path, ...node.aliases].some(value => value.toLocaleLowerCase().includes(needle))
  const person = personById.get(request.person ?? '') ?? people.find(item => item.kind === '人物') ?? people[0]
  const catalog = pageOf(people.filter(matches), request.catalogPage)
  const candidates = mode === 'person' ? prepared.pairsByPerson.get(person?.id ?? '') ?? [] : [...prepared.pairs.values()]
  const pairs = new Map(candidates.filter(pair => !needle || matches(personById.get(pair.summary.from)!) || matches(personById.get(pair.summary.to)!)
    || pair.summary.labels.some(label => label.toLocaleLowerCase().includes(needle))).map(pair => [pair.summary.id, pair]))
  const foldAfter = Math.max(1, request.foldAfter ?? 180), cutoff = filter.chapter - foldAfter
  const weight = (item: ReaderRelation) => Math.log2(1 + item.count) * 4 + Math.log2(1 + (item.lastChapter ?? 0) - (item.firstChapter ?? 0))
    + Math.max(0, 1 - (filter.chapter - (item.lastChapter ?? 0)) / foldAfter) * 3
  const summaries = [...pairs.values()].map(item => item.summary).sort((a, b) => Number(b.changed) - Number(a.changed)
    || weight(b) - weight(a) || (b.lastChapter ?? -1) - (a.lastChapter ?? -1) || a.id.localeCompare(b.id))
  const groupFields = [...new Set(people.flatMap(node => node.affiliations?.map(tag => tag.field) ?? []))].sort()
  const groupField = request.groupField && groupFields.includes(request.groupField) ? request.groupField : groupFields.includes('势力') ? '势力' : groupFields[0]
  const groupById = new Map<string, { summary: ReaderCluster; ids: Set<string>; pairs: ReaderRelation[] }>()
  const groupOf = (node: ReaderPerson) => {
    const tags = node.affiliations?.filter(tag => tag.field === groupField) ?? []
    return tags.length ? { id: JSON.stringify(tags), label: tags.map(tag => tag.label).join(' / ') }
      : { id: 'unclassified', label: mode === 'all' ? '未分类资料' : '其他较早关系' }
  }
  const recent: ReaderRelation[] = []
  for (const relation of summaries) {
    const other = personById.get(relation.from === person?.id ? relation.to : relation.from)!
    if (mode === 'person' && relation.lastChapter !== undefined && relation.lastChapter > cutoff) { recent.push(relation); continue }
    const group = relation.lastChapter === undefined ? { id: 'unknown-time', label: '时间未知' } : groupOf(other)
    let value = groupById.get(group.id)
    if (!value) { value = { summary: { ...group, members: 0, evidence: 0 }, ids: new Set(), pairs: [] }; groupById.set(group.id, value) }
    value.ids.add(other.id); value.pairs.push(relation); value.summary.members = value.ids.size; value.summary.evidence += relation.count
    if (relation.lastChapter !== undefined) value.summary.lastChapter = Math.max(value.summary.lastChapter ?? 0, relation.lastChapter)
  }
  if (mode === 'all') {
    groupById.clear()
    for (const node of people.filter(matches)) {
      const group = groupOf(node)
      let value = groupById.get(group.id)
      if (!value) { value = { summary: { ...group, members: 0, evidence: 0 }, ids: new Set(), pairs: [] }; groupById.set(group.id, value) }
      value.ids.add(node.id); value.summary.members = value.ids.size
    }
    for (const relation of summaries) {
      if (relation.lastChapter === undefined) {
        let unknown = groupById.get('unknown-time')
        if (!unknown) { unknown = { summary: { id: 'unknown-time', label: '时间未知', members: 0, evidence: 0 }, ids: new Set(), pairs: [] }; groupById.set('unknown-time', unknown) }
        unknown.ids.add(relation.from); unknown.ids.add(relation.to); unknown.summary.members = unknown.ids.size
        unknown.pairs.push(relation); unknown.summary.evidence += relation.count
        continue
      }
      for (const id of new Set([groupOf(personById.get(relation.from)!).id, groupOf(personById.get(relation.to)!).id])) {
      const value = groupById.get(id)
      if (!value) continue
      value.pairs.push(relation); value.summary.evidence += relation.count
      if (relation.lastChapter !== undefined) value.summary.lastChapter = Math.max(value.summary.lastChapter ?? 0, relation.lastChapter)
      }
    }
  }
  const groups = [...groupById.values()].sort((a, b) => b.summary.members - a.summary.members || a.summary.label.localeCompare(b.summary.label, 'zh-CN'))
  const selectedCluster = request.cluster ? groupById.get(request.cluster) : undefined
  const members = pageOf(selectedCluster ? people.filter(item => selectedCluster.ids.has(item.id)) : [], request.memberPage)
  const relationList = selectedCluster?.pairs ?? (mode === 'person' ? recent : summaries)
  const relations = pageOf(relationList, request.relationPage)
  const clusters = pageOf(groups.map(item => item.summary), request.clusterPage)
  const selectedPair = request.relation ? pairs.get(request.relation) : undefined
  const detailRows = selectedPair?.rows ?? (person ? visibleRecords.filter(item => item.id === person.id) : [])
  const detailOrder = detailRows.slice().sort((a, b) => (recordChapter(b) ?? -1) - (recordChapter(a) ?? -1) || b.line - a.line)
  const anchored = request.evidenceId ? detailOrder.findIndex(item => item.id === request.evidenceId || item.evidenceId === request.evidenceId) : -1
  const details = pageOf(detailOrder, anchored >= 0 ? Math.floor(anchored / 20) : request.evidencePage, 20)
  const transitions = pageOf(selectedPair?.summary.transitions ?? [], request.transitionPage, 20)
  const evidence = details.items.flatMap(item => { const found = sourceById.get(item.evidenceId ?? ''); return found ? [found] : [] })
  const sceneNodes = new Map<string, StoryGraphRecord>(), sceneEdges: StoryGraphEdge[] = []
  if (person && mode !== 'all') sceneNodes.set(person.id, person)
  const sceneRelations = mode === 'all' && !selectedCluster ? [] : selectedPair ? [selectedPair.summary, ...relations.items.filter(item => item.id !== selectedPair.summary.id)] : relations.items
  for (const pair of sceneRelations.slice(0, mode === 'person' ? selectedCluster ? 8 : 5 : 20)) {
    if (new Set([...sceneNodes.keys(), pair.from, pair.to]).size > 10) continue
    for (const id of [pair.from, pair.to]) if (personById.has(id)) sceneNodes.set(id, personById.get(id)!)
    const edge = pairs.get(pair.id)!.rows.at(-1)!
    sceneEdges.push({ ...edge, id: pair.id, preview: '', qualifier: pair.latest?.qualifier,
      label: `${pair.latest?.label ?? edge.label} · 最近记载` })
  }
  if (!selectedCluster && mode !== 'chapter' && person) for (const cluster of clusters.items.slice(0, mode === 'all' ? 8 : 3)) {
    const id = 'cluster:' + cluster.id
    sceneNodes.set(id, { ...person, id, kind: '星团', label: cluster.label, preview: '', status: `${cluster.members}人 · ${cluster.evidence}条证据`, evidenceId: undefined })
    // A visual connector is only added by the canvas component, never to relation facts.
  }
  const unassigned = pageOf((source.unassigned ?? []).filter(item => graphRecordVisible(item, filter)
    && (!needle || `${item.from} ${item.to} ${item.label}`.toLocaleLowerCase().includes(needle))), request.unassignedPage, 20)
  for (const item of unassigned.items) { const found = sourceById.get(item.evidenceId); if (found) evidence.push(found) }
  const graph: StoryGraph = { bookId: source.bookId, bookName: source.bookName, maxChapter: source.maxChapter,
    records: [...sceneNodes.values()], edges: sceneEdges, events: [], evidence: [], warnings: source.warnings.slice(0, 100), index: source.index, format: source.format, fingerprint: source.fingerprint }
  // Full transition histories stay in the cached projection. Only their own page is sent.
  const summaryOnly = (item: ReaderRelation): ReaderRelation => ({ ...item, labels: item.labels.slice(0, 3), transitions: [] })
  return { graph, filter, mode, person, catalog, relations: { ...relations, items: relations.items.map(summaryOnly) }, clusters, members, cluster: selectedCluster?.summary,
    selectedRelation: selectedPair ? summaryOnly(selectedPair.summary) : undefined, transitions, groupFields, groupField, foldAfter,
    details, evidence, unassigned, recordChapters: prepared.recordChapters,
    totals: { entities: people.length, records: visibleRecords.length, relations: summaries.length, evidence: projected.edges.length } }
}
