import { documentHash, parseDocument } from '@webnovel/core'
import type { FileRef, SourceLocation } from './types'

export interface GraphEvidence {
  readonly id: string
  readonly ownerId: string
  readonly source: FileRef
  readonly sourceKind: 'world-head' | 'world-append' | 'timeline' | 'ledger'
  readonly fields: Readonly<Record<string, unknown>>
  /** Explicitly referenced finalized chapters; these are not quote locations. */
  readonly relatedChapters?: readonly FileRef[]
  readonly location: SourceLocation
  readonly rawFrom: number
  readonly rawTo: number
  readonly byteFrom: number
  readonly byteTo: number
  /** Normalized offsets of newlines which occupied two bytes/code units in the original. */
  readonly crlf?: readonly number[]
  readonly recordChapter?: number
  readonly storyTime?: string
  readonly historyBasis: 'recorded' | 'current-only' | 'unknown'
  readonly eligible: boolean
}

/** Positions always refer to this exact raw snapshot, including its BOM and CRLF. */
export function sourceLines(raw: string): readonly number[] {
  const starts = [0]
  for (let at = raw.indexOf('\n'); at !== -1; at = raw.indexOf('\n', at + 1)) starts.push(at + 1)
  return starts
}

export function sourceLocation(raw: string, from: number, to: number): SourceLocation {
  const content = raw.slice(from, to)
  const normalized = raw.replace(/\r\n/g, '\n')
  const doc = parseDocument(raw)
  const bodyOffset = doc.ok ? normalized.length - doc.data.body.length : 0
  const normalizedFrom = raw.slice(0, from).replace(/\r\n/g, '\n').length
  return { hash: documentHash(raw), from: normalizedFrom - bodyOffset, to: normalizedFrom - bodyOffset + content.replace(/\r\n/g, '\n').length,
    quote: content.replace(/\r\n/g, '\n'), startLine: raw.slice(0, from).split('\n').length,
    endLine: raw.slice(0, Math.max(from, to - 1)).split('\n').length }
}

export function evidenceRange(raw: string, startLine: number, endBeforeLine: number): Pick<GraphEvidence, 'location' | 'rawFrom' | 'rawTo' | 'byteFrom' | 'byteTo' | 'crlf'> {
  return createEvidenceRanges(raw).range(startLine, endBeforeLine)
}

/** Parse/hash a source file once, then locate all its records in linear total work. */
export function createEvidenceRanges(raw: string) {
  const starts = sourceLines(raw), bytes: number[] = [0], removed: number[] = [0]
  for (let line = 1; line < starts.length; line++) {
    const part = raw.slice(starts[line - 1], starts[line])
    bytes.push(bytes[line - 1]! + Buffer.byteLength(part))
    removed.push(removed[line - 1]! + (part.endsWith('\r\n') ? 1 : 0))
  }
  const normalized = raw.replace(/\r\n/g, '\n'), doc = parseDocument(raw), hash = documentHash(raw)
  const bodyOffset = doc.ok ? normalized.length - doc.data.body.length : 0
  const range = (startLine: number, endBeforeLine: number): Pick<GraphEvidence, 'location' | 'rawFrom' | 'rawTo' | 'byteFrom' | 'byteTo' | 'crlf'> => {
  const start = starts[Math.max(0, startLine - 1)] ?? raw.length
  const end = starts[Math.max(0, endBeforeLine - 1)] ?? raw.length
  const chunk = raw.slice(start, end)
  const rawFrom = start + chunk.length - chunk.trimStart().length
  const rawTo = Math.max(rawFrom, end - (chunk.length - chunk.trimEnd().length))
  const crlf: number[] = []
  for (const match of raw.slice(rawFrom, rawTo).matchAll(/\r\n/g)) crlf.push(match.index - crlf.length)
  const prefix = raw.slice(start, rawFrom), quote = raw.slice(rawFrom, rawTo).replace(/\r\n/g, '\n')
  const from = start - (removed[startLine - 1] ?? removed.at(-1)!) + prefix.replace(/\r\n/g, '\n').length - bodyOffset
  const actualLine = startLine + prefix.split('\n').length - 1
  const byteFrom = (bytes[startLine - 1] ?? Buffer.byteLength(raw)) + Buffer.byteLength(prefix)
  return { location: { hash, from, to: from + quote.length, quote, startLine: actualLine, endLine: actualLine + quote.split('\n').length - 1 }, rawFrom, rawTo, ...(crlf.length ? { crlf } : {}),
    byteFrom, byteTo: byteFrom + Buffer.byteLength(raw.slice(rawFrom, rawTo)) }
  }
  return { hash, range, endLine: starts.length + 1, bodyStartLine: normalized.slice(0, bodyOffset).split('\n').length }
}

export function bodyStartLine(raw: string): number {
  const doc = parseDocument(raw), normalized = raw.replace(/\r\n/g, '\n')
  return doc.ok ? normalized.slice(0, normalized.length - doc.data.body.length).split('\n').length : 1
}
