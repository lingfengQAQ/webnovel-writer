import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ChapterKey } from '../derive/scan'
import type { FileOp } from '../repo/atomic'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { applyVersionFields, bumpVersion, extractVersionFields, initialVersion } from '../provenance'
import { assertSegment, LEDGER_KINDS, MEMORY_KINDS, paths } from '../repo/paths'
import { bookMemoryOps, type BookMemoryInput } from '../memory/book'

export const ledgerKinds = LEDGER_KINDS
export const memoryKinds = MEMORY_KINDS
type LedgerKind = (typeof ledgerKinds)[number]
type MemoryKind = (typeof memoryKinds)[number]

export interface SettlementApproval {
  readonly 章节: ChapterKey
  readonly 批准: boolean
  readonly 裁决记录: string
}

export interface SettlementPlan {
  readonly ok: true
  readonly ops: readonly FileOp[]
  readonly 有候选: boolean
}

export type SettlementPlanResult = SettlementPlan | { readonly ok: false; readonly reason: string }

interface Section {
  readonly title: string
  readonly body: string
}

export interface LedgerSection extends Section {
  readonly kind: LedgerKind
}

export interface MemorySection extends Section {
  readonly kind: MemoryKind
}

const candidateFiles = {
  facts: '事实变更.md',
  timeline: '时间线变更.md',
  ledger: '账本变更.md',
  memory: '本书层记忆候选.md',
} as const

const placeholderText = new Set([
  '（无事实变更）',
  '（无时间线变更）',
  '（无账本变更）',
  '（无记忆候选）',
])

const normal = (text: string): string => text.replace(/\r\n/g, '\n').replace(/\n+$/, '')

function readOptional(packageAbs: string, file: string): string {
  try {
    return fs.readFileSync(path.join(packageAbs, file), 'utf-8')
  } catch {
    return ''
  }
}

/**
 * 候选是否无内容。
 *
 * 只有文件级标题(`# 账本变更`)与占位文本算无内容;分类/条目标题(`##` / `###`)
 * 是作者已经写下的结构,即使没有正文也必须进解析走 fail-closed——
 * 静默当空会让作者以为沉淀已发生。报错文案带到分类/条目,便于用通用工具读原文确认。
 */
function bodyIsEmpty(text: string): boolean {
  return normal(text).split('\n').every((line) => {
    const t = line.trim()
    if (t === '' || placeholderText.has(t)) return true
    return /^#(?!#)/.test(t)
  })
}

