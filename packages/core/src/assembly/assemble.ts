/**
 * 写作备料(格式规格 §9.2 / 插件规格 §5):从真源切片组装十段材料包,不发明散文。
 * 各段是切片不是全文:体量不随书增长(PRD §10.2 规模不变量 1),由固定条数承担,不设段上限、不截断。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { listChapters, parseWindow, type ChapterKey } from '../derive/scan'
import { entryChapterNo as ledgerEntryChapterNo, queryDueLedger, queryLedger, queryMemory, type LedgerEntry } from '../ledger'
import { parseOutline } from '../outline/parse'
import { extractVersionFields } from '../provenance'
import { writeBatchAtomic, type FileOp } from '../repo/atomic'
import { parseDocument } from '../repo/frontmatter'
import { paths } from '../repo/paths'
import { MACHINE_SCHEMA_VERSION, parseMachineJson, serializeMachineJson } from '../repo/schema'
import { parseSourceRef } from '../repo/sourceRef'
import { 材料预算 } from './budget'
import { 材料包十段, sectionFileName, type 材料包段名, type 材料包状态, type SectionRecord, type MaterialSectionRecord, type SupplementEdit } from './sections'
import { bookWriter } from '../repo/atomic'
import { appendSupplements, type SupplementPreview } from './supplements'
import { readMaterialFile } from './source'
import { canonicalizePath } from '../gate/canonical'

/** F4:时序未定条目的来源与不确定性标注行。 */
function withTimingNote(text: string, entry: LedgerEntry): string {
  return `${text}\n（时序未定;来源:${entry.来源文件}——无法判定该条归属章号,使用时注意与本章时序核对）`
}

export interface AssembleInput {
  readonly 卷: number
  readonly 章: number
  readonly 章名: string
  readonly 补充操作?: readonly SupplementEdit[]
  readonly 仅预览?: boolean
  /** Empty string represents no existing manifest, as returned by preview. */
  readonly 材料清单哈希?: string
}

export interface AssembleResult {
  readonly ok: boolean
  readonly 状态: 材料包状态
  readonly dir: string
  readonly gaps: readonly string[]
  readonly 材料清单哈希?: string
  readonly 合计字数?: number
  readonly 补充预览?: readonly SupplementPreview[]
}

/** 纯算结果(R21 切割):`文件` 是精确写盘载荷,供写入器落盘与脚本 stdout 共用。 */
export interface ComputedMaterials {
  readonly ok: boolean
  readonly 状态: 材料包状态
  readonly dir: string
  readonly gaps: readonly string[]
  readonly 合计字数?: number
  readonly 段?: readonly MaterialSectionRecord[]
  readonly 文件?: readonly FileOp[]
  readonly 已有清单哈希?: string
  readonly 候选清单哈希?: string
  readonly 补充预览?: readonly SupplementPreview[]
}

export interface MaterialManifest {
  readonly schemaVersion: number
  readonly 状态: 材料包状态
  readonly 合计字数: number
  readonly 段: readonly MaterialSectionRecord[]
  readonly 补充协议?: 1
}

function readText(root: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf-8')
  } catch {
    return null
  }
}

function asRefLine(raw: string): string {
  const t = raw.trim()
  return t.startsWith('来源') ? t : `来源:${t}`
}

function resolveInsideBook(bookRoot: string, rel: string): string | null {
  if (rel.includes('..') || /^[a-zA-Z]:/.test(rel) || rel.startsWith('/') || rel.startsWith('\\')) {
    return null
  }
  const abs = path.resolve(bookRoot, rel)
  const rootAbs = path.resolve(bookRoot)
  const prefix = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep
  if (abs !== rootAbs && !abs.startsWith(prefix)) return null
  return abs
}

function versionOf(text: string | null): string {
  if (text === null) return ''
  const r = parseDocument(text)
  if (!r.ok) return ''
  const v = extractVersionFields(r.data.fields).版本
  return v === null ? '' : String(v)
}

function charCount(text: string): number {
  return Array.from(text).length
}

function header(name: 材料包段名, sources: readonly string[]): string {
  const src = sources.length === 0 ? '（无）' : sources.join('；')
  return `# ${name}\n\n来源:${src}\n`
}

function collectWorldbookRels(body: string): string[] {
  const rels: string[] = []
  const seen = new Set<string>()
  const re = /世界书\/[^\s@]+?\.md/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const rel = m[0]!
    if (seen.has(rel)) continue
    seen.add(rel)
    rels.push(rel)
  }
  return rels
}

