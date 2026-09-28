import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseDocument } from '../repo/frontmatter'
import { isLegacySeedPlan } from '../design/legacy-seed'
import {
  CN_NUMERAL,
  LEDGER_NAMES,
  MEMORY_KINDS,
  type MemoryKind,
  type LedgerName,
  paths,
} from '../repo/paths'

export type LedgerEntryFilter = {
  readonly 分类?: LedgerName
  readonly 名称?: string
  readonly 状态?: string
  readonly 来源?: string
  /** 世界已发生边界；过滤发生在同名条目折叠之前。 */
  readonly 章上限?: number
}

export interface LedgerEntry {
  readonly 分类: LedgerName
  readonly 名称: string
  readonly 字段: Readonly<Record<string, string>>
  readonly 正文: string
  readonly 来源文件: string
  readonly 行号: number
}

export interface MemoryEntry {
  readonly 类: MemoryKind
  readonly 名称: string
  readonly 字段: Readonly<Record<string, string>>
  readonly 正文: string
  readonly 来源文件: string
  readonly 行号: number
  /** 旧格式(一类一文件)读出的条目标「旧」;一事一文件不标。 */
  readonly 格式?: '旧'
}

export type LedgerQueryResult =
  | { readonly ok: true; readonly entries: readonly LedgerEntry[]; readonly files: readonly string[] }
  | {
      readonly ok: false
      readonly kind: 'missing' | 'parse-error'
      readonly reason: string
      readonly file?: string
      readonly entries: readonly LedgerEntry[]
      readonly files: readonly string[]
    }

export type MemoryQueryResult =
  | { readonly ok: true; readonly entries: readonly MemoryEntry[]; readonly files: readonly string[] }
  | {
      readonly ok: false
      readonly kind: 'missing' | 'parse-error'
      readonly reason: string
      readonly file?: string
      readonly entries: readonly MemoryEntry[]
      readonly files: readonly string[]
    }

export interface ReconciliationItem {
  readonly 名称: string
  readonly 来源: string
  readonly 状态?: string
  readonly 计划区段?: string
}

/**
 * 章级计划待核对项(任务21, B1):「第N章 …」形态计划项精确名未匹配时,
 * 按全书章号关联同章事实供核对——同章任一事件入账不等于计划内容兑现,
 * 不同章号不关联;证据不足时保留待核对,不消成无偏离。
 */
export interface ChapterLevelPendingItem {
  readonly 计划项: ReconciliationItem
  readonly 章号: number
  readonly 本章事实: readonly ReconciliationItem[]
}

export interface LedgerReconciliation {
  readonly 卷: number
  readonly 计划: readonly ReconciliationItem[]
  readonly 事实: readonly ReconciliationItem[]
  readonly 已匹配: readonly ReconciliationItem[]
  readonly 计划未兑现: readonly ReconciliationItem[]
  readonly 事实未计划: readonly ReconciliationItem[]
  /** 落在计划区段内但不成事件形态的行:呈报而非静默丢弃。 */
  readonly 未归类计划行: readonly ReconciliationItem[]
  /** 章级计划按章号关联的待核对清单(非空时任何消费者不得呈报无偏离/已兑现)。 */
  readonly 章级待核对: readonly ChapterLevelPendingItem[]
  /** Entire legacy seed plan matched: provenance is uncertain, not a proven deviation. */
  readonly 疑似占位待核对?: readonly ReconciliationItem[]
  readonly 状态: '无偏离' | '待核对' | '有偏离'
}

export type LedgerReconciliationResult =
  | { readonly ok: true; readonly report: LedgerReconciliation }
  | { readonly ok: false; readonly kind: 'missing' | 'parse-error'; readonly reason: string; readonly file?: string }

export interface DueLedgerItem {
  readonly 名称: string
  readonly 状态: string
  readonly 预期兑现区间: string
  readonly 计划来源: string
  readonly 来源文件: string
  readonly 行号: number
  /** 当前章已超过区间上界。卷级区间无上界,恒为 false。 */
  readonly 逾期: boolean
  /** 逾期时超出上界的章数(章级区间)。未逾期或无上界时缺省。 */
  readonly 超出幅度?: number
}

