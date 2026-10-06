// Reports Simplified Technical Chinese coverage for docs/user.
// The banned-synonym list is the glossary table in docs/maintenance/writing-style.md.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { root as defaultRoot } from './version.mjs'

const STEP_LIMIT = 40
const NOTE_LIMIT = 50
const MIN_CHARS = 6

const chars = text => [...text].length

function stripInline(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`[^`]*`/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/「[^」]*」/g, '')
    .replace(/“[^”]*”/g, '')
}

function maskAllowances(text, allowances) {
  let masked = text
  for (const phrase of allowances) masked = masked.split(phrase).join(' '.repeat(chars(phrase)))
  return masked
}

function sentencesOf(text, kind, line) {
  const found = []
  for (const part of text.split(/[。！？；\n]+/)) {
    const sentence = part.trim()
    if (chars(sentence) < MIN_CHARS) continue
    found.push({ text: sentence, kind, length: chars(sentence), line })
  }
  return found
}

export function loadGlossary(root = defaultRoot) {
  const text = fs.readFileSync(path.join(root, 'docs/maintenance/writing-style.md'), 'utf8').replace(/^\uFEFF/, '')
  const section = text.split(/^## 术语表\s*$/m)[1]
  if (!section) throw new Error('docs/maintenance/writing-style.md is missing a ## 术语表 section')
  const body = section.split(/^## /m)[0]
  const banned = []
  const allowances = []
  let headers = null
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
    if (cells.every(cell => /^:?-+:?$/.test(cell))) continue
    if (!headers) {
      headers = cells
      continue
    }
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']))
    const avoided = row['不要写'] ?? ''
    if (avoided && avoided !== '—' && avoided !== '-') {
      for (const term of avoided.split('、').map(item => item.trim()).filter(item => item && item !== '—' && item !== '-')) {
        banned.push({ term, preferred: row['术语'] })
      }
    }
    for (const match of (row['备注'] ?? '').matchAll(/「([^」]+)」/g)) allowances.push(match[1])
  }
  allowances.sort((left, right) => chars(right) - chars(left))
  return { banned, allowances }
}

export function analyzeMarkdown(text, glossary) {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const banned = glossary?.banned ?? []
  const allowances = glossary?.allowances ?? []
  const segments = []
  const termHits = []
  let fence = false
  let quote = null
  let previousKind = null

  const scanTerms = (visible, line) => {
    const masked = maskAllowances(visible, allowances)
    for (const item of banned) {
      if (masked.includes(item.term)) termHits.push({ line, term: item.term, preferred: item.preferred })
    }
  }

  const push = (raw, line, kind) => {
    let content = stripInline(raw)
    if (kind === 'explain' && /^\s*\|/.test(raw)) content = content.replace(/^\|/, '').replace(/\|$/, '').replace(/\|/g, ' ')
    scanTerms(content, line)
    segments.push({ kind, text: content, line })
    previousKind = kind
  }

  for (let index = 0; index < lines.length; index++) {
    const lineNo = index + 1
    const raw = lines[index]
    if (/^```/.test(raw.trim())) {
      fence = !fence
      quote = null
      previousKind = null
      continue
    }
    if (fence) continue
    if (!raw.trim()) {
      quote = null
      previousKind = null
      segments.push({ kind: 'break' })
      continue
    }
    const quoted = /^> ?(.*)$/.exec(raw)
    if (quoted) {
      if (!quote) quote = /^\[![A-Za-z]+\]/.test(quoted[1].trim()) ? 'alert' : 'prompt'
      if (quote === 'prompt') continue
      push(quoted[1].replace(/^\[![A-Za-z]+\]\s*/, ''), lineNo, 'explain')
      continue
    }
    quote = null
    if (/^#{1,6}\s/.test(raw)) continue
    if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(raw)) continue
    if (/^\d+\.\s+/.test(raw)) {
      push(raw.replace(/^\d+\.\s+/, ''), lineNo, 'step')
      continue
    }
    if (/^\s+\d+\.\s+/.test(raw) || /^\s+[-*]\s+/.test(raw)) {
      push(raw.trim().replace(/^\d+\.\s+/, '').replace(/^[-*]\s+/, ''), lineNo, 'explain')
      continue
    }
    if (/^\s+\S/.test(raw) && previousKind === 'step') {
      push(raw.trim(), lineNo, 'step')
      continue
    }
    push(raw, lineNo, 'explain')
  }

  const sentences = []
  let paragraphCount = 0
  let longParagraphs = 0
  const flush = () => {
    if (paragraphCount > 6) longParagraphs++
    paragraphCount = 0
  }
  for (const segment of segments) {
    if (segment.kind === 'break') {
      flush()
      continue
    }
    const found = sentencesOf(segment.text, segment.kind, segment.line)
    paragraphCount += found.length
    sentences.push(...found)
  }
  flush()

  const steps = sentences.filter(item => item.kind === 'step')
  const notes = sentences.filter(item => item.kind === 'explain')
  const stepWithinLimit = steps.filter(item => item.length <= STEP_LIMIT).length
  const explainWithinLimit = notes.filter(item => item.length <= NOTE_LIMIT).length
  let doubleNegatives = 0
  for (const item of sentences) doubleNegatives += [...item.text.matchAll(/不能不|不是不|并非不/g)].length
  return {
    sentences, steps, notes, termHits, longParagraphs, doubleNegatives,
    passive: sentences.filter(item => item.text.includes('被')).length,
    stepWithinLimit, explainWithinLimit,
    stepRatio: steps.length ? stepWithinLimit / steps.length : 1,
    explainRatio: notes.length ? explainWithinLimit / notes.length : 1,
  }
}