function sliceFile(bookRoot: string, rel: string): { text: string; missing: boolean } {
  const abs = resolveInsideBook(bookRoot, rel)
  if (abs === null) return { text: '', missing: true }
  const text = readText(bookRoot, rel)
  if (text === null) return { text: '', missing: true }
  return { text, missing: false }
}

/** Remove explicitly dated future facts from a worldbook slice. */
function sliceWorldbookFacts(text: string, chapterLimit: number): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let skip = false
  for (const line of lines) {
    const heading = /^###\s+事实@第\s*(\d{1,4})\s*章\s*$/.exec(line.trim())
    if (heading !== null) {
      skip = Number(heading[1]) > chapterLimit
      if (!skip) out.push(line)
      continue
    }
    if (/^#{2,3}\s+/.test(line.trim()) && !/^###\s+事实@/.test(line.trim())) skip = false
    if (!skip) out.push(line)
  }
  return out.join('\n').trim()
}

/** Filter explicit future chapter claims from a cumulative volume summary. */
function sliceVolumeSummary(text: string, chapterLimit: number): string {
  const lines = bodyOnly(text).split('\n')
  return lines.filter((line) => {
    const numbers = [...line.matchAll(/第\s*(\d{1,4})\s*章/g)].map((match) => Number(match[1]))
    return numbers.length === 0 || numbers.every((number) => number <= chapterLimit)
  }).join('\n').trim()
}

/** 定稿正文的末尾 N 字,起点向后对齐到段落边界,不从段中截。 */
function tailByParagraph(text: string, limit: number): string {
  const norm = text.replace(/\r\n/g, '\n').trim()
  const chars = Array.from(norm)
  if (chars.length <= limit) return norm
  const tail = chars.slice(chars.length - limit).join('')
  const m = /\n\n/.exec(tail)
  return (m ? tail.slice(m.index + 2) : tail).trim()
}

function bodyOnly(text: string): string {
  const r = parseDocument(text)
  return (r.ok ? r.data.body : text).trim()
}

function stripSummaryHeading(text: string): string {
  return bodyOnly(text).replace(/^#\s*章摘要\s*\n+/, '').trim()
}

function extractSection(body: string, title: string): string | null {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const head = new RegExp(`^##\\s+${escaped}(?:\\s*[〔(].+?[〕)])?\\s*$`)
  const start = lines.findIndex((line) => head.test(line.trim()))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i]!.trim())) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).join('\n').trim()
}

function renderLedgerEntry(entry: LedgerEntry): string {
  const lines = [`## ${entry.名称}`]
  for (const [k, v] of Object.entries(entry.字段)) lines.push(`${k}：${v}`)
  lines.push('### 正文', entry.正文 === '' ? '（无正文）' : entry.正文, '')
  return lines.join('\n')
}