export type DueLedgerResult =
  | {
      readonly ok: true
      readonly 到期: readonly DueLedgerItem[]
      readonly 逾期: readonly DueLedgerItem[]
      readonly 区间不明: readonly DueLedgerItem[]
    }
  | {
      readonly ok: false
      readonly kind: 'missing' | 'parse-error'
      readonly reason: string
      readonly file?: string
      readonly 到期: readonly DueLedgerItem[]
      readonly 逾期: readonly DueLedgerItem[]
      readonly 区间不明: readonly DueLedgerItem[]
    }

export interface BookLedgerReconciliation {
  readonly 各卷: readonly LedgerReconciliation[]
  readonly 未归属事实: readonly ReconciliationItem[]
  readonly 状态: '无偏离' | '待核对' | '有偏离'
}

export type BookLedgerReconciliationResult =
  | { readonly ok: true; readonly report: BookLedgerReconciliation }
  | { readonly ok: false; readonly kind: 'missing' | 'parse-error'; readonly reason: string; readonly file?: string }

const FIELD_RE = /^\s*(?:[-*]\s*)?([^：:]+)[：:]\s*(.*?)\s*$/
const GENERIC_PLAN_HEADINGS = new Set(['窗口覆盖', '窗口外锚点', '计划', '时间线'])
const PLAN_SECTIONS = ['窗口覆盖', '窗口外锚点']
/**
 * 计划区段内的注记行(格式规格 §3.2:先后/并行/间隔本应写在事件行的 (…) 内)。
 * 只认整句注记形态,不按事件名首字判断——「与师父决裂」「待宰的羔羊现身」是事件不是注记。
 */
const PLAN_NOTE_RE = /^(?:与[^，。；;]*(?:并行|同时)|并行|间隔|本卷时间|备注|说明|待[^，。；;]*确认)/
const STRUCTURED_FIELDS = new Set([
  '名称', '类型', '状态', '计划来源', '实际落点', '来源', '裁决记录',
  '埋设点', '预期兑现区间', '弃因', '事件', '章号', '类',
])

function read(root: string, relPath: string, label: string): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly kind: 'missing'; readonly reason: string } {
  try {
    return { ok: true, text: fs.readFileSync(path.join(root, relPath), 'utf-8') }
  } catch {
    return { ok: false, kind: 'missing', reason: `${label}不存在:${relPath}` }
  }
}

interface ParsedEntry<T extends string> {
  readonly 分类: T
  readonly 名称: string
  readonly 字段: Readonly<Record<string, string>>
  readonly 正文: string
  readonly 来源文件: string
  readonly 行号: number
}

function parseEntries<T extends string>(text: string, category: T, source: string): ParsedEntry<T>[] | { readonly reason: string; readonly line: number } {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const entries: ParsedEntry<T>[] = []
  let title: string | null = null
  let titleLine = 0
  let body: Array<{ readonly line: number; readonly text: string }> = []

  const flush = (): void => {
    if (title === null) return
    const fields: Record<string, string> = {}
    const prose: string[] = []
    let inBody = false
    for (const item of body) {
      if (/^###\s+正文\s*$/.test(item.text.trim())) {
        inBody = true
        continue
      }
      const match = FIELD_RE.exec(item.text)
      const field = match?.[1]?.trim()
      const value = match?.[2]?.trim()
      if (!inBody && field !== undefined && value !== undefined && STRUCTURED_FIELDS.has(field)) {
        if (fields[field] !== undefined) {
          throw new ParseEntryError(`字段重复:${field}`, item.line)
        }
        fields[field] = value
        continue
      }
      prose.push(item.text)
    }
    const bodyText = prose.join('\n').trim()
    entries.push({ 分类: category, 名称: title, 字段: fields, 正文: bodyText, 来源文件: source, 行号: titleLine })
    body = []
  }

  try {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      const heading = /^##\s+(.+?)\s*$/.exec(line.trim())
      if (heading !== null) {
        flush()
        const nextTitle = heading[1]!.trim()
        if (nextTitle === '') throw new Error('条目名称为空')
        title = nextTitle
        titleLine = index + 1
        continue
      }
      if (title !== null) body.push({ line: index + 1, text: line })
    }
    flush()
  } catch (err) {
    if (err instanceof ParseEntryError) return { reason: err.message, line: err.line }
    return { reason: err instanceof Error ? err.message : String(err), line: titleLine }
  }
  return entries
}

class ParseEntryError extends Error {
  readonly line: number

