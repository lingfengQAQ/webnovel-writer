import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ChapterKey } from '../derive/scan'
import type { FileOp } from '../repo/atomic'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { applyVersionFields, bumpVersion, extractVersionFields, initialVersion } from '../provenance'
import { assertSegment, LEDGER_KINDS, MEMORY_KINDS, paths } from '../repo/paths'
import { bookMemoryOps, type BookMemoryInput } from '../memory/book'
import { memoryTextHash, normalizeMemoryText, readMemoryText } from '../memory/write'
import { MACHINE_SCHEMA_VERSION, parseMachineJson } from '../repo/schema'
import { leadingFields, type LeadingField } from '../ledger/clue'
import { CLUE_FIELDS, CLUE_STATES, LEDGER_FIELD_KEYS, LEDGER_STATES, type LedgerField } from '../repo/ledger-field-contract'
import { DOCUMENT_FIELDS, isDocumentFieldValue, TIMELINE_FIELD_KEYS } from '../repo/document-fields'
import { parseLedgerHistory } from '../ledger'

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

/**
 * 候选解析错误。文案格式固定为「段名第 N 行：问题；合法值：…；修正方法：…」，
 * 让调用方一次就能定位并改对；工具层按「第 N 行：」归为 parse-error。
 */
export class SettlementParseError extends Error {
  constructor(
    readonly section: string,
    readonly line: number | null,
    problem: string,
    fix: string,
    legal?: readonly string[],
  ) {
    const where = line === null ? section : `${section}第 ${line} 行`
    const legalText = legal !== undefined && legal.length > 0 ? `；合法值：${legal.join('、')}` : ''
    super(`${where}：${problem}${legalText}；修正方法：${fix}`)
    this.name = 'SettlementParseError'
  }
}

/** 解析出的条目在候选文本中的标题行号（不进入条目对象，避免影响序列化与比较）。 */
const sectionLine = new WeakMap<object, number>()

function parseFail(section: string, line: number | null, problem: string, fix: string, legal?: readonly string[]): never {
  throw new SettlementParseError(section, line, problem, fix, legal)
}

