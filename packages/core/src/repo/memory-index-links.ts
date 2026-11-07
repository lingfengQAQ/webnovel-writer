import { validateSegment } from './paths'

function validFilename(filename: string): boolean {
  return filename.endsWith('.md') && validateSegment(filename.slice(0, -3)).length === 0
}

export function memoryIndexLink(label: string, filename: string): string {
  if (!validFilename(filename)) throw new Error('记忆索引目标须为单个合法 Markdown 文件名')
  const escapedLabel = memoryIndexText(label)
  const destination = /[\s()[\]#%&`]/.test(filename)
    ? `<./${encodeURIComponent(filename).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}>`
    : filename
  return `[${escapedLabel}](${destination})`
}

/** Display text stays on one index row; original document fields are untouched. */
export function memoryIndexText(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/[\\[\]()`]/g, '\\$&')
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
  if ([...destination.matchAll(/\.md\)(?=\s*(?:$|—(?:\s|$)))/g)].length > 1) return undefined
  const end = destination.indexOf(')')
  if (end < 0) return undefined
  const filename = destination.slice(0, end)
  return validFilename(filename) && !/[\s()[\]#%&`]/.test(filename) ? filename : undefined
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

export function parseMemoryIndexLinks(text: string): MemoryIndexLinks {
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