  constructor(message: string, line: number) {
    super(message)
    this.name = 'ParseEntryError'
    this.line = line
  }
}

function matches(entry: LedgerEntry, filter: LedgerEntryFilter | undefined): boolean {
  if (filter === undefined) return true
  if (filter.分类 !== undefined && entry.分类 !== filter.分类) return false
  if (filter.名称 !== undefined && entry.名称 !== filter.名称) return false
  if (filter.状态 !== undefined && entry.字段['状态'] !== filter.状态) return false
  if (filter.来源 !== undefined && entry.字段['来源'] !== filter.来源) return false
  return true
}

/** 解析账本条目的生效章号；无法判断时返回 null，由调用方显式标注不确定性。 */
export function entryChapterNo(entry: Pick<LedgerEntry, '字段'>): number | null {
  const direct = entry.字段['章号']
  if (direct !== undefined) {
    const match = /^(?:第\s*)?(\d{1,4})(?:\s*章)?$/.exec(direct.trim())
    if (match !== null) return Number(match[1])
  }
  for (const key of ['实际落点', '来源', '埋设点'] as const) {
    const value = entry.字段[key]
    if (value === undefined) continue
    const finalPath = /定稿[\\/]卷\d+[\\/](\d{4})-/.exec(value)
    if (finalPath !== null) return Number(finalPath[1])
    const chapter = /第\s*(\d{1,4})\s*章/.exec(value)
    if (chapter !== null) return Number(chapter[1])
    const shortPath = /^(\d{1,4})-/.exec(value.trim())
    if (shortPath !== null) return Number(shortPath[1])
  }
  return null
}

function memoryMatches(entry: MemoryEntry, filter: { readonly 类?: MemoryKind; readonly 名称?: string; readonly 状态?: string } | undefined): boolean {
  if (filter === undefined) return true
  if (filter.类 !== undefined && entry.类 !== filter.类) return false
  if (filter.名称 !== undefined && entry.名称 !== filter.名称) return false
  if (filter.状态 !== undefined && entry.字段['状态'] !== filter.状态) return false
  return true
}

function normalizeName(name: string): string {
  return name.trim().replace(/[\s「」『』【】（）()：:，,。！？!?]/g, '').toLowerCase()
}

function currentEntries<T extends { readonly 名称: string }>(entries: readonly T[], keyFor: (entry: T) => string = (entry) => normalizeName(entry.名称)): T[] {
  const latest = new Map<string, T>()
  for (const entry of entries) latest.set(keyFor(entry), entry)
  const seen = new Set<string>()
  const result: T[] = []
  for (const entry of entries) {
    const key = keyFor(entry)
    if (seen.has(key) || latest.get(key) !== entry) continue
    seen.add(key)
    result.push(entry)
  }
  return result
}

/** 查询五类故事账本，只读并区分缺失与解析失败。 */
export function parseLedgerHistory(text: string, category: LedgerName, source: string): LedgerQueryResult {
  const parsed = parseEntries(text, category, source)
  if (!Array.isArray(parsed)) return { ok: false, kind: 'parse-error', reason: parsed.reason, file: source, entries: [], files: [] }
  return { ok: true, entries: parsed, files: [source] }
}

/** Query current state; history consumers use the same parser without folding it first. */
export function queryLedger(bookRoot: string, filter?: LedgerEntryFilter): LedgerQueryResult {
  const entries: LedgerEntry[] = []
  const files: string[] = []
  const missing: string[] = []
  const failures: string[] = []
  let firstFailure: string | undefined
  for (const category of LEDGER_NAMES) {
    const source = paths.账本(category)
    const result = read(bookRoot, source, '账本文件')
    if (!result.ok) {
      missing.push(source)
      continue
    }
    const parsed = parseEntries(result.text, category, source)
    if (!Array.isArray(parsed)) {
      const detail = `${source}:${parsed.line}:${parsed.reason}`
      failures.push(detail)
      firstFailure ??= source
      continue
    }
    files.push(source)
    entries.push(...parsed.map((entry) => ({
      分类: entry.分类,
      名称: entry.名称,
      字段: entry.字段,
      正文: entry.正文,
      来源文件: entry.来源文件,
      行号: entry.行号,
    })))
  }
  // Apply the world-happened boundary before current-state folding. Folding
  // first would let a future update hide an earlier state needed by a past
  // chapter (for example, chapter 50 planted then chapter 199 collected).
  const bounded = filter?.章上限 === undefined
    ? entries
    : entries.filter((entry) => {
      const chapter = entryChapterNo(entry)
      return chapter === null || chapter <= filter.章上限!
    })
  const current = currentEntries(bounded, (entry) => `${entry.分类}:${normalizeName(entry.名称)}`).filter((entry) => matches(entry, filter))
  if (failures.length > 0) {
    return { ok: false, kind: 'parse-error', reason: failures.join('；'), file: firstFailure, entries: current, files }
  }
  if (missing.length > 0) {
    return { ok: false, kind: 'missing', reason: `账本文件缺失:${missing.join('、')}`, file: missing[0], entries: current, files }
  }
  return { ok: true, entries: current, files }
}