function readGuides(root) {
  return fs.readdirSync(path.join(root, 'docs/user')).filter(file => file.endsWith('.md')).sort()
}

export function report(root = defaultRoot) {
  const glossary = loadGlossary(root)
  const docs = readGuides(root).map(file => {
    const text = fs.readFileSync(path.join(root, 'docs/user', file), 'utf8')
    const analysis = analyzeMarkdown(text, glossary)
    return { file: `docs/user/${file}`, ...analysis, termHits: analysis.termHits.map(hit => ({ ...hit, file: `docs/user/${file}` })) }
  })
  const steps = docs.flatMap(doc => doc.steps)
  const notes = docs.flatMap(doc => doc.notes)
  const stepWithinLimit = docs.reduce((sum, doc) => sum + doc.stepWithinLimit, 0)
  const explainWithinLimit = docs.reduce((sum, doc) => sum + doc.explainWithinLimit, 0)
  return {
    docs, glossary,
    stepRatio: steps.length ? stepWithinLimit / steps.length : 1,
    explainRatio: notes.length ? explainWithinLimit / notes.length : 1,
    stepWithinLimit, explainWithinLimit, steps, notes,
    termHits: docs.flatMap(doc => doc.termHits),
  }
}

export function checkFailures(result) {
  const failures = []
  if (result.termHits.length) {
    const lines = result.termHits.map(hit => `${hit.file}:${hit.line} ${hit.term} → ${hit.preferred}`)
    failures.push(`术语命中 ${result.termHits.length} 处：\n${lines.join('\n')}`)
  }
  if (result.stepRatio < 0.8) failures.push(`步骤句 ≤${STEP_LIMIT} 字占比 ${(result.stepRatio * 100).toFixed(1)}%，低于 80%`)
  if (result.explainRatio < 0.8) failures.push(`说明句 ≤${NOTE_LIMIT} 字占比 ${(result.explainRatio * 100).toFixed(1)}%，低于 80%`)
  return failures
}

export function formatReport(result) {
  const percent = (ratio, within, total) => `${(ratio * 100).toFixed(0)}%（${within}/${total}）`
  const lines = []
  for (const doc of result.docs) {
    lines.push(doc.file)
    lines.push(`  句数 ${doc.sentences.length}（步骤 ${doc.steps.length}，说明 ${doc.notes.length}）`)
    lines.push(`  步骤句 ≤${STEP_LIMIT} 字 ${percent(doc.stepRatio, doc.stepWithinLimit, doc.steps.length)}`)
    lines.push(`  说明句 ≤${NOTE_LIMIT} 字 ${percent(doc.explainRatio, doc.explainWithinLimit, doc.notes.length)}`)
    lines.push(`  术语命中 ${doc.termHits.length}`)
    for (const hit of doc.termHits) lines.push(`    ${hit.line}: ${hit.term} → ${hit.preferred}`)
    lines.push(`  「被」字句 ${doc.passive}`)
    lines.push(`  双重否定 ${doc.doubleNegatives}`)
    lines.push(`  超过 6 句的段落 ${doc.longParagraphs}`)
  }
  lines.push('合计')
  lines.push(`  步骤句 ≤${STEP_LIMIT} 字 ${percent(result.stepRatio, result.stepWithinLimit, result.steps.length)}`)
  lines.push(`  说明句 ≤${NOTE_LIMIT} 字 ${percent(result.explainRatio, result.explainWithinLimit, result.notes.length)}`)
  lines.push(`  术语命中 ${result.termHits.length}`)
  return lines.join('\n')
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const rootFlag = process.argv.indexOf('--root')
  const result = report(rootFlag > 0 ? path.resolve(process.argv[rootFlag + 1]) : defaultRoot)
  console.log(formatReport(result))
  if (process.argv.includes('--check')) {
    const failures = checkFailures(result)
    if (failures.length) {
      console.error(failures.join('\n'))
      process.exitCode = 1
    }
  }
}