function assertNoPreamble(lines: readonly string[], label: string): void {
  const firstSection = lines.findIndex((line) => /^##\s+/.test(line.trim()))
  const end = firstSection < 0 ? lines.length : firstSection
  for (let index = 0; index < end; index++) {
    const line = (lines[index] ?? '').trim()
    if (line !== '' && !line.startsWith('#')) {
      parseFail(label, index + 1, `存在未分类正文「${line.slice(0, 20)}」，不猜测归类`, '把这行移到某个 `## ` 分类下；整段没有变更时删掉占位文字，只留标题行')
    }
  }
}

export function parseLedgerSections(text: string): LedgerSection[] {
  const lines = normal(text).split('\n')
  const sections: LedgerSection[] = []
  let kind: LedgerKind | null = null
  let title: string | null = null
  let body: string[] = []
  let itemLine = 0

  const flush = (): void => {
    if (kind !== null && title !== null) {
      const value = body.join('\n').trim()
      if (value === '') parseFail('账本变更', itemLine, `条目「${kind}/${title}」正文为空`, '在该条目下写状态行和一两句说明；没有变更就删掉整个条目')
      { const section = { kind, title, body: value }; sectionLine.set(section, itemLine); sections.push(section) }
    }
    body = []
  }

  assertNoPreamble(lines, '账本变更')
  for (const [index, line] of lines.entries()) {
    const lineNo = index + 1
    const category = line.match(/^##\s+(.+?)\s*$/)?.[1]?.trim()
    const item = line.match(/^###\s+(.+?)\s*$/)?.[1]?.trim()
    if (category !== undefined) {
      flush()
      if (!(ledgerKinds as readonly string[]).includes(category)) {
        parseFail('账本变更', lineNo, `分类未知「${category}」`, '把这行 `## ` 后的分类改成合法值之一，一行只写一个', ledgerKinds)
      }
      kind = category as LedgerKind
      title = null
      continue
    }
    if (item !== undefined) {
      flush()
      if (kind === null) parseFail('账本变更', lineNo, `条目「${item}」缺少分类`, '在它前面加一行 `## <分类>`', ledgerKinds)
      title = item
      itemLine = lineNo
      continue
    }
    if (title !== null) body.push(line)
    else if (line.trim() !== '' && !line.trim().startsWith('#')) {
      parseFail('账本变更', lineNo, '存在未分类正文，不猜测归类', '把这行移到某个 `### 条目` 下；整段没有变更时删掉占位文字')
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
  let itemLine = 0

  const flush = (): void => {
    if (kind !== null && title !== null) {
      const value = body.join('\n').trim()
      if (value === '') parseFail('本书层记忆候选', itemLine, `条目「${kind}/${title}」正文为空`, '在该条目下写状态、描述和正文；没有候选就删掉整个条目')
      { const section = { kind, title, body: value }; sectionLine.set(section, itemLine); sections.push(section) }
    }
    body = []
  }

  assertNoPreamble(lines, '本书层记忆候选')
  for (const [index, line] of lines.entries()) {
    const lineNo = index + 1
    const category = line.match(/^##\s+(.+?)\s*$/)?.[1]?.trim()
    const item = line.match(/^###\s+(.+?)\s*$/)?.[1]?.trim()
    if (category !== undefined) {
      flush()
      if (!(memoryKinds as readonly string[]).includes(category)) {
        parseFail('本书层记忆候选', lineNo, `分类未知「${category}」`, '把这行 `## ` 后的分类改成合法值之一，一行只写一个', memoryKinds)
      }
      kind = category as MemoryKind
      title = null
      continue
    }
    if (item !== undefined) {
      flush()
      if (kind === null) parseFail('本书层记忆候选', lineNo, `条目「${item}」缺少分类`, '在它前面加一行 `## <分类>`', memoryKinds)
      title = item
      itemLine = lineNo
      continue
    }
    if (title !== null) body.push(line)
    else if (line.trim() !== '' && !line.trim().startsWith('#')) {
      parseFail('本书层记忆候选', lineNo, '存在未分类正文，不猜测归类', '把这行移到某个 `### 条目` 下；整段没有候选时删掉占位文字')
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
  let itemLine = 0

  const flush = (): void => {
    if (title !== null) {
      const value = body.join('\n').trim()
      if (value === '') parseFail('时间线变更', itemLine, `事件「${title}」正文为空`, '在该事件下写「- 事件：<一句话>」和「- 时点：<时点>」')
      const lead = leadingFields(value.split('\n'), TIMELINE_FIELD_KEYS)
      for (const field of TIMELINE_FIELD_KEYS) {
        if (lead.filter(item => item.field === field).length > 1) parseFail('时间线变更', itemLine, `事件「${title}」的${field}重复`, `只保留一行「- ${field}：…」，说明正文写在字段行之后`)
      }
      if (!isDocumentFieldValue(DOCUMENT_FIELDS.timelineEvent, leadingValue(lead, DOCUMENT_FIELDS.timelineEvent.name))) {
        if (!lead.some(item => item.field === '事件') && extractField(value, '事件') !== null) parseFail('时间线变更', itemLine, `事件「${title}」的事件字段不在事件开头的字段行中`, '把「- 事件：<一句话>」移到时点、来源等字段行旁边，写在说明正文之前')
        parseFail('时间线变更', itemLine, `事件「${title}」缺少事件字段`, '在该事件下加一行「- 事件：<一句话>」')
      }
      sections.push({ title, body: value })
    }
    body = []
  }

  assertNoPreamble(lines, '时间线变更')
  for (const [index, line] of lines.entries()) {
    const lineNo = index + 1
    const item = line.match(/^##\s+(.+?)\s*$/)?.[1]?.trim()
    if (item !== undefined) {
      flush()
      title = item
      itemLine = lineNo
      continue
    }
    if (title !== null) body.push(line)
    else if (line.trim() !== '' && !line.trim().startsWith('#')) {
      parseFail('时间线变更', lineNo, '存在未分类正文，不猜测归类', '把这行移到某个 `## <事件名>` 下；整段没有变更时删掉占位文字')
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
  let itemLine = 0

  const flush = (): void => {
    if (module !== null && title !== null) {
      const value = body.join('\n').trim()
      if (value === '') parseFail('事实变更', itemLine, `条目「${module}/${title}」正文为空`, '在该条目下写一段本章成为事实的内容；没有就删掉整个条目')
      sections.push({ module, title, body: value })
    }
    body = []
  }

  assertNoPreamble(lines, '事实变更')
  for (const [index, line] of lines.entries()) {
    const lineNo = index + 1
    const category = line.match(/^##\s+(.+?)\s*$/)?.[1]?.trim()
    const item = line.match(/^###\s+(.+?)\s*$/)?.[1]?.trim()
    if (category !== undefined) {
      flush()
      if (category === '' || category.includes('/') || category.includes('\\')) {
        parseFail('事实变更', lineNo, `模块名不合法「${category}」`, '`## ` 后只写一个世界书模块名，不含 / 或 \\，从派发提示词给出的模块清单里选')
      }
      module = category
      title = null
      continue
    }
    if (item !== undefined) {
      flush()
      if (module === null) parseFail('事实变更', lineNo, `条目「${item}」缺少模块`, '在它前面加一行 `## <世界书模块名>`')
      title = item
      itemLine = lineNo
      continue
    }
    if (title !== null) body.push(line)
    else if (line.trim() !== '' && !line.trim().startsWith('#')) {
      parseFail('事实变更', lineNo, '存在未分类正文，不猜测归类', '把这行移到某个 `### 条目` 下；整段没有变更时删掉占位文字')
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
      if (mode === '更正') throw new Error(`世界书更正目标条目不存在：${rel}`)
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
    if (!doc.ok) throw new Error(`世界书条目解析失败：${rel}——${doc.detail}`)
    const parent = extractVersionFields(doc.data.fields).版本
    const generator = mode === '更正' ? '吃书补偿' : '事实沉淀'
    // A correction replaces the whole body with facts, including an originally planned head.
    // Keep that ownership durable across later appends, also for the evidenced old correction marker.
    const correctedFact = mode === '更正' || doc.data.fields['生成模块'] === '吃书补偿'
    const fields = applyVersionFields(
      { ...doc.data.fields, ...(correctedFact ? { 性质: '事实' } : {}) },
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
        throw new Error(`${label}更正目标名称与标题存在歧义：${title}`)
      }
      if (section.title === title) target = section
    }
  }
  if (target === undefined) throw new Error(`${label}更正目标条目不存在：${title}`)
  const replacementName = extractField(block.split(/^\s*###\s+正文\s*$/m)[0]!, '名称')
  if (replacementName !== null && replacementName !== title) throw new Error(`${label}更正候选名称与标题存在歧义：${title}`)
  const newline = existing.includes('\r\n') ? '\r\n' : '\n'
  const replacement = block.trim().replace(/\r?\n/g, newline) + newline + newline
  return existing.slice(0, target.start) + replacement + existing.slice(target.end)
}

/** 账本条目字段级校验(预校验与 ledgerBlock 共用;报错即入档时会说的原话)。 */
export function checkLedgerSectionFields(section: LedgerSection): void {
  const at = sectionLine.get(section) ?? null
  const name = `条目「${section.kind}/${section.title}」`
  const lead = ledgerLead(section)
  for (const field of LEDGER_FIELD_KEYS) {
    if (lead.filter(item => item.field === field).length > 1) parseFail('账本变更', at, `${name}的${field}字段重复`, `只保留一行「- ${field}：…」，说明正文写在字段行之后`)
  }
  const candidateName = leadingValue(lead, '名称')
  if (candidateName !== null && candidateName !== section.title) {
    parseFail('账本变更', at, `${name}名称与标题存在歧义：名称「${candidateName}」，标题「${section.title}」`, `删掉「名称」行，或把它改成「${section.title}」`)
  }
  const status = leadingValue(lead, '状态')
  const allowed: readonly string[] = section.kind === '线索' ? CLUE_STATES : LEDGER_STATES
  if (status === null && !lead.some(item => item.field === '状态') && extractField(section.body, '状态') !== null) parseFail('账本变更', at, `${name}的状态不在条目开头的字段行中`, '把「- 状态：<合法值>」移到计划来源等字段行旁边，写在说明正文之前', allowed)
  if (status === null) parseFail('账本变更', at, `${name}缺少状态字段`, '在条目下加一行「- 状态：<合法值>」', allowed)
  const plannedFrom = leadingValue(lead, '计划来源')
  if (plannedFrom === null && !lead.some(item => item.field === '计划来源') && extractField(section.body, '计划来源') !== null) parseFail('账本变更', at, `${name}的计划来源不在条目开头的字段行中`, '把「- 计划来源：<骨架/卷纲条目引用>」移到状态等字段行旁边，写在说明正文之前')
  if (plannedFrom === null) parseFail('账本变更', at, `${name}缺少计划来源字段`, '加一行「- 计划来源：<骨架/卷纲条目引用>」；本章新增的写「本章新增」')
  const candidateType = leadingValue(lead, '类型')
  if (candidateType !== null && candidateType !== section.kind) {
    parseFail('账本变更', at, `${name}类型「${candidateType}」与分类不一致`, `删掉「类型」行，或把它改成「${section.kind}」`)
  }
  if (!allowed.includes(status)) parseFail('账本变更', at, `${name}状态非法「${status}」`, '把「状态」改成合法值之一', allowed)
  if (section.kind === '线索') {
    const clue = lead.filter(item => (CLUE_FIELDS as readonly string[]).includes(item.field))
    for (const field of CLUE_FIELDS) {
      if (clue.filter(item => item.field === field).length > 1) parseFail('账本变更', at, `线索「${section.title}」的${field}重复`, `只保留一行「- ${field}：…」`)
    }
    for (const field of status === '已弃' ? CLUE_FIELDS : CLUE_FIELDS.filter(name => name !== '弃因')) {
      if (!clue.some(item => item.field === field) && extractField(section.body, field) !== null) {
        parseFail('账本变更', at, `线索「${section.title}」的${field}不在条目开头的字段行中`, `把「- ${field}：…」移到状态、计划来源等字段行旁边，写在说明正文之前`)
      }
    }
    const leading = (field: string): boolean => clue.some(item => item.field === field && item.value !== '')
    if (!leading('埋设点')) parseFail('账本变更', at, `线索「${section.title}」缺少埋设点`, '加一行「- 埋设点：第NNNN章」')
    if (!leading('预期兑现区间')) parseFail('账本变更', at, `线索「${section.title}」缺少预期兑现区间`, '加一行「- 预期兑现区间：第N-M章」')
    if (status === '已弃' && !leading('弃因')) parseFail('账本变更', at, `线索「${section.title}」已弃但缺少弃因`, '加一行「- 弃因：<一句话>」')
  }
}

/** 记忆条目字段级校验(预校验与沉淀写入共用)。 */
function memoryDescription(body: string): { 描述?: string; body: string; fields: Record<string, string> } {
  let metadata = true
  const fields: Record<string, string> = {}
  const lines: string[] = []
  for (const line of body.split('\n')) {
    const match = /^\s*(?:[-*]\s*)?(类|状态|来源|裁决记录|描述|操作)[：:]\s*(.*)$/.exec(line)
    if (metadata && match) {
      const key = match[1]!, value = match[2]!.trim()
      if (Object.hasOwn(fields, key) || !value) parseFail('本书层记忆候选', null, `记忆${key}须为一条非空单行`, `每个条目只写一行「${key}：<内容>」，不要留空`)
      fields[key] = value
      continue
    }
    if (line.trim()) metadata = false
    lines.push(line)
  }
  return { ...(fields['描述'] === undefined ? {} : { 描述: fields['描述'] }), fields, body: lines.join('\n').trim() }
}

export function checkMemorySectionFields(section: MemorySection): void {
  memoryOperation(section)
  const candidateKind = memoryDescription(section.body).fields['类'] ?? null
  if (candidateKind !== null && candidateKind !== section.kind) {
    parseFail('本书层记忆候选', sectionLine.get(section) ?? null, `条目「${section.kind}/${section.title}」类「${candidateKind}」与分类不一致`, `删掉「类」行，或把它改成「${section.kind}」`, memoryKinds)
  }
  const candidateStatus = memoryDescription(section.body).fields['状态'] ?? null
  if (candidateStatus !== null && candidateStatus !== '候选') {
    parseFail('本书层记忆候选', sectionLine.get(section) ?? null, `条目「${section.kind}/${section.title}」候选状态非法「${candidateStatus}」`, '把「状态」改成「候选」', ['候选'])
  }
  const content = memoryDescription(section.body).body
  if (content === '') parseFail('本书层记忆候选', sectionLine.get(section) ?? null, `条目「${section.kind}/${section.title}」正文为空`, '在字段行之后写可复用的判断')
}

export function memoryOperation(section: MemorySection): '新增' | '更新' {
  const operation = memoryDescription(section.body).fields['操作'] ?? '新增'
  if (operation !== '新增' && operation !== '更新') parseFail('本书层记忆候选', sectionLine.get(section) ?? null, '记忆操作非法', '操作只填新增或更新', ['新增', '更新'])
  return operation as '新增' | '更新'
}

/** Prepare-only proof of the exact original read for each deliberate update. */
export function memoryUpdateBaselines(bookRoot: string, candidate: string | undefined, originals: Readonly<Record<string, string>> = {}): Record<string, string> {
  const sections = candidate?.trim() ? parseMemorySections(candidate) : []
  const updates = sections.filter(section => memoryOperation(section) === '更新')
  const names = new Set(updates.map(section => section.title))
  if (Object.keys(originals).some(name => !names.has(name))) throw new Error('记忆原文含未声明更新的条目，请核对候选')
  const baselines = new Map<string, string>()
  for (const section of updates) {
    assertSegment(section.title, '记忆名称')
    const original = Object.hasOwn(originals, section.title) ? originals[section.title] : undefined
    if (typeof original !== 'string') throw new Error(`更新记忆「${section.title}」须提供已读取的完整原文`)
    const current = readMemoryText(bookRoot, paths.本书记忆条目(section.title))
    if (current === undefined || normalizeMemoryText(current) !== normalizeMemoryText(original)) throw new Error(`记忆原文已变化：${section.title}；请重读后准备定稿包`)
    baselines.set(section.title, memoryTextHash(current))
  }
  return Object.fromEntries(baselines)
}

/** 校验与写入只认同一开头字段区,正文同名行不参与元信息。 */
function ledgerLead(section: LedgerSection): LeadingField[] {
  return leadingFields(section.body.split('\n'), [...LEDGER_FIELD_KEYS, ...(section.kind === '线索' ? CLUE_FIELDS : [])])
}

function leadingValue(lead: readonly LeadingField[], field: string): string | null {
  return lead.find(item => item.field === field)?.value || null
}

function ledgerBlock(section: LedgerSection, chapter: ChapterKey, source: string, decision: string): string {
  checkLedgerSectionFields(section)
  const lead = ledgerLead(section)
  const status = leadingValue(lead, '状态')!
  const plannedFrom = leadingValue(lead, '计划来源')!
  const name = leadingValue(lead, '名称') ?? section.title
  // 线索字段从开头字段区搬进系统区;只搬写入的这几行,其余原文(含正文中的同名行)保留。
  const clue = lead.filter(item => (CLUE_FIELDS as readonly string[]).includes(item.field) && item.value !== '')
  const details = withoutLeadingFields(section.body, [...lead.filter(item => (LEDGER_FIELD_KEYS as readonly string[]).includes(item.field)), ...clue])
  const fields: Record<LedgerField, string> = {
    名称: name,
    类型: section.kind,
    状态: status,
    计划来源: plannedFrom,
    实际落点: paths.定稿章(chapter.卷, chapter.章, chapter.章名),
    来源: source,
    裁决记录: decision,
  }
  const clueLines = CLUE_FIELDS.flatMap(field => clue.filter(item => item.field === field).map(item => `${field}：${item.value}`))
  return [
    `## ${section.title}`,
    ...LEDGER_FIELD_KEYS.flatMap(field => [`${field}：${fields[field]}`, ...(field === '计划来源' ? clueLines : [])]),
    '### 正文',
    details || '（无正文）',
    '',
  ].filter((line) => line !== '').join('\n') + '\n'
}

function timelineBlock(section: Section, chapter: ChapterKey, source: string, decision: string, previousTime?: string): { content: string; time: string } {
  const lead = leadingFields(section.body.split('\n'), TIMELINE_FIELD_KEYS)
  const event = leadingValue(lead, DOCUMENT_FIELDS.timelineEvent.name)!
  const timeField = lead.find(item => item.field === DOCUMENT_FIELDS.storyTime.name)
  const time = timeField === undefined ? previousTime || DOCUMENT_FIELDS.storyTime.unknown : timeField.value || DOCUMENT_FIELDS.storyTime.unknown
  const content = withoutLeadingFields(section.body, lead)
  const contentBlock = [
    `## ${section.title}`,
    `${DOCUMENT_FIELDS.timelineEvent.name}：${event}`,
    `${DOCUMENT_FIELDS.storyTime.name}：${time}`,
    `${DOCUMENT_FIELDS.timelineChapter.name}：第${String(chapter.章).padStart(4, '0')}章`,
    `${DOCUMENT_FIELDS.timelineSource.name}：${source}`,
    `${DOCUMENT_FIELDS.timelineDecision.name}：${decision}`,
    '### 正文',
    content,
    '',
  ].join('\n')
  return { content: contentBlock, time }
}

function extractField(body: string, field: string): string | null {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = body.match(new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?${escaped}[：:]\\s*(.+?)\\s*$`, 'm'))
  return match?.[1]?.trim() || null
}

function withoutLeadingFields(body: string, fields: readonly LeadingField[]): string {
  const moved = new Set(fields.map(item => item.index))
  return body.split('\n').filter((_, index) => !moved.has(index)).join('\n').trim()
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
    if (existing === null) return { ok: false, reason: `真源不存在：${target}` }
    const previousTimes = new Map<string, string | undefined>()
    if (mode === '更正') {
      const history = parseLedgerHistory(existing, '时间线', target)
      if (!history.ok) return { ok: false, reason: history.reason }
      for (const entry of history.entries) previousTimes.set(entry.名称, entry.字段[DOCUMENT_FIELDS.storyTime.name])
    }
    ops.push({
      relPath: target,
      content: timeline.reduce((text, item) => {
        const block = timelineBlock(item, chapter, source, approval.裁决记录, previousTimes.get(item.title))
        if (mode === '更正') previousTimes.set(item.title, block.time)
        return write(text, item.title, block.content, '时间线')
      }, existing),
    })
  }

  const ledgerText = readOptional(packageAbs, candidateFiles.ledger)
  const ledger = candidateIsNonEmpty(packageAbs, candidateFiles.ledger) ? parseLedgerSections(ledgerText) : []
  for (const kind of ledgerKinds) {
    const entries = ledger.filter((item) => item.kind === kind)
    if (entries.length === 0) continue
    if (mode === '更正') {
      for (const entry of entries) {
        const names = ledgerLead(entry).filter(item => item.field === '名称').map(item => item.value)
        if (names.length > 1 || (names.length === 1 && names[0] !== '' && names[0] !== entry.title)) {
          return { ok: false, reason: `账本「${kind}」更正候选名称与标题存在歧义：${entry.title}` }
        }
      }
    }
    const target = paths.账本(kind)
    const existing = readExisting(bookRoot, target)
    if (existing === null) return { ok: false, reason: `真源不存在：${target}` }
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
  let memoryBaselines: Record<string, unknown> = {}
  if (mode === '追加' && memory.some(section => memoryOperation(section) === '更新')) {
    const manifest = parseMachineJson(fs.readFileSync(path.join(packageAbs, '清单.json'), 'utf8'), MACHINE_SCHEMA_VERSION)
    if (!manifest.ok) return { ok: false, reason: '记忆更新清单无效，请重新准备定稿包' }
    const baselines = manifest.data['记忆更新基线']
    if (!baselines || typeof baselines !== 'object' || Array.isArray(baselines)) return { ok: false, reason: '记忆更新缺少原文基线，请重新准备定稿包' }
    memoryBaselines = baselines as Record<string, unknown>
  }
  const memoryInputs: BookMemoryInput[] = []
  for (const section of memory) {
    checkMemorySectionFields(section)
    const content = memoryDescription(section.body)
    const operation = mode === '更正' ? '更新' : memoryOperation(section)
    const baseline = memoryBaselines[section.title]
    if (mode === '追加' && operation === '更新' && (typeof baseline !== 'string' || !/^[a-f0-9]{64}$/.test(baseline))) {
      return { ok: false, reason: `记忆「${section.title}」缺少有效的更新原文基线` }
    }
    memoryInputs.push({
      类: section.kind,
      名称: section.title,
      操作: operation,
      ...(mode === '更正' ? { 原文: readMemoryText(bookRoot, paths.本书记忆条目(section.title)) }
        : operation === '更新' ? { 基线哈希: baseline as string } : {}),
      ...(content.描述 === undefined ? {} : { 描述: content.描述 }),
      正文: content.body,
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
