/** Reference-library data never participates in a target book's fact graph. */
export const REFERENCE_PROTOCOL = 'reference-1'
export const PARSE_VERSION = 'txt-epub-1'
export const REFERENCE_LIMITS = { sourceBytes: 64 * 1024 * 1024, entries: 20_000, entryBytes: 32 * 1024 * 1024, expandedBytes: 256 * 1024 * 1024, batchChars: 6000, overlapChars: 200, outputChars: 48_000 } as const
export class ReferenceError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ReferenceError' }
}
export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030' | 'big5'
export interface ParseOptions { encoding?: TextEncoding }
export interface SourceLocation {
  char: number
  line?: number
  byteStart?: number
  byteEnd?: number
  href?: string
  anchor?: string
  node?: number
}
export interface ReadingUnit {
  id: string
  title: string
  text: string
  linear: boolean
  locations: SourceLocation[]
  links: { at: number; href: string; anchor?: string }[]
}
export interface SourceIssue { code: string; message: string; unitId?: string; blocking: boolean }
export interface ParsedSource {
  format: 'txt' | 'epub'
  encoding: string
  units: ReadingUnit[]
  issues: SourceIssue[]
}
export interface SourceMetadata {
  title: string
  author: string
  translator?: string
  edition: string
  acquiredFrom: string
  allowedUses: string
  basis: string
  basisKind: 'user-declaration' | 'checkable-license'
}
export interface ReferenceRoute { provider: string; model: string; service: string }
export interface ReferenceRange { unitId: string; start: number; end: number }
export interface Evidence extends ReferenceRange { id: string; hash: string }
export interface Observation {
  kind: 'event' | 'disclosure' | 'knowledge' | 'relationship' | 'rhythm'
  statement: string
  actor: string
  eventOrder: string
  disclosureOrder: string
  characterKnowledge: string
  readerKnowledge: string
  evidence: number[]
}
export interface MechanismDraft {
  title: string
  tags: string[]
  observation: string
  explanation: string
  expectation: string
  choicesAndConsequences: string
  conditions: string
  failures: string
  questions: string
  noCopy: string
  unknowns: string
  evidence: number[]
}
export interface Extraction {
  evidence: { start: number; end: number; quote: string }[]
  observations: Observation[]
  hypotheses: { statement: string; evidence: number[] }[]
  openQuestions: string[]
  mechanisms: MechanismDraft[]
}
export interface BatchResult { extraction: Extraction; evidence: Evidence[] }
export interface ReferenceBatch {
  id: string
  revision: string
  range: ReferenceRange
  readStart: number
  dependency?: { id: string; hash: string }
  state: 'pending' | 'running' | 'completed' | 'failed' | 'stale'
  attempt?: string
  resultHash?: string
  route?: ReferenceRoute
  error?: string
}
export interface ReferencePlan {
  id: string
  revision: string
  metadataHash: string
  route: ReferenceRoute
  ranges: ReferenceRange[]
  batches: string[]
  allowed: boolean
  createdAt: string
}
export interface MechanismRecord {
  id: string
  version: number
  revision: string
  hash: string
  batchId: string
  resultHash: string
  evidence: string[]
  authorEdited?: boolean
}
export interface SourceRevision {
  sourceHash: string
  parsedHash: string
  options: ParseOptions
  parseVersion: string
}
export interface ReferenceManifest {
  schemaVersion: 1
  id: string
  currentRevision: string
  metadata: SourceMetadata
  revisions: Record<string, SourceRevision>
  plans: Record<string, ReferencePlan>
  batches: Record<string, ReferenceBatch>
  mechanisms: Record<string, MechanismRecord[]>
  report?: { path: string; hash: string; inputHash: string }
}
export interface ModelInput { system: string; text: string; route: ReferenceRoute; maxOutputTokens: number }
/** Trusted host route lookup, never provider/model supplied by the model itself. */
export interface ModelRunner {
  route(): Promise<ReferenceRoute>
  maxInputChars(): Promise<number>
  run(input: ModelInput, signal: AbortSignal): Promise<string>
}
