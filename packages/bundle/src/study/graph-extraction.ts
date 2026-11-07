import { documentHash, type GraphModelInput, type GraphModelProvider } from '@webnovel/core'
import type { GraphEvidence } from './graph-evidence'
import type { StoryGraph, StoryGraphEdge } from './graph-types'
import type { SourceLocation } from './types'

export const GRAPH_PROMPT_VERSION = 'settled-evidence-v4'
export interface ExtractedRelation {
  readonly from: string
  readonly to: string
  readonly relation: string
  readonly qualifier: 'asserted' | 'negated' | 'reported' | 'uncertain'
  readonly quote: string
  readonly offset: number
  readonly assigned: boolean
}
export interface GraphExtraction {
  readonly version: string
  readonly key: string
  readonly evidenceId: string
  readonly sourceHash: string
  readonly identityHash: string
  readonly revision: string
  readonly model: string
  readonly relations: readonly ExtractedRelation[]
  readonly rejected: number
  readonly error?: string
}
const identities = new WeakMap<StoryGraph, string>()
export function graphIdentityHash(graph: StoryGraph): string {
  let value = identities.get(graph)
  if (!value) { value = documentHash(JSON.stringify(graph.entities ?? [])); identities.set(graph, value) }
  return value
}
interface NameTrie { next: Map<string, NameTrie>; ids: Set<string> }
const nameIndexes = new WeakMap<StoryGraph, NameTrie>()
function namedEntities(graph: StoryGraph, evidence: GraphEvidence) {
  let index = nameIndexes.get(graph)
  if (!index) {
    index = { next: new Map(), ids: new Set() }
    for (const entity of graph.entities ?? []) for (const name of [entity.id, entity.label, ...entity.aliases].filter(Boolean)) {
      let node = index
      for (const char of name) { let next = node.next.get(char); if (!next) { next = { next: new Map(), ids: new Set() }; node.next.set(char, next) }; node = next }
      node.ids.add(entity.id)
    }
    nameIndexes.set(graph, index)
  }
  const mentioned = new Set([evidence.ownerId]), text = [...evidence.location.quote + '\n' + JSON.stringify(evidence.fields)]
  for (let from = 0; from < text.length; from++) {
    let node: NameTrie | undefined = index
    for (let at = from; at < text.length && node; at++) { node = node.next.get(text[at]!); if (node) for (const id of node.ids) mentioned.add(id) }
  }
  // Keep every ambiguous match. Reducing context must never choose one namesake.
  return (graph.entities ?? []).filter(entity => mentioned.has(entity.id))
}
export function extractionInput(graph: StoryGraph, evidence: GraphEvidence): GraphModelInput {
  return { sourceKind: evidence.sourceKind, fields: evidence.fields, text: evidence.location.quote,
    entities: namedEntities(graph, evidence).map(({ id, label, aliases }) => ({ id, label, aliases })) }
}
export function extractionKey(graph: StoryGraph, evidence: GraphEvidence, provider: GraphModelProvider): string {
  return documentHash(JSON.stringify([GRAPH_PROMPT_VERSION, provider.metadata.revision, extractionInput(graph, evidence)]))
}
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** Validate the original quote and entity identity before an extracted relation can become visible. */
export function validateExtraction(data: unknown, input: GraphModelInput): { relations: ExtractedRelation[]; rejected: number } {
  const raw = object(data)
  if (!raw || !Array.isArray(raw.relations) || raw.relations.length > 100 || Object.keys(raw).some(k => k !== 'relations')) throw new Error('抽取结果结构无效')
  const aliases = new Map<string, Set<string>>()
  for (const entity of input.entities) for (const name of [entity.id, entity.label, ...entity.aliases]) {
    const values = aliases.get(name) ?? new Set<string>(); values.add(entity.id); aliases.set(name, values)
  }
  const resolve = (name: string, quote: string) => {
    const ids = aliases.get(name)
    if (ids?.size !== 1) return undefined
    const id = [...ids][0]!, entity = input.entities.find(item => item.id === id)!
    // A model-supplied canonical id must not silently settle an ambiguous name in the quote.
    if ([...quote.matchAll(/\[\[([^\]\n]+)\]\]/g)].some(match => match[1]!.split('|')[0]!.replace(/@\d+$/, '') === id.replace(/^world:/, ''))) return id
    const mentioned = [entity.label, ...entity.aliases].filter(value => value && quote.includes(value))
    return mentioned.length && mentioned.every(value => aliases.get(value)?.size === 1) ? id : undefined
  }
  const relations: ExtractedRelation[] = [], seen = new Set<string>()
  let rejected = 0
  for (const entry of raw.relations) {
    const r = object(entry)
    if (!r || Object.keys(r).some(key => !['from', 'to', 'relation', 'qualifier', 'quote', 'occurrence'].includes(key))
      || ['from', 'to', 'relation', 'quote'].some(key => typeof r[key] !== 'string' || !(r[key] as string).trim())
      || !['asserted', 'negated', 'reported', 'uncertain'].includes(String(r.qualifier))
      || String(r.relation).length > 80 || String(r.from).length > 512 || String(r.to).length > 512) { rejected++; continue }
    const quote = r.quote as string, occurrences: number[] = []
    for (let at = input.text.indexOf(quote); at !== -1; at = input.text.indexOf(quote, at + 1)) occurrences.push(at)
    const occurrence = r.occurrence ?? (occurrences.length === 1 ? 0 : undefined)
    if (!Number.isSafeInteger(occurrence) || Number(occurrence) < 0 || occurrences[Number(occurrence)] === undefined) { rejected++; continue }
    const offset = occurrences[Number(occurrence)]!
    const splitSurrogate = (at: number) => /[\uD800-\uDBFF]/.test(input.text[at - 1] ?? '') && /[\uDC00-\uDFFF]/.test(input.text[at] ?? '')
    if (splitSurrogate(offset) || splitSurrogate(offset + quote.length)) { rejected++; continue }
    const from = resolve(r.from as string, quote), to = resolve(r.to as string, quote)
    if (from && from === to) { rejected++; continue }
    const relation = { from: from ?? r.from as string, to: to ?? r.to as string, relation: (r.relation as string).trim(),
      qualifier: r.qualifier as ExtractedRelation['qualifier'], quote, offset, assigned: !!from && !!to }
    const key = JSON.stringify(relation)
    if (!seen.has(key)) { seen.add(key); relations.push(relation) }
  }
  return { relations, rejected }
}