/**
 * 查询本书记忆，只读并区分缺失与解析失败。
 * 新格式＝一事一文件(`本书记忆/<条目名>.md`,frontmatter 带 类);旧格式＝
 * 一类一文件(`本书记忆/<类>.md`,`## 条目` 分节),条目标 `格式:'旧'`,不自动迁移。
 */
export function queryMemory(
  bookRoot: string,
  filter?: { readonly 类?: MemoryKind; readonly 名称?: string; readonly 状态?: string },
): MemoryQueryResult {
  const collected: MemoryEntry[] = []
  const files: string[] = []
  const failures: string[] = []
  let firstFailure: string | undefined
  const dir = path.join(bookRoot, '本书记忆')
  let names: string[] = []
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.md') && n !== '索引.md').sort()
  } catch {
    names = []
  }
  for (const name of names) {
    const source = paths.本书记忆条目(name.replace(/\.md$/, ''))
    const result = read(bookRoot, source, '本书记忆文件')
    if (!result.ok) continue
    const doc = parseDocumentFs(result.text)
    const 类 = doc?.fields['类']
    if (doc !== null && typeof 类 === 'string' && (MEMORY_KINDS as readonly string[]).includes(类)) {
      // 新格式:一事一文件,一个文件一条目
      const fields: Record<string, string> = {}
      for (const [k, v] of Object.entries(doc.fields)) {
        if (typeof v === 'string') fields[k] = v
      }
      files.push(source)
      collected.push({
        类: 类 as MemoryKind,
        名称: typeof doc.fields['名称'] === 'string' ? doc.fields['名称'] : name.replace(/\.md$/, ''),
        字段: fields,
        正文: doc.body,
        来源文件: source,
        行号: 0,
      })
      continue
    }
    // 旧格式候选:文件名即类名
    const base = name.replace(/\.md$/, '')
    if (!(MEMORY_KINDS as readonly string[]).includes(base)) continue
    const parsed = parseEntries(result.text, base as MemoryKind, source)
    if (!Array.isArray(parsed)) {
      const detail = `${source}:${parsed.line}:${parsed.reason}`
      failures.push(detail)
      firstFailure ??= source
      continue
    }
    files.push(source)
    collected.push(...parsed.map((entry) => ({
      类: entry.分类,
      名称: entry.名称,
      字段: entry.字段,
      正文: entry.正文,
      来源文件: entry.来源文件,
      行号: entry.行号,
      格式: '旧' as const,
    })))
  }
  const current = currentEntries(collected, (entry) => `${entry.类}:${normalizeName(entry.名称)}`)
    .filter((entry) => memoryMatches(entry, filter))
  if (failures.length > 0) {
    return { ok: false, kind: 'parse-error', reason: failures.join('；'), file: firstFailure, entries: current, files }
  }
  if (files.length === 0) {
    return { ok: false, kind: 'missing', reason: '本书记忆不存在', entries: current, files }
  }
  return { ok: true, entries: current, files }
}

/** parseDocument 的容错包装:读侧只需要「有 frontmatter 字段就用,没有就按旧格式」。 */
function parseDocumentFs(text: string): { readonly fields: Record<string, unknown>; readonly body: string } | null {
  const r = parseDocument(text)
  return r.ok ? { fields: r.data.fields, body: r.data.body } : null
}

interface PlanParse {
  readonly items: readonly ReconciliationItem[]
  readonly 未归类: readonly ReconciliationItem[]
}

