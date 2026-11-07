/** Raw ranges are used for migration. Query output is deliberately not a source. */
import { parseDocument } from '../repo/frontmatter'

export class UpgradeRuleError extends Error {
  constructor(readonly relative: string, message: string, readonly line?: number, readonly field?: string) { super(message) }
}

export interface RawLine {
  readonly text: string
  readonly raw: string
  readonly start: number
  readonly end: number
  readonly number: number
}

export interface RawSection {
  readonly title: string
  readonly heading: RawLine
  readonly lines: readonly RawLine[]
  readonly end: number
}

export function rawLines(text: string): RawLine[] {
  return [...text.matchAll(/[^\n]*\n|[^\n]+$/g)].map((match, index) => ({
    text: match[0].replace(/\r?\n$/, ''), raw: match[0],
    start: match.index, end: match.index + match[0].length, number: index + 1,
  }))
}

export function documentBodyOffset(relative: string, text: string): number {
  const parsed = parseDocument(text)
  if (!parsed.ok) throw new UpgradeRuleError(relative, parsed.detail)
  const lines = rawLines(text)
  if (lines[0]?.text.replace(/^\uFEFF/, '') !== '---') return 0
  const closing = lines.findIndex((line, index) => index > 0 && line.text === '---')
  if (closing < 0) throw new UpgradeRuleError(relative, '文件头边界无法核实')
  return lines[closing]!.end
}

/** Only unindented, unfenced top-level sections can identify a source entry. */
export function rawSections(relative: string, text: string, start = documentBodyOffset(relative, text)): RawSection[] {
  const result: { title: string; heading: RawLine; lines: RawLine[]; end: number }[] = []
  let fence: { mark: string; length: number } | undefined
  for (const line of rawLines(text).filter(item => item.start >= start)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.text)
    if (fence) {
      if (marker && marker[1]![0] === fence.mark && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = undefined
    } else if (marker) fence = { mark: marker[1]![0]!, length: marker[1]!.length }
    else {
      if (result.length && /^#[ \t]+/.test(line.text)) throw new UpgradeRuleError(relative, '条目之后含文件级标题，无法把后记唯一归属到条目', line.number)
      const heading = /^##[ \t]+(.+?)[ \t]*$/.exec(line.text)
      if (heading) {
        if (result.length) result.at(-1)!.end = line.start
        result.push({ title: heading[1]!, heading: line, lines: [], end: text.length })
        continue
      }
    }
    result.at(-1)?.lines.push(line)
  }
  if (fence) throw new UpgradeRuleError(relative, '围栏未闭合，无法证明条目及正文边界')
  return result
}

export interface RawField { readonly name: string; readonly value: string; readonly line: RawLine }

export function rawField(line: RawLine): RawField | undefined {
  const match = /^[ \t]*(?:[-*][ \t]*)?([^：:\r\n]+)[：:][ \t]*(.*?)[ \t]*$/.exec(line.text)
  return match ? { name: match[1]!.trim(), value: match[2]!.trim(), line } : undefined
}

export function uniqueFields(relative: string, lines: readonly RawLine[], allowed: readonly string[]): RawField[] {
  const fields: RawField[] = []
  for (const line of lines) {
    if (!line.text.trim()) continue
    const field = rawField(line)
    if (!field || !allowed.includes(field.name)) throw new UpgradeRuleError(relative, '旧字段区存在无法映射的内容，保留原文', line.number)
    if (fields.some(item => item.name === field.name)) throw new UpgradeRuleError(relative, `字段重复：${field.name}；不能通过去重选择原值`, line.number, field.name)
    fields.push(field)
  }
  return fields
}

export function proseBoundary(relative: string, section: RawSection): number {
  const cut = section.lines.findIndex(line => /^###[ \t]+正文[ \t]*$/.test(line.text))
  if (cut < 0) throw new UpgradeRuleError(relative, '旧条目缺少明确正文边界', section.heading.number)
  return cut
}

export function rangeEvidence(text: string, start: number, end: number): string {
  return `UTF-8字节范围 ${Buffer.byteLength(text.slice(0, start))}–${Buffer.byteLength(text.slice(0, end))}`
}

export function applyRawEdits(text: string, edits: readonly { start: number; end: number; value: string }[]): string {
  let result = text
  let next = text.length
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    if (edit.start < 0 || edit.end < edit.start || edit.end > next) throw new Error('迁移原文范围重叠或越界')
    result = result.slice(0, edit.start) + edit.value + result.slice(edit.end)
    next = edit.start
  }
  return result
}

/** Find the actual closing label bracket, without touching the label or description. */
export function indexDestinationStart(line: string): number | undefined {
  let depth = 1
  for (let index = 3; index < line.length; index++) {
    if (line[index] === '\\') { index++; continue }
    if (line[index] === '[') depth++
    if (line[index] === ']' && --depth === 0) return line[index + 1] === '(' ? index + 2 : undefined
  }
  return undefined
}