/** 组装材料包(R21 切割):纯算零写盘,返回精确写盘载荷;无确认细纲则失败、不产文件。 */
function computeBaseMaterials(bookRoot: string, input: AssembleInput): ComputedMaterials {
  const dir = paths.材料包目录(input.卷, input.章名)
  const confirmedRel = paths.确认细纲(input.卷, input.章, input.章名)
  const confirmedText = readText(bookRoot, confirmedRel)
  if (confirmedText === null) {
    return { ok: false, 状态: '段有缺', dir, gaps: ['确认细纲不存在'] }
  }
  const confirmedDoc = parseDocument(confirmedText)
  if (!confirmedDoc.ok || confirmedDoc.data.fields['状态'] !== '已确认') {
    return { ok: false, 状态: '段有缺', dir, gaps: ['确认细纲状态非已确认'] }
  }

  const parsed = parseOutline(confirmedText)
  const gaps: string[] = []
  const missingRefs: string[] = []
  const sourceLines = parsed.来源引用
  const sourceTexts: string[] = []

  for (const line of sourceLines) {
    const ref = parseSourceRef(asRefLine(line))
    if (ref === null) {
      missingRefs.push(line)
      gaps.push(`来源引用无效:${line}`)
      continue
    }
    if (ref.kind !== '仓内') {
      sourceTexts.push(`${line}\n`)
      continue
    }
    const sliced = sliceFile(bookRoot, ref.path)
    if (sliced.missing) {
      missingRefs.push(ref.path)
      gaps.push(`仓内引用目标不存在:${ref.path}`)
      sourceTexts.push(`${line}\n（缺失）\n`)
    } else {
      sourceTexts.push(`${line}\n`)
    }
  }

  const outlineBody = confirmedDoc.data.body.trim()
  if (outlineBody === '') gaps.push('确认细纲正文为空')

  const hardLines = parsed.constraints.filter((c) => c.mark === '硬').map((c) => c.line)
  const worldRels = collectWorldbookRels(`${outlineBody}\n${sourceLines.join('\n')}`)
  const worldSlices: string[] = []
  for (const rel of worldRels) {
    const sliced = sliceFile(bookRoot, rel)
    if (sliced.missing) {
      missingRefs.push(rel)
      gaps.push(`仓内引用目标不存在:${rel}`)
      worldSlices.push(`## ${rel}\n\n（缺失）\n`)
    } else {
      const worldText = sliceWorldbookFacts(sliced.text, input.章)
      worldSlices.push(`## ${rel}\n\n${worldText || '（本章边界内无已生效事实）'}\n`)
    }
  }

  const 契约 = readText(bookRoot, paths.契约())
  const 卷纲 = readText(bookRoot, paths.卷纲(input.卷))
  const 窗口 = readText(bookRoot, paths.近期窗口(input.卷))

  const windowItem = 窗口 === null ? null : parseWindow(窗口).find((e) => e.name === input.章名) ?? null
  const 信息边界 = parsed.定位['信息边界'] ?? ''
  const 时空 = parsed.定位['时空锚定'] ?? ''

  // ── 近期正文衔接:上一章定稿末尾 N 字(跨卷)＋最近 K 章章摘要＋本卷卷摘要 ──
  const 衔接Parts: string[] = []
  const 衔接Sources: string[] = []
  let 衔接完整: SectionRecord['完整性'] = '完整'
  const chapters = listChapters(bookRoot).filter((k) => k.章 > 0)
  const prev = chapters.find((k) => k.章 === input.章 - 1) ?? null
  // 跨卷(任务21, 件二):卷 N 首章备料带卷 N−1 卷摘要整文件(不按章号过滤,章号全书连续天然在界内);
  // 前一卷无卷摘要如实标缺,不静默省略;来源清单路径自带卷号。
  if (prev !== null && prev.卷 < input.卷) {
    const prevVolSummaryRel = paths.卷摘要(prev.卷)
    const prevVolSummary = readText(bookRoot, prevVolSummaryRel)
    if (prevVolSummary !== null && bodyOnly(prevVolSummary) !== '') {
      衔接Parts.push(`### 卷${String(prev.卷).padStart(2, '0')} 卷摘要\n\n${bodyOnly(prevVolSummary)}`)
      衔接Sources.push(prevVolSummaryRel)
    } else {
      衔接Parts.push(`（卷${String(prev.卷).padStart(2, '0')} 无卷摘要）`)
    }
  }
  if (prev === null) {
    衔接Parts.push('（无上一章定稿）')
    衔接完整 = '空'
  } else {
    const prevRel = paths.定稿章(prev.卷, prev.章, prev.章名)
    const prevText = readText(bookRoot, prevRel)
    if (prevText === null) {
      衔接Parts.push('（无上一章定稿）')
      衔接完整 = '空'
    } else {
      衔接Parts.push(tailByParagraph(bodyOnly(prevText), 材料预算.上一章末尾字数))
      衔接Sources.push(prevRel)
    }
  }
  const summaries: string[] = []
  for (let no = input.章 - 材料预算.最近章摘要数; no < input.章; no += 1) {
    if (no <= 0) continue
    const ck = chapters.find((k) => k.章 === no)
    if (ck === undefined) continue
    const rel = paths.章摘要(ck.卷, ck.章, ck.章名)
    const text = readText(bookRoot, rel)
    if (text === null) continue
    const content = stripSummaryHeading(text)
    if (content === '' || content === '（无摘要沉淀）') continue
    summaries.push(`### 第${String(no).padStart(4, '0')}章 ${ck.章名}\n\n${content}`)
    衔接Sources.push(rel)
  }
  if (summaries.length > 0) 衔接Parts.push(summaries.join('\n\n'))
  const volSummaryRel = paths.卷摘要(input.卷)
  const volSummary = readText(bookRoot, volSummaryRel)
  if (volSummary !== null) {
    const boundedSummary = sliceVolumeSummary(volSummary, input.章)
    if (boundedSummary !== '') 衔接Parts.push(boundedSummary)
    衔接Sources.push(volSummaryRel)
  }
  const 衔接Body = 衔接Parts.filter((p) => p.trim() !== '').join('\n\n') || '（无上一章定稿）'

  // ── 当前事实与连续性:时间线最近 M 条 ＋ 时空锚定命中条目 ──
  // F4(2026-09-05):「世界已发生」边界——目标章之后才发生的事件不入本章材料;
  // 归属无法判定的条目保留并逐条标注来源与不确定性。
  const tlResult = queryLedger(bookRoot, { 分类: '时间线', 章上限: input.章 })
  const tlEntriesAll = tlResult.entries
  const tlEntries = tlEntriesAll.filter((e) => {
    const ch = ledgerEntryChapterNo(e)
    return ch === null || ch <= input.章
  })
  const tlExcluded = tlEntriesAll.length - tlEntries.length
  const recent = tlEntries.slice(-材料预算.时间线最近条数)
  const terms = 时空.split(/[，,、；;。！!？?\s]+/).map((t) => t.trim()).filter((t) => t.length >= 2)
  const hits = tlEntries.filter((e) => terms.some((t) => e.名称.includes(t) || e.正文.includes(t)))
  const pickedTl: LedgerEntry[] = []
  const seenTl = new Set<string>()
  for (const entry of [...recent, ...hits]) {
    if (seenTl.has(entry.名称)) continue
    seenTl.add(entry.名称)
    pickedTl.push(entry)
  }
  const undeterminedTl = pickedTl.filter((e) => ledgerEntryChapterNo(e) === null).length
  const tl边界注 = (tlExcluded > 0 ? `已按目标章(第${input.章}章)边界剔除 ${tlExcluded} 条晚于本章的事实;` : '')
    + (undeterminedTl > 0 ? `含时序未定条目 ${undeterminedTl} 条(来源与不确定性已标注);` : '')
  const tlBody = pickedTl.length === 0
    ? '（无账本时间线）'
    : pickedTl.map((e) => ledgerEntryChapterNo(e) === null ? withTimingNote(renderLedgerEntry(e), e) : renderLedgerEntry(e)).join('\n')
  const tl完整: SectionRecord['完整性'] = tlResult.ok
    ? (pickedTl.length === 0 ? '空' : '完整')
    : (tlResult.kind === 'parse-error' ? '残缺' : (pickedTl.length === 0 ? '空' : '完整'))

  // ── 故事线承诺线索:到期/逾期全文 ＋ 细纲点名全文 ＋ 其余活跃条目一行制 ──
  const activeKinds = ['故事线', '人物弧线', '承诺', '线索'] as const
  const ledgerResult = queryLedger(bookRoot, { 章上限: input.章 })
  const activeEntriesAll = ledgerResult.entries.filter((e) => (activeKinds as readonly string[]).includes(e.分类))
  // F4「世界已发生」边界:归属章号晚于目标章的条目不入本章材料(其状态/兑现尚未发生);
  // 归属无法判定的条目保留并标注不确定性。
  const activeEntries = activeEntriesAll.filter((e) => {
    const ch = ledgerEntryChapterNo(e)
    return ch === null || ch <= input.章
  })
  const due = queryDueLedger(bookRoot, { 卷: input.卷, 章: input.章 })
  const dueNames = new Set<string>(due.ok ? [...due.到期, ...due.逾期].map((d) => d.名称) : [])
  const namedEntries = activeEntries.filter((e) => e.名称 !== '' && outlineBody.includes(e.名称))
  const namedSet = new Set(namedEntries.map((e) => `${e.分类}:${e.名称}`))
  const roster = activeEntries.filter((e) => {
    if (dueNames.has(e.名称) || namedSet.has(`${e.分类}:${e.名称}`)) return false
    return ['进行中', '已埋', '已示'].includes(e.字段['状态'] ?? '')
  })
  const dueFull = activeEntries.filter((e) => dueNames.has(e.名称))
  const ledgerParts: string[] = []
  if (dueFull.length > 0) {
    ledgerParts.push(['### 到期与逾期', '', ...dueFull.map(renderLedgerEntry)].join('\n'))
  }
  if (namedEntries.length > 0) {
    ledgerParts.push(['### 细纲点名', '', ...namedEntries.map(renderLedgerEntry)].join('\n'))
  }
  if (roster.length > 0) {
    ledgerParts.push(['### 其余活跃条目', '', ...roster.map((e) => `- ${e.名称}〔${e.字段['状态'] ?? '？'}〕`)].join('\n'))
  }
  const ledgerBody = ledgerParts.join('\n\n') || '（无账本条目）'
  const ledgerSources = [...new Set(activeEntries.map((e) => e.来源文件))]
  const ledger完整: SectionRecord['完整性'] = ledgerResult.ok
    ? (activeEntries.length === 0 ? '空' : '完整')
    : (ledgerResult.kind === 'parse-error' ? '残缺' : (activeEntries.length === 0 ? '空' : '完整'))

  // ── 暂定与警告:契约文风、卷纲本章窗口段 ＋ 暂定/留白行 ──
  const 契约Body = 契约 === null ? null : bodyOnly(契约)
  const 卷纲Body = 卷纲 === null ? null : bodyOnly(卷纲)
  const 契约禁区 = 契约Body === null ? null : extractSection(契约Body, '创作禁区与不可妥协项')
  const 暂定Parts: string[] = []
  for (const title of ['叙事方式与文风基调']) {
    const section = 契约Body === null ? null : extractSection(契约Body, title)
    if (section !== null && section !== '') 暂定Parts.push(`### 契约·${title}\n\n${section}`)
  }
  const windowName = windowItem?.name ?? input.章名
  let 卷纲段: string | null = null
  if (卷纲Body !== null) {
    const lines = 卷纲Body.split('\n')
    let currentTitle = ''
    const sections = new Map<string, string>()
    for (const line of lines) {
      const m = /^#{2,3}\s+(.+?)\s*$/.exec(line.trim())
      if (m !== null) {
        currentTitle = m[1]!
        sections.set(currentTitle, '')
        continue
      }
      if (currentTitle !== '') sections.set(currentTitle, `${sections.get(currentTitle) ?? ''}${line}\n`)
    }
    const scaffold = ['叙事结构', '弧线', '线索推进', '卷末兑现']
    for (const [title, text] of sections) {
      if (!scaffold.some((name) => title === name || title.startsWith(`${name} `))) continue
      if (title.includes(windowName) || text.includes(windowName)) {
        卷纲段 = `## ${title}${text.trim()}`
        break
      }
    }
  }
  if (卷纲 !== null && 卷纲段 === null) {
    gaps.push(`卷纲中未找到对应窗口内容:四段内无小节命中「${windowName}」,请直读 大纲/卷规划/卷${String(input.卷).padStart(2, '0')}/卷纲.md`)
  }
  if (卷纲段 !== null) 暂定Parts.push(`### 卷纲·本章窗口\n\n${卷纲段}`)
  const 暂定行 = [契约Body ?? '', 卷纲Body ?? ''].join('\n').split('\n').filter((line) => line.includes('〔暂定〕') || line.includes('〔留白〕'))
  if (暂定行.length > 0) 暂定Parts.push(['### 暂定与留白', '', ...暂定行].join('\n'))
  const 暂定Body = 暂定Parts.join('\n\n') || '（无）'
  const 暂定Sources = [...(契约 === null ? [] : [paths.契约()]), ...(卷纲 === null ? [] : [paths.卷纲(input.卷)])]

  // ── 文风:索引类:文风行全量 ＋ 点名条目正文(无点名取最近 J 条);旧格式整文件 ──
  const indexText = readText(bookRoot, paths.本书记忆索引())
  let 文风Body = '（无文风记忆）'
  let 文风Sources: string[] = []
  let 文风完整: SectionRecord['完整性'] = '空'
  if (indexText !== null) {
    const styleRows = indexText.split('\n').filter((line) => line.trim().startsWith('- ') && line.includes('类：文风'))
    const memQuery = queryMemory(bookRoot, { 类: '文风' })
    const styleEntries = memQuery.entries
    const named = styleEntries.filter((e) => outlineBody.includes(`[[${e.名称}]]`) || outlineBody.includes(e.名称))
    const chosen = named.length > 0
      ? named
      : styleEntries.slice(-材料预算.文风最近条数)
    const parts = []
    if (styleRows.length > 0) parts.push(['### 文风索引', '', ...styleRows].join('\n'))
    if (chosen.length > 0) {
      parts.push(['### 条目正文', '', ...chosen.map((e) => `## ${e.名称}\n\n${e.正文}`)].join('\n\n'))
      文风Sources = [...new Set(chosen.map((e) => e.来源文件))]
    } else if (styleRows.length === 0) {
      parts.push('（无文风记忆）')
    }
    文风Body = parts.join('\n\n') || '（无文风记忆）'
    文风Sources = [...new Set([...文风Sources, paths.本书记忆索引()])]
    文风完整 = chosen.length > 0 || styleRows.length > 0 ? '完整' : '空'
  } else {
    const oldText = readText(bookRoot, paths.记忆('文风'))
    if (oldText !== null) {
      文风Body = oldText.trim()
      文风Sources = [paths.记忆('文风')]
      文风完整 = '旧格式'
    }
  }

  type Built = { body: string; 来源: readonly string[]; 版本: string; 选用原因: string; 完整性: SectionRecord['完整性'] }

  const built: Record<材料包段名, Built> = {
    本章任务与确认细纲: {
      body: outlineBody === '' ? '（空）' : outlineBody,
      来源: [confirmedRel],
      版本: versionOf(confirmedText),
      选用原因: '确认细纲为写稿任务真源',
      完整性: outlineBody === '' ? '残缺' : '完整',
    },
    硬约束禁区完成条件: {
      body: [
        契约禁区 && 契约禁区 !== '' ? `### 契约·创作禁区与不可妥协项\n\n${契约禁区}` : '',
        hardLines.length === 0 ? '### 确认细纲〔硬〕\n\n（无硬约束）' : `### 确认细纲〔硬〕\n\n${hardLines.join('\n')}`,
      ].filter((part) => part !== '').join('\n\n'),
      来源: [
        ...(契约禁区 && 契约禁区 !== '' ? [paths.契约()] : []),
        confirmedRel,
      ],
      版本: versionOf(confirmedText),
      选用原因: '契约禁区＋确认细纲〔硬〕行',
      完整性: '完整',
    },
    当前事实与连续性: {
      body: tlBody,
      来源: tlResult.entries.length > 0 ? [...new Set(tlResult.entries.map((e) => e.来源文件))] : [],
      版本: '',
      选用原因: `定稿事实时间切片(最近条目＋本章命中);${tl边界注}`,
      完整性: tl完整,
    },
    '人物、关系、地点、组织、规则、物件': {
      body: worldSlices.length === 0 ? '（无世界书切片）' : worldSlices.join('\n'),
      来源: worldRels,
      版本: '',
      选用原因: '细纲点名的世界书条目切片',
      完整性: worldRels.some((rel) => missingRefs.includes(rel)) ? '残缺' : worldSlices.length === 0 ? '空' : '完整',
    },
    时间位置与信息边界: {
      body: [`### 时空锚定\n\n${时空 || '（空）'}`, `### 信息边界\n\n${信息边界 || '（空）'}`].join('\n\n'),
      来源: [confirmedRel],
      版本: versionOf(confirmedText),
      选用原因: '定位段时空与信息边界',
      完整性: '完整',
    },
    故事线承诺线索: {
      body: ledgerBody,
      来源: ledgerSources,
      版本: '',
      选用原因: '到期逾期与点名全文,其余活跃条目一行制',
      完整性: ledger完整,
    },
    近期正文衔接: {
      body: 衔接Body,
      来源: 衔接Sources,
      版本: '',
      选用原因: '上一章定稿末尾＋最近章摘要＋卷摘要',
      完整性: 衔接完整,
    },
    '文风〔条目切片〕': {
      body: 文风Body,
      来源: 文风Sources,
      版本: '',
      选用原因: '本书文风记忆切片',
      完整性: 文风完整,
    },
    暂定与警告: {
      body: 暂定Body,
      来源: 暂定Sources,
      版本: '',
      选用原因: '契约文风、卷纲本章窗口段、暂定留白行',
      完整性: 契约Body !== null && extractSection(契约Body, '叙事方式与文风基调') !== null && 契约禁区 !== null && 卷纲段 !== null
        ? '完整'
        : 暂定Body === '（无）' ? '空' : '残缺',
    },
    来源与版本清单: {
      body: sourceLines.length === 0 && sourceTexts.length === 0 ? '（无来源清单）' : (sourceTexts.join('\n') || sourceLines.join('\n')),
      来源: sourceLines,
      版本: versionOf(confirmedText),
      选用原因: '确认细纲来源引用清单',
      完整性: sourceLines.length === 0 || missingRefs.length > 0 ? '残缺' : '完整',
    },
  }

  if (built.本章任务与确认细纲.完整性 !== '完整') {
    if (!gaps.includes('确认细纲正文为空')) gaps.push('确认细纲正文为空')
  }
  if (built.来源与版本清单.完整性 !== '完整' && sourceLines.length === 0) {
    gaps.push('来源清单为空')
  }

  const 状态: 材料包状态 = gaps.length === 0 ? '段齐备' : '段有缺'
  let 合计字数 = 0
  const records: SectionRecord[] = 材料包十段.map((name) => {
    const b = built[name]
    const 字数 = charCount(b.body)
    合计字数 += 字数
    return {
      段: name,
      来源: b.来源,
      版本: b.版本,
      选用原因: b.选用原因,
      完整性: b.完整性,
      字数,
    }
  })

  const 文件: FileOp[] = 材料包十段.map((name, i) => {
    return {
      relPath: path.posix.join(dir, sectionFileName(i, name)),
      content: `${header(name, built[name].来源)}\n${built[name].body.trim()}\n`,
    }
  })
  文件.push({
    relPath: path.posix.join(dir, '材料清单.json'),
    content: serializeMachineJson({ 状态, 合计字数, 段: records }, MACHINE_SCHEMA_VERSION),
  })

  return { ok: 状态 === '段齐备', 状态, dir, gaps, 合计字数, 段: records, 文件 }
}