function parsePlanItems(text: string, source: string): PlanParse {
  const items: ReconciliationItem[] = []
  const 未归类: ReconciliationItem[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let section = ''
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim()
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading !== null) {
      section = heading[1]!.trim()
      continue
    }
    if (!PLAN_SECTIONS.includes(section)) continue
    const bullet = /^[-*]\s+(.+?)\s*$/.exec(line)
    const named = /^(?:名称|事件)[：:]\s*(.+?)\s*$/.exec(line)
    const value = bullet?.[1] ?? named?.[1]
    if (value === undefined) continue
    const clean = value
      .replace(/^事件[：:]\s*/, '')
      .replace(/\s*[〔(（].*?[〕)）]\s*$/, '')
      .trim()
    // 空行与写入器自留的占位不算内容,不必呈报
    if (clean === '' || clean === '〔留白〕' || GENERIC_PLAN_HEADINGS.has(clean)) continue
    const item: ReconciliationItem = { 名称: clean, 来源: `${source}#${index + 1}`, 计划区段: section }
    if (PLAN_NOTE_RE.test(clean)) 未归类.push(item)
    else items.push(item)
  }
  return { items, 未归类 }
}

/**
 * 扫描 `大纲/卷规划/卷NN`。
 * `requirePlan` 为全书对账发现集（须有计划时间线）；否则只计规划目录，供单卷兜底。
 */
function listVolumeNumbers(bookRoot: string, requirePlan: boolean): number[] {
  const base = path.join(bookRoot, '大纲', '卷规划')
  let ents: fs.Dirent[]
  try {
    ents = fs.readdirSync(base, { withFileTypes: true })
  } catch {
    return []
  }
  const volumes = new Set<number>()
  for (const ent of ents) {
    if (!ent.isDirectory() || !ent.name.startsWith('卷')) continue
    const digits = ent.name.slice(1)
    if (!/^\d+$/.test(digits)) continue
    const volume = Number(digits)
    if (!Number.isInteger(volume) || volume <= 0) continue
    if (requirePlan && !fs.existsSync(path.join(base, ent.name, '计划时间线.md'))) continue
    volumes.add(volume)
  }
  return [...volumes].sort((a, b) => a - b)
}

function listPlannedVolumes(bookRoot: string): number[] {
  return listVolumeNumbers(bookRoot, true)
}

function listVolumeDirs(bookRoot: string): number[] {
  return listVolumeNumbers(bookRoot, false)
}

function parseDraftVolume(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined
  const marker = '定稿/卷'
  const start = value.indexOf(marker)
  if (start < 0) return undefined
  const rest = value.slice(start + marker.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return undefined
  const digits = rest.slice(0, slash)
  if (!/^\d+$/.test(digits)) return undefined
  const volume = Number(digits)
  return Number.isInteger(volume) && volume > 0 ? volume : undefined
}

function attributeFactVolume(entry: LedgerEntry, volumeDirs: readonly number[]): number | undefined {
  const attributed = parseDraftVolume(entry.字段['实际落点']) ?? parseDraftVolume(entry.字段['来源'])
  if (attributed !== undefined) return attributed
  if (volumeDirs.length === 1) return volumeDirs[0]!
  return undefined
}

function isUnattributedFact(entry: LedgerEntry, planned: readonly number[], volumeDirs: readonly number[]): boolean {
  const volume = attributeFactVolume(entry, volumeDirs)
  return volume === undefined || !planned.includes(volume)
}

function asFact(entry: LedgerEntry): ReconciliationItem {
  return {
    名称: entry.名称,
    来源: `${entry.来源文件}#${entry.行号}`,
    状态: entry.字段['状态'],
  }
}

/** 章号解析(章级计划形态,任务21 B1):阿拉伯数字或中文数字(一至九十九),非法返回 null。 */
function chapterNoOf(text: string): number | null {
  if (/^\d{1,4}$/.test(text)) return Number(text)
  const chars = [...text]
  if (chars.length === 0 || chars.length > 3) return null
  const values = chars.map((c) => CN_NUMERAL[c])
  if (values.some((v) => v === undefined)) return null
  if (chars.length === 1) return values[0]!
  if (chars.length === 2) {
    if (chars[0] === '十') return 10 + values[1]!
    if (chars[1] === '十') return values[0]! * 10
    return null
  }
  if (chars[1] === '十') return values[0]! * 10 + values[2]!
  return null
}

function timelineEntries(ledger: LedgerQueryResult): readonly LedgerEntry[] {
  return ledger.entries.filter((entry) => entry.分类 === '时间线')
}

function chineseToNumber(text: string): number | undefined {
  return CN_NUMERAL[text]
}

type DueInterval =
  | { readonly kind: 'chapter'; readonly from: number; readonly to: number }
  | { readonly kind: 'volume'; readonly from: number }

function parseDueInterval(raw: string): DueInterval | null {
  const text = raw.trim()
  if (text.startsWith('第') && text.endsWith('章')) {
    const inner = text.slice(1, -1).trim()
    // 单章区间的上界等于下界
    if (/^\d+$/.test(inner)) return { kind: 'chapter', from: Number(inner), to: Number(inner) }
    for (const sep of ['-', '—', '～'] as const) {
      const index = inner.indexOf(sep)
      if (index <= 0) continue
      const left = inner.slice(0, index).trim()
      const right = inner.slice(index + sep.length).trim()
      if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
        return { kind: 'chapter', from: Number(left), to: Number(right) }
      }
    }
  }
  if (text.startsWith('第') && text.endsWith('卷')) {
    const inner = text.slice(1, -1)
    if (/^\d+$/.test(inner)) return { kind: 'volume', from: Number(inner) }
    const from = chineseToNumber(inner)
    if (from !== undefined) return { kind: 'volume', from }
  }
  if (text.startsWith('卷')) {
    const inner = text.slice(1)
    if (/^\d+$/.test(inner)) return { kind: 'volume', from: Number(inner) }
    const from = chineseToNumber(inner)
    if (from !== undefined) return { kind: 'volume', from }
  }
  return null
}