export function relationLocation(evidence: GraphEvidence, relation: ExtractedRelation): SourceLocation {
  const before = evidence.location.quote.slice(0, relation.offset)
  const startLine = evidence.location.startLine + before.split('\n').length - 1
  return { hash: evidence.location.hash, from: evidence.location.from + relation.offset,
    to: evidence.location.from + relation.offset + relation.quote.length, quote: relation.quote,
    startLine, endLine: startLine + relation.quote.split('\n').length - 1 }
}

export function overlayExtractions(graph: StoryGraph, extractions: readonly GraphExtraction[]): StoryGraph {
  const identity = graphIdentityHash(graph), additions: StoryGraphEdge[] = []
  const sources = [...graph.evidence ?? []], unassigned: NonNullable<StoryGraph['unassigned']>[number][] = []
  const sourceById = new Map(graph.evidence?.map(item => [item.id, item]))
  const ownerByEvidence = new Map(graph.records.map(item => [item.evidenceId, item]))
  const known = new Set(graph.entities?.map(entity => entity.id))
  for (const extracted of extractions) {
    if (extracted.version !== GRAPH_PROMPT_VERSION) continue
    const evidence = sourceById.get(extracted.evidenceId)
    if (!evidence || extracted.sourceHash !== evidence.location.hash || extracted.identityHash !== identity || extracted.error) continue
    const owner = ownerByEvidence.get(evidence.id)
    if (!owner) continue
    if (extracted.relations.some(relation => !relation || typeof relation.from !== 'string' || typeof relation.to !== 'string'
      || typeof relation.relation !== 'string' || relation.relation.length > 80 || typeof relation.quote !== 'string' || !relation.quote
      || !['asserted', 'negated', 'reported', 'uncertain'].includes(relation.qualifier)
      || !Number.isSafeInteger(relation.offset) || relation.offset < 0 || typeof relation.assigned !== 'boolean'
      || evidence.location.quote.slice(relation.offset, relation.offset + relation.quote.length) !== relation.quote
      || relation.assigned && (!known.has(relation.from) || !known.has(relation.to) || relation.from === relation.to))) continue
    for (const [index, relation] of extracted.relations.entries()) {
      const id = 'extracted:' + evidence.id + ':' + index
      const location = relationLocation(evidence, relation)
      const end = relation.offset + relation.quote.length
      const beforeStart = (evidence.crlf ?? []).filter(at => at < relation.offset).length
      const beforeEnd = (evidence.crlf ?? []).filter(at => at < end).length
      sources.push({ ...evidence, id, location,
        rawFrom: evidence.rawFrom + relation.offset + beforeStart, rawTo: evidence.rawFrom + end + beforeEnd,
        byteFrom: evidence.byteFrom + Buffer.byteLength(evidence.location.quote.slice(0, relation.offset)) + beforeStart,
        byteTo: evidence.byteFrom + Buffer.byteLength(evidence.location.quote.slice(0, end)) + beforeEnd,
        crlf: (evidence.crlf ?? []).filter(at => at >= relation.offset && at < end).map(at => at - relation.offset) })
      if (!relation.assigned) { unassigned.push({ ...owner, id, from: relation.from, to: relation.to, label: relation.relation, qualifier: relation.qualifier, evidenceId: id, preview: relation.quote }); continue }
      additions.push({ ...owner, id, from: relation.from, to: relation.to, label: relation.relation, preview: relation.quote,
        kind: '沉淀抽取', relation: true, evidenceKind: 'extracted', qualifier: relation.qualifier, evidenceId: id,
        line: location.startLine, model: extracted.model })
    }
  }
  return { ...graph, evidence: sources, edges: [...graph.edges, ...additions], unassigned }
}