export function computeMaterials(bookRoot: string, input: AssembleInput): ComputedMaterials {
  return appendSupplements(bookRoot, input, computeBaseMaterials(bookRoot, input))
}

/** 组装并落盘材料包：十段与补充清单/附件同批写入，重建保留补充快照。 */
function assembleMaterialsLocked(bookRoot: string, input: AssembleInput): AssembleResult {
  const c = computeMaterials(bookRoot, input)
  if (c.文件 === undefined) return { ok: false, 状态: c.状态, dir: c.dir, gaps: c.gaps }
  if ((input.补充操作?.length ?? 0) > 0 && input.材料清单哈希 !== c.已有清单哈希) {
    // Retry after a lost reply can succeed as an exact no-op; never overwrite a newer package.
    const root = canonicalizePath(bookRoot)
    const alreadyWritten = c.文件.every(file => { try { return readMaterialFile(root, file.relPath).text === file.content } catch { return false } })
    if (!alreadyWritten) return { ok: false, 状态: '有冲突', dir: c.dir, gaps: ['材料清单已变化或尚未预览，请重新预览并核对补充'] }
  } else {
    writeBatchAtomic(bookRoot, c.文件)
  }
  return { ok: c.ok, 状态: c.状态, dir: c.dir, gaps: c.gaps, 材料清单哈希: c.候选清单哈希, 合计字数: c.合计字数, 补充预览: c.补充预览 }
}