function isDueAt(parsed: DueInterval, key: { readonly 卷: number; readonly 章: number }): boolean {
  return parsed.kind === 'chapter' ? key.章 >= parsed.from : key.卷 >= parsed.from
}

/**
 * 超出上界的幅度。
 *
 * 章号全书连续(格式规格 §2.2),章级区间可直接与当前章号比较;
 * 卷级区间只声明起点、没有上界,不判逾期。
 */
function overdueBy(parsed: DueInterval, key: { readonly 卷: number; readonly 章: number }): number | null {
  if (parsed.kind !== 'chapter') return null
  return key.章 > parsed.to ? key.章 - parsed.to : null
}

function dueItem(entry: LedgerEntry, status: string, overdue: number | null): DueLedgerItem {
  return {
    名称: entry.名称,
    状态: status,
    预期兑现区间: entry.字段['预期兑现区间'] ?? '',
    计划来源: entry.字段['计划来源'] ?? '',
    来源文件: entry.来源文件,
    行号: entry.行号,
    逾期: overdue !== null,
    ...(overdue === null ? {} : { 超出幅度: overdue }),
  }
}

/**
 * 查询当前章到期的已埋/已示线索,无法解析的区间单独列出,不产生写操作。
 *
 * 超过上界仍算到期(直到已收/已弃),但同时标 `逾期` 与 `超出幅度`——
 * 「刚到第 8 章」和「已经第 40 章还没收」对作者是完全不同的紧迫度。`逾期` 是 `到期` 的子集。
 */
export function queryDueLedger(bookRoot: string, key: { readonly 卷: number; readonly 章: number }): DueLedgerResult {
  const ledger = queryLedger(bookRoot, { 分类: '线索', 章上限: key.章 })
  const 到期: DueLedgerItem[] = []
  const 逾期: DueLedgerItem[] = []
  const 区间不明: DueLedgerItem[] = []
  for (const entry of ledger.entries) {
    const status = entry.字段['状态']
    if (status !== '已埋' && status !== '已示') continue
    const parsed = parseDueInterval(entry.字段['预期兑现区间'] ?? '')
    if (parsed === null) {
      区间不明.push(dueItem(entry, status, null))
      continue
    }
    if (!isDueAt(parsed, key)) continue
    const item = dueItem(entry, status, overdueBy(parsed, key))
    到期.push(item)
    if (item.逾期) 逾期.push(item)
  }
  if (!ledger.ok) {
    return { ok: false, kind: ledger.kind, reason: ledger.reason, file: ledger.file, 到期, 逾期, 区间不明 }
  }
  return { ok: true, 到期, 逾期, 区间不明 }
}

