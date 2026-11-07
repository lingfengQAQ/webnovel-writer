/** Historical syntax for book maintenance and author assets (outside book upgrades). */
import { validateSegment } from './paths'

function validFilename(filename: string): boolean {
  return filename.endsWith('.md') && validateSegment(filename.slice(0, -3)).length === 0
}

export interface MemoryIndexLinks {
  readonly filenames: readonly string[]
  readonly problems: readonly string[]
}

function destinationStart(line: string): number | undefined {
  let depth = 1
  for (let i = 3; i < line.length; i++) {
    const character = line[i]
    if (character === '\\') { i++; continue }
    if (character === '[') depth++
    if (character === ']' && --depth === 0) return line[i + 1] === '(' ? i + 2 : undefined
  }
  return undefined
}

function rawFilename(destination: string): string | undefined {
  // Old writers did not escape even unmatched parentheses. Accept only an
  // unambiguous old row boundary; never guess using whichever file exists.
  const candidates: string[] = []
  for (const match of destination.matchAll(/\.md\)(?=\s*(?:$|—(?:\s|$)))/g)) {
    const filename = destination.slice(0, match.index + 3)
    if (validFilename(filename)) candidates.push(filename)
  }
  if (candidates.length > 1) return undefined
  if (candidates.length === 1) return candidates[0]
  let depth = 1
  for (let i = 0; i < destination.length; i++) {
    if (destination[i] === '(') depth++
    if (destination[i] === ')' && --depth === 0) {
      const filename = destination.slice(0, i)
      if (validFilename(filename)) return filename
      break
    }
  }
  return undefined
}

function linkFilename(line: string): string | undefined {
  const start = destinationStart(line)
  if (start === undefined) return undefined
  const destination = line.slice(start)
  if (!destination.startsWith('<')) return rawFilename(destination)
  const encoded = /^<\.\/((?:[a-zA-Z0-9_.~-]|%[a-fA-F0-9]{2})+)>\)/.exec(destination)?.[1]
  if (encoded === undefined) return undefined
  try {
    // Only the explicit angle+./ form is URI-encoded. Bare legacy %41.md
    // names stay literal, and encoded %2541.md is decoded exactly once.
    const filename = decodeURIComponent(encoded)
    return validFilename(filename) ? filename : undefined
  } catch { return undefined }
}

export function parseLegacyMemoryIndexLinks(text: string): MemoryIndexLinks {
  const filenames: string[] = []
  const problems: string[] = []
  for (const [index, line] of text.replace(/\r\n/g, '\n').split('\n').entries()) {
    if (!line.startsWith('- [')) continue
    // Legacy wiki references are material rows, not filename-bearing inline links.
    if (destinationStart(line) === undefined && /^- \[\[[^\]\r\n]+\]\](?!\()/.test(line)) continue
    const filename = linkFilename(line)
    if (filename === undefined) problems.push(`第${index + 1}行链接无效或不明确`)
    else filenames.push(filename)
  }
  return { filenames, problems }
}