function assertNoPreamble(lines: readonly string[], label: string): void {
  const firstSection = lines.findIndex((line) => /^##\s+/.test(line.trim()))
  const preamble = lines
    .slice(0, firstSection < 0 ? lines.length : firstSection)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
  if (preamble.length > 0) throw new Error(`${label}存在未分类正文，不猜测归类`)
}

export function parseLedgerSections(text: string): LedgerSection[] {
  const lines = normal(text).split('\n')
  const sections: LedgerSection[] = []
  let kind: LedgerKind | null = null
  let title: string | null = null
  let body: string[] = []

  const flush = (): void => {
    if (kind !== null && title !== null) {
      const value = body.join('\n').trim()
      if (value === '') throw new Error(`账本「${kind}/${title}」正文为空`)
      sections.push({ kind, title, body: value })
    }
    body = []
  }

  assertNoPreamble(lines, '账本变更')
  for (const line of lines) {
    const category = line.match(/^##\s+(.+?)\s*$/)?.[1]?.trim()
    const item = line.match(/^###\s+(.+?)\s*$/)?.[1]?.trim()
    if (category !== undefined) {
      flush()
      if (!(ledgerKinds as readonly string[]).includes(category)) {
        throw new Error(`账本分类未知:${category}`)
      }
      kind = category as LedgerKind
      title = null
      continue
    }
    if (item !== undefined) {
      flush()
      if (kind === null) throw new Error(`账本条目「${item}」缺少分类`)
      title = item
      continue
    }
    if (title !== null) body.push(line)
    else if (line.trim() !== '' && !line.trim().startsWith('#')) {
      throw new Error('账本变更存在未分类正文，不猜测归类')
    }
  }
  flush()
  return sections
}

export function parseMemorySections(text: string): MemorySection[] {
  const lines = normal(text).split('\n')
  const sections: MemorySection[] = []
  let kind: MemoryKind | null = null
  let title: string | null = null
  let body: string[] = []

  const flush = (): void => {
    if (kind !== null && title !== null) {
      const value = body.join('\n').trim()
      if (value === '') throw new Error(`记忆「${kind}/${title}」正文为空`)
      sections.push({ kind, title, body: value })
    }
    body = []
  }

  assertNoPreamble(lines, '本书层记忆候选')
  for (const line of lines) {
    const category = line.match(/^##\s+(.+?)\s*$/)?.[1]?.trim()
    const item = line.match(/^###\s+(.+?)\s*$/)?.[1]?.trim()
    if (category !== undefined) {
      flush()
      if (!(memoryKinds as readonly string[]).includes(category)) {
        throw new Error(`记忆分类未知:${category}`)
      }
      kind = category as MemoryKind
      title = null
      continue
    }
    if (item !== undefined) {
      flush()
      if (kind === null) throw new Error(`记忆条目「${item}」缺少分类`)
      title = item
      continue
    }
    if (title !== null) body.push(line)
    else if (line.trim() !== '' && !line.trim().startsWith('#')) {
      throw new Error('本书层记忆候选存在未分类正文，不猜测归类')
    }
  }
  flush()
  return sections
}

export function parseTimelineSections(text: string): Section[] {
  const lines = normal(text).split('\n')
  const sections: Section[] = []
  let title: string | null = null
  let body: string[] = []

  const flush = (): void => {
    if (title !== null) {
      const value = body.join('\n').trim()
      if (value === '') throw new Error(`时间线事件「${title}」正文为空`)
      if (!/(?:^|\n)\s*[-*]?\s*事件[：:]/m.test(value)) {
        throw new Error(`时间线事件「${title}」缺少事件字段`)
      }
      sections.push({ title, body: value })
    }
    body = []
  }

  assertNoPreamble(lines, '时间线变更')
  for (const line of lines) {
    const item = line.match(/^##\s+(.+?)\s*$/)?.[1]?.trim()
    if (item !== undefined) {
      flush()
      title = item
      continue
    }
    if (title !== null) body.push(line)
    else if (line.trim() !== '' && !line.trim().startsWith('#')) {
      throw new Error('时间线变更存在未分类正文，不猜测归类')
    }
  }
  flush()
  return sections
}

function append(existing: string, block: string): string {
  const base = normal(existing)
  return `${base === '' ? '' : `${base}\n\n`}${block.trim()}\n`
}

/** 事实变更一段:`## <世界书模块>` / `### <条目名>` / 正文(格式规格 §3.4 事实去向)。 */
export interface FactSection {
  readonly module: string
  readonly title: string
  readonly body: string
}

/** 解析事实变更段(§3.4):模块/条目/正文,预校验与沉淀共用同一解析。 */
export function parseFactSections(text: string): FactSection[] {
  const lines = normal(text).split('\n')
  const sections: FactSection[] = []
  let module: string | null = null
  let title: string | null = null
  let body: string[] = []

  const flush = (): void => {
    if (module !== null && title !== null) {
      const value = body.join('\n').trim()
      if (value === '') throw new Error(`事实变更「${module}/${title}」正文为空`)
      sections.push({ module, title, body: value })
    }
    body = []
  }

  assertNoPreamble(lines, '事实变更')
  for (const line of lines) {
    const category = line.match(/^##\s+(.+?)\s*$/)?.[1]?.trim()
    const item = line.match(/^###\s+(.+?)\s*$/)?.[1]?.trim()
    if (category !== undefined) {
      flush()
      if (category === '' || category.includes('/') || category.includes('\\')) {
        throw new Error(`事实变更模块名不合法:${category}`)
      }
      module = category
      title = null
      continue
    }
    if (item !== undefined) {
      flush()
      if (module === null) throw new Error(`事实条目「${item}」缺少模块`)
      title = item
      continue
    }
    if (title !== null) body.push(line)
    else if (line.trim() !== '' && !line.trim().startsWith('#')) {
      throw new Error('事实变更存在未分类正文，不猜测归类')
    }
  }
  flush()
  return sections
}

/**
 * 世界书事实 sink(design §3.4):新建或末尾追加,只增不改。
 * 模块目录不存在即 fail-closed,不猜模块;整包不入档由 planSettlement 的 try/catch 兜住。
 */
function factOps(bookRoot: string, sections: readonly FactSection[], chapter: ChapterKey, mode: SettlementMode): readonly FileOp[] {
  const ops: FileOp[] = []
  const chapterLabel = `第${String(chapter.章).padStart(4, '0')}章`
  const source = paths.定稿章(chapter.卷, chapter.章, chapter.章名)
  for (const section of sections) {
    assertSegment(section.module, '世界书模块名')
    assertSegment(section.title, '世界书条目名')
    const moduleDir = path.join(bookRoot, '世界书', section.module)
    if (!fs.existsSync(moduleDir) || !fs.statSync(moduleDir).isDirectory()) {
      throw new Error(`世界书模块「${section.module}」不存在，不猜模块`)
    }
    const rel = `世界书/${section.module}/${section.title}.md`
    const existing = readExisting(bookRoot, rel)
    if (existing === null) {
      if (mode === '更正') throw new Error(`世界书更正目标条目不存在:${rel}`)
      ops.push({
        relPath: rel,
        content: serializeDocument(
          {
            名称: section.title,
            类型: section.module,
            性质: '事实',
            状态: '已成事实',
            来源: source,
            版本: 1,
          },
          section.body,
          ['名称', '类型', '性质', '状态', '来源', '版本'],
        ),
      })
      continue
    }
    const doc = parseDocument(existing)
    if (!doc.ok) throw new Error(`世界书条目解析失败:${rel}——${doc.detail}`)
    const parent = extractVersionFields(doc.data.fields).版本
    const generator = mode === '更正' ? '吃书补偿' : '事实沉淀'
    const fields = applyVersionFields(
      { ...doc.data.fields },
      parent === null ? initialVersion(generator) : bumpVersion(parent, generator),
    )
    const appended = `${doc.data.body.replace(/\n+$/, '')}\n\n### 事实@${chapterLabel}\n来源：${source}\n${section.body}\n`
    ops.push({ relPath: rel, content: serializeDocument(fields, mode === '更正' ? section.body : appended) })
  }
  return ops
}

/**
 * 整条替换既有 `## <条目名>` 段(吃书更正用)。
 *
 * 找不到该条目即失败:更正只修既有条目,新增条目走正常定稿沉淀。
 * 静默追加会造成同名双条目,当前态判定要靠归并兜底,等于把错误留给读侧。
 */
function replaceEntry(existing: string, title: string, block: string, label: string): string {
  // Match the reader's top-level sections, retaining byte offsets so unrelated
  // history, whitespace and line endings remain exactly as the author left them.
  const sections: Array<{ title: string; start: number; end: number }> = []
  let offset = 0
  for (const line of existing.split(/(?<=\n)/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line.trim())
    if (heading) {
      if (sections.length) sections[sections.length - 1]!.end = offset
      sections.push({ title: heading[1]!.trim(), start: offset, end: existing.length })
    }
    offset += line.length
  }
  let target: (typeof sections)[number] | undefined
  for (const section of sections) {
    const metadata = existing.slice(section.start, section.end).split(/^\s*###\s+正文\s*$/m)[0]!
    const names = [...metadata.matchAll(/^\s*(?:[-*]\s*)?名称[：:]\s*(.*?)\s*$/gm)].map(match => match[1]!.trim())
    if (section.title === title || names.includes(title)) {
      if (names.length > 1 || (names.length === 1 && names[0] !== section.title)) {
        throw new Error(`${label}更正目标名称与标题存在歧义:${title}`)
      }
      if (section.title === title) target = section
    }
  }
  if (target === undefined) throw new Error(`${label}更正目标条目不存在:${title}`)
  const replacementName = extractField(block.split(/^\s*###\s+正文\s*$/m)[0]!, '名称')
  if (replacementName !== null && replacementName !== title) throw new Error(`${label}更正候选名称与标题存在歧义:${title}`)
  const newline = existing.includes('\r\n') ? '\r\n' : '\n'
  const replacement = block.trim().replace(/\r?\n/g, newline) + newline + newline
  return existing.slice(0, target.start) + replacement + existing.slice(target.end)
}

/** 账本条目字段级校验(预校验与 ledgerBlock 共用;报错即入档时会说的原话)。 */
export function checkLedgerSectionFields(section: LedgerSection): void {
  const status = extractField(section.body, '状态')
  if (status === null) throw new Error(`账本「${section.kind}/${section.title}」缺少状态字段`)
  const plannedFrom = extractField(section.body, '计划来源')
  if (plannedFrom === null) throw new Error(`账本「${section.kind}/${section.title}」缺少计划来源字段`)
  const candidateType = extractField(section.body, '类型')
  if (candidateType !== null && candidateType !== section.kind) {
    throw new Error(`账本「${section.kind}/${section.title}」类型与分类不一致:${candidateType}`)
  }
  const allowed = section.kind === '线索'
    ? ['已埋', '已示', '已收', '已弃']
    : ['进行中', '已兑现', '已结束', '已放弃']
  if (!allowed.includes(status)) throw new Error(`账本「${section.kind}/${section.title}」状态非法:${status}`)
  if (section.kind === '线索') {
    if (extractField(section.body, '埋设点') === null) throw new Error(`线索「${section.title}」缺少埋设点`)
    if (extractField(section.body, '预期兑现区间') === null) throw new Error(`线索「${section.title}」缺少预期兑现区间`)
    if (status === '已弃' && extractField(section.body, '弃因') === null) throw new Error(`线索「${section.title}」已弃但缺少弃因`)
  }
}

/** 记忆条目字段级校验(预校验与沉淀写入共用)。 */
function memoryDescription(body: string): { 描述?: string; body: string } {
  let metadata = true
  let description: string | undefined
  const lines: string[] = []
  for (const line of body.split('\n')) {
    const match = /^\s*(?:[-*]\s*)?描述[：:]\s*(.*)$/.exec(line)
    if (metadata && match) {
      if (description !== undefined || !match[1]!.trim()) throw new Error('记忆描述须为一条非空单行')
      description = match[1]!.trim()
      continue
    }
    if (line.trim() && !/^\s*(?:[-*]\s*)?(?:类|状态|来源|裁决记录)[：:]/.test(line)) metadata = false
    lines.push(line)
  }
  return { ...(description === undefined ? {} : { 描述: description }), body: lines.join('\n') }
}

export function checkMemorySectionFields(section: MemorySection): void {
  const candidateKind = extractField(section.body, '类')
  if (candidateKind !== null && candidateKind !== section.kind) {
    throw new Error(`记忆「${section.kind}/${section.title}」类与分类不一致:${candidateKind}`)
  }
  const candidateStatus = extractField(section.body, '状态')
  if (candidateStatus !== null && candidateStatus !== '候选') {
    throw new Error(`记忆「${section.kind}/${section.title}」候选状态非法:${candidateStatus}`)
  }
  const content = stripFields(memoryDescription(section.body).body, ['类', '状态', '来源', '裁决记录'])
  if (content === '') throw new Error(`记忆「${section.kind}/${section.title}」正文为空`)
}

function ledgerBlock(section: LedgerSection, chapter: ChapterKey, source: string, decision: string): string {
  checkLedgerSectionFields(section)
  const status = extractField(section.body, '状态')!
  const plannedFrom = extractField(section.body, '计划来源')!
  const name = extractField(section.body, '名称') ?? section.title
  const details = stripFields(section.body, ['名称', '类型', '状态', '计划来源', '实际落点', '来源', '裁决记录'])
  return [
    `## ${section.title}`,
    `名称：${name}`,
    `类型：${section.kind}`,
    `状态：${status}`,
    `计划来源：${plannedFrom}`,
    `实际落点：${paths.定稿章(chapter.卷, chapter.章, chapter.章名)}`,
    `来源：${source}`,
    `裁决记录：${decision}`,
    '### 正文',
    details || '（无正文）',
    '',
  ].filter((line) => line !== '').join('\n') + '\n'
}

function timelineBlock(section: Section, chapter: ChapterKey, source: string, decision: string): string {
  const content = stripFields(section.body, ['章号', '来源', '裁决记录'])
  return [
    `## ${section.title}`,
    `章号：第${String(chapter.章).padStart(4, '0')}章`,
    `来源：${source}`,
    `裁决记录：${decision}`,
    '### 正文',
    content,
    '',
  ].join('\n')
}

function extractField(body: string, field: string): string | null {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = body.match(new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?${escaped}[：:]\\s*(.+?)\\s*$`, 'm'))
  return match?.[1]?.trim() || null
}

function stripFields(body: string, fields: readonly string[]): string {
  const escaped = fields.map((field) => field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const pattern = new RegExp(`^\\s*(?:[-*]\\s*)?(?:${escaped})[：:].*$`)
  return body.split('\n').filter((line) => !pattern.test(line)).join('\n').trim()
}

function candidateIsNonEmpty(packageAbs: string, name: string): boolean {
  const text = readOptional(packageAbs, name)
  return text !== '' && !bodyIsEmpty(text)
}

/** 沉淀写入方式:正常定稿追加新条目;吃书补偿整条更正既有条目。 */
export type SettlementMode = '追加' | '更正'

/** 规划定稿包的账本/记忆沉淀，不产生写操作。 */
export function planSettlement(
  bookRoot: string,
  packageAbs: string,
  approval: SettlementApproval | undefined,
  expectedChapter: ChapterKey | undefined,
  mode: SettlementMode = '追加',
): SettlementPlanResult {
  try {
    return planSettlementUnsafe(bookRoot, packageAbs, approval, expectedChapter, mode)
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

function planSettlementUnsafe(
  bookRoot: string,
  packageAbs: string,
  approval: SettlementApproval | undefined,
  expectedChapter: ChapterKey | undefined,
  mode: SettlementMode,
): SettlementPlanResult {
  const candidates = Object.values(candidateFiles).some((file) => candidateIsNonEmpty(packageAbs, file))
  if (!candidates) return { ok: true, ops: [], 有候选: false }
  if (approval === undefined) return { ok: false, reason: '存在沉淀候选但缺少作者批准' }
  if (!approval.批准) return { ok: false, reason: '作者未批准沉淀候选' }
  if (approval.裁决记录.trim() === '') return { ok: false, reason: '沉淀批准缺少裁决记录' }
  if (expectedChapter !== undefined && (
    expectedChapter.卷 !== approval.章节.卷
    || expectedChapter.章 !== approval.章节.章
    || expectedChapter.章名 !== approval.章节.章名
  )) {
    return { ok: false, reason: '沉淀批准章节与定稿目标不一致' }
  }
  const chapter = approval.章节
  const source = paths.定稿章(chapter.卷, chapter.章, chapter.章名)
  const ops: FileOp[] = []
  const write = (existing: string, title: string, block: string, label: string): string =>
    mode === '追加' ? append(existing, block) : replaceEntry(existing, title, block, label)

  if (candidateIsNonEmpty(packageAbs, candidateFiles.facts)) {
    const facts = parseFactSections(readOptional(packageAbs, candidateFiles.facts))
    if (facts.length > 0) ops.push(...factOps(bookRoot, facts, chapter, mode))
  }

  const timelineText = readOptional(packageAbs, candidateFiles.timeline)
  const timeline = candidateIsNonEmpty(packageAbs, candidateFiles.timeline) ? parseTimelineSections(timelineText) : []
  if (timeline.length > 0) {
    const target = paths.账本('时间线')
    const existing = readExisting(bookRoot, target)
    if (existing === null) return { ok: false, reason: `真源不存在:${target}` }
    ops.push({
      relPath: target,
      content: timeline.reduce(
        (text, item) => write(text, item.title, timelineBlock(item, chapter, source, approval.裁决记录), '时间线'),
        existing,
      ),
    })
  }

  const ledgerText = readOptional(packageAbs, candidateFiles.ledger)
  const ledger = candidateIsNonEmpty(packageAbs, candidateFiles.ledger) ? parseLedgerSections(ledgerText) : []
  for (const kind of ledgerKinds) {
    const entries = ledger.filter((item) => item.kind === kind)
    if (entries.length === 0) continue
    if (mode === '更正') {
      for (const entry of entries) {
        const names = [...entry.body.matchAll(/^\s*(?:[-*]\s*)?名称[：:]\s*(.*?)\s*$/gm)].map(match => match[1]!.trim())
        if (names.length > 1 || (names.length === 1 && names[0] !== entry.title)) {
          return { ok: false, reason: `账本「${kind}」更正候选名称与标题存在歧义:${entry.title}` }
        }
      }
    }
    const target = paths.账本(kind)
    const existing = readExisting(bookRoot, target)
    if (existing === null) return { ok: false, reason: `真源不存在:${target}` }
    ops.push({
      relPath: target,
      content: entries.reduce(
        (text, item) => write(text, item.title, ledgerBlock(item, chapter, source, approval.裁决记录), `账本「${kind}」`),
        existing,
      ),
    })
  }

  const memoryText = readOptional(packageAbs, candidateFiles.memory)
  const memory = candidateIsNonEmpty(packageAbs, candidateFiles.memory) ? parseMemorySections(memoryText) : []
  const memoryInputs: BookMemoryInput[] = []
  for (const section of memory) {
    checkMemorySectionFields(section)
    const content = memoryDescription(section.body)
    memoryInputs.push({
      类: section.kind,
      名称: section.title,
      ...(content.描述 === undefined ? {} : { 描述: content.描述 }),
      正文: stripFields(content.body, ['类', '状态', '来源', '裁决记录']),
      来源: source,
      裁决记录: approval.裁决记录,
    })
  }
  if (memoryInputs.length > 0) {
    // 一事一文件(格式规格 §6):条目文件由沉淀按需新建,不再要求 类文件 先存在
    ops.push(...bookMemoryOps(bookRoot, memoryInputs))
  }

  return { ok: true, ops, 有候选: true }
}

function readExisting(root: string, relPath: string): string | null {
  try {
    return fs.readFileSync(path.join(root, relPath), 'utf-8')
  } catch {
    return null
  }
}
export { writeSettlementDecision } from './decision'