/** 对账计划时间线与可归属本卷的定稿事实时间线，不产生写操作。 */
export function reconcileLedger(bookRoot: string, volume: number, suppliedLedger?: LedgerQueryResult): LedgerReconciliationResult {
  const planPath = paths.计划时间线(volume)
  const planText = read(bookRoot, planPath, '计划时间线')
  if (!planText.ok) return planText
  const plan = parsePlanItems(planText.text, planPath)

  const actual = suppliedLedger === undefined ? queryLedger(bookRoot, { 分类: '时间线' }) : suppliedLedger
  if (!actual.ok) return actual
  const volumeDirs = listVolumeDirs(bookRoot)
  const factPairs: { readonly item: ReconciliationItem; readonly 章号: number | null }[] = timelineEntries(actual)
    .filter((entry) => attributeFactVolume(entry, volumeDirs) === volume)
    .map((entry) => ({ item: asFact(entry), 章号: entryChapterNo(entry) }))
  const facts: ReconciliationItem[] = factPairs.map((p) => p.item)
  const plannedByName = new Map(plan.items.map((item) => [normalizeName(item.名称), item]))
  const factByName = new Map(facts.map((item) => [normalizeName(item.名称), item]))
  const matched: ReconciliationItem[] = []
  const plannedOnly: ReconciliationItem[] = []
  const actualOnly: ReconciliationItem[] = []
  const 章级待核对: ChapterLevelPendingItem[] = []
  const 疑似占位待核对: ReconciliationItem[] = []
  const legacyTemplate = isLegacySeedPlan(planText.text)
  for (const item of plan.items) {
    if (factByName.has(normalizeName(item.名称))) { matched.push(item); continue }
    if (legacyTemplate) { 疑似占位待核对.push(item); continue }
    // 章级形态计划项(任务21, B1):按全书章号关联同章事实供核对,不落计划未兑现;
    // 同章任一事件入账不等于内容兑现,不同章号不关联。
    const m = /^第\s*([0-9]{1,4}|[一二三四五六七八九十两]{1,3})\s*章/.exec(item.名称)
    const 章号 = m === null ? null : chapterNoOf(m[1]!)
    if (章号 !== null) {
      章级待核对.push({ 计划项: item, 章号, 本章事实: factPairs.filter((p) => p.章号 === 章号).map((p) => p.item) })
      continue
    }
    plannedOnly.push(item)
  }
  for (const item of facts) {
    if (!plannedByName.has(normalizeName(item.名称))) actualOnly.push(item)
  }
  return {
    ok: true,
    report: {
      卷: volume,
      计划: plan.items,
      事实: facts,
      已匹配: matched,
      计划未兑现: plannedOnly,
      事实未计划: actualOnly,
      未归类计划行: plan.未归类,
      章级待核对,
      疑似占位待核对,
      状态: plannedOnly.length > 0 || actualOnly.length > 0 ? '有偏离' : 章级待核对.length > 0 || 疑似占位待核对.length > 0 ? '待核对' : '无偏离',
    },
  }
}

/** 对账全书各卷计划与可归属事实，不产生写操作。 */
export function reconcileBookLedger(bookRoot: string): BookLedgerReconciliationResult {
  const ledger = queryLedger(bookRoot)
  const volumes = listPlannedVolumes(bookRoot)
  const volumeDirs = listVolumeDirs(bookRoot)
  const reports: LedgerReconciliation[] = []
  for (const volume of volumes) {
    const result = reconcileLedger(bookRoot, volume, ledger)
    if (!result.ok) return result
    reports.push(result.report)
  }
  if (!ledger.ok) return { ok: false, kind: ledger.kind, reason: ledger.reason, file: ledger.file }
  const unattributed = timelineEntries(ledger)
    .filter((entry) => isUnattributedFact(entry, volumes, volumeDirs))
    .map(asFact)
  const drifted = reports.some((report) => report.状态 === '有偏离') || unattributed.length > 0
  const pendingAny = reports.some((report) => report.状态 === '待核对')
  return {
    ok: true,
    report: {
      各卷: reports,
      未归属事实: unattributed,
      状态: drifted ? '有偏离' : pendingAny ? '待核对' : '无偏离',
    },
  }
}