const writeMaterials = bookWriter(assembleMaterialsLocked)
export function assembleMaterials(bookRoot: string, input: AssembleInput): AssembleResult {
  if (input.仅预览) {
    const c = computeMaterials(bookRoot, input)
    return { ok: c.ok, 状态: c.状态, dir: c.dir, gaps: c.gaps, 材料清单哈希: c.已有清单哈希, 合计字数: c.合计字数, 补充预览: c.补充预览 }
  }
  return writeMaterials(bookRoot, input)
}

export function readManifest(bookRoot: string, key: Pick<ChapterKey, '卷' | '章名'>): MaterialManifest | null {
  const text = readText(bookRoot, path.posix.join(paths.材料包目录(key.卷, key.章名), '材料清单.json'))
  if (text === null) return null
  const r = parseMachineJson(text, MACHINE_SCHEMA_VERSION)
  if (!r.ok) return null
  const 状态 = typeof r.data['状态'] === 'string' ? r.data['状态'] as 材料包状态 : '组装中'
  const 合计字数 = typeof r.data['合计字数'] === 'number' ? r.data['合计字数'] : 0
  const 段 = Array.isArray(r.data['段']) ? r.data['段'] as MaterialSectionRecord[] : []
  return { schemaVersion: MACHINE_SCHEMA_VERSION, 状态, 合计字数, 段, ...(r.data['补充协议'] === 1 ? { 补充协议: 1 as const } : {}) }
}
