/**
 * 设计侧链式推导(格式规格 §8 末条):纯函数,不落地第二套状态。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseDocument } from '../repo/frontmatter'
import { CN_NUMERAL, pad, paths } from '../repo/paths'
import { parseWindow } from './scan'
import { isWindowEntryReady } from './states'
import { hasDesignContent, parseDesignContent } from '../design/content'
import { isLegacySeedPlan } from '../design/legacy-seed'

export interface DesignContentIssue {
  readonly 路径: string
  readonly 分部: string
  readonly 问题: '缺少内容' | '缺少分部' | '状态冲突' | '疑似模板占位'
  readonly 阶段: DesignPosition
}

export type DesignPosition =
  | '灵感阶段'
  | '作品定调'
  | '世界构建'
  | '故事骨架'
  | '分卷布局'
  | '当前卷规划'
  | '开写就绪'

export interface DesignFacts {
  readonly 书仓存在: boolean
  readonly 构想冻结: boolean
  readonly 契约六部已确认: boolean
  readonly 世界书最小模块足够: boolean
  readonly 骨架当前阶段已确认: boolean
  readonly 当前卷分配完整: boolean
  readonly 卷纲存在: boolean
  readonly 卷纲缺段?: readonly string[]
  readonly 计划时间线存在: boolean
  readonly 近期窗口存在: boolean
  readonly 窗口有可进入条目: boolean
  readonly 内容问题?: readonly DesignContentIssue[]
}

/** 设计面事实清单(R1):逐项如实报告;`建议` 是可选建议,无权威、不参与门禁。 */
export interface DesignDerivation {
  readonly 事实项: ReadonlyArray<{ readonly 名称: string; readonly 事实: boolean }>
  readonly 建议: DesignPosition
  readonly 内容问题: readonly DesignContentIssue[]
}

/** 契约六个核心部分(格式规格 §3.1)。 */
export const 契约六部 = [
  '题材与读者定位',
  '核心看点与差异化',
  '阅读体验与情绪承诺',
  '主角原则与关系边界',
  '叙事方式与文风基调',
  '创作禁区与不可妥协项',
] as const

/** M0 世界书最小模块:人物档案 + 世界规则,各至少一条已确认。 */
export const 世界书最小模块 = ['人物档案', '世界规则'] as const

/** 故事骨架九个核心部分(格式规格 §3.2 / D25)。 */
export const 故事骨架九部 = [
  '主角目标与成长轨迹',
  '核心冲突与对抗力量',
  '故事阶段与关键转折',
  '人物弧线与关系发展',
  '主线与支线',
  '线索悬念伏笔',
  '信息披露',
  '读者承诺与兑现',
  '结局方向与远期锚点',
] as const

/** 分卷布局八个核心部分(格式规格 §3.2 / D26)。 */
export const 分卷布局八部 = [
  '故事阶段分配',
  '卷目标与卷末状态',
  '主线与支线分布',
  '人物弧线分布',
  '承诺与兑现分布',
  '信息披露分布',
  '卷节奏与体量',
  '卷间衔接',
] as const

const BOOK_MARKERS = ['作品契约', '构想', '大纲', '世界书', '定稿', '账本', '本书记忆', '草稿区'] as const

export function deriveDesign(f: DesignFacts): DesignDerivation {
  const 内容问题 = f.内容问题 ?? []
  const contentMissing = (stage: DesignPosition) => 内容问题.some(issue => issue.阶段 === stage)
  const 事实项 = [
    { 名称: '书仓存在', 事实: f.书仓存在 },
    { 名称: '构想冻结', 事实: f.构想冻结 },
    { 名称: '契约六部已确认', 事实: f.契约六部已确认 },
    { 名称: '世界书最小模块足够', 事实: f.世界书最小模块足够 },
    { 名称: '骨架当前阶段已确认', 事实: f.骨架当前阶段已确认 },
    { 名称: '当前卷分配完整', 事实: f.当前卷分配完整 },
    { 名称: '卷纲存在', 事实: f.卷纲存在 },
    { 名称: '计划时间线存在', 事实: f.计划时间线存在 },
    { 名称: '近期窗口存在', 事实: f.近期窗口存在 },
    { 名称: '窗口有可进入条目', 事实: f.窗口有可进入条目 },
  ] as const
  const 建议: DesignPosition = (() => {
    if (!f.书仓存在 || !f.构想冻结) return '灵感阶段'
    if (!f.契约六部已确认 || contentMissing('作品定调')) return '作品定调'
    if (!f.世界书最小模块足够 || contentMissing('世界构建')) return '世界构建'
    if (!f.骨架当前阶段已确认 || contentMissing('故事骨架')) return '故事骨架'
    if (!f.当前卷分配完整 || contentMissing('分卷布局')) return '分卷布局'
    if (!f.卷纲存在 || !f.计划时间线存在 || !f.近期窗口存在 || !f.窗口有可进入条目 || contentMissing('当前卷规划')) {
      return '当前卷规划'
    }
    return '开写就绪'
  })()
  return { 事实项, 建议, 内容问题 }
}

export function scanDesign(root: string, 卷 = 1): DesignFacts {
  const 内容问题: DesignContentIssue[] = []
  const sections = (text: string | null, relative: string, names: readonly string[], stage: DesignPosition) => {
    const parts = parseDesignContent(text ?? '')
    for (const name of names) {
      const hits = parts.filter(part => part.名称 === name)
      const states = new Set(hits.map(part => part.状态))
      const 问题 = hits.length === 0 ? '缺少分部' : states.size > 1 ? '状态冲突' : hits.some(part => !part.有内容) ? '缺少内容' : undefined
      if (问题) 内容问题.push({ 路径: relative, 分部: name, 问题, 阶段: stage })
    }
  }
  const 书仓存在 = BOOK_MARKERS.some((d) => exists(path.join(root, d)))
  const 构想冻结 = readText(root, paths.构想快照()) !== null

  const 契约文 = readText(root, paths.契约())
  const 契约六部已确认 = 契约文 !== null && allLabeledConfirmed(parseLabeledStates(契约文), 契约六部)
  sections(契约文, paths.契约(), 契约六部, '作品定调')

  const 声明 = readText(root, '世界书/模块声明.md')
  const 世界书最小模块足够 = 声明 !== null && 世界书最小模块.every((名) =>
    声明.includes(名) && moduleHasConfirmedEntry(root, 名),
  )
  for (const module of 世界书最小模块) {
    const dir = path.join(root, '世界书', module)
    const empty: string[] = []
    let hasContent = false
    let names: string[] = []
    try { names = fs.readdirSync(dir) } catch { /* Missing module is already a false fact. */ }
    for (const name of names.filter(name => name.endsWith('.md'))) {
      const relative = `世界书/${module}/${name}`
      const doc = parseDocument(readText(root, relative) ?? '')
      if (!doc.ok || doc.data.fields['状态'] !== '已确认') continue
      if (hasDesignContent(doc.data.body)) hasContent = true
      else empty.push(relative)
    }
    if (!hasContent) for (const relative of empty) 内容问题.push({ 路径: relative, 分部: module, 问题: '缺少内容', 阶段: '世界构建' })
  }

  const 骨架文 = readText(root, paths.故事骨架())
  const 骨架条目 = 骨架文 === null ? [] : parseLabeledStates(骨架文)
  const 骨架当前阶段已确认 = 骨架文 !== null && 骨架条目.length > 0 && 骨架条目.every((e) => e.state === '已确认')
  sections(骨架文, paths.故事骨架(), 故事骨架九部, '故事骨架')

  const 分卷文 = readText(root, paths.分卷布局())
  const allocations = parseVolumeAllocations(分卷文 ?? '').filter(item => item.卷 === 卷)
  const 当前卷分配完整 = allocations.some(a => a.有效状态 === '已确认')
  const volumeParts = parseDesignContent(分卷文 ?? '')
  for (const row of allocations) {
    const name = row.名称.replace(/\s*[〔(].+?[〕)]\s*$/, '').trim()
    const part = volumeParts.find(part => part.名称 === name)
    const 问题 = row.冲突 ? '状态冲突' : part?.有内容 ? undefined : '缺少内容'
    if (问题) 内容问题.push({ 路径: paths.分卷布局(), 分部: name, 问题, 阶段: '分卷布局' })
  }

  const 卷纲存在 = readText(root, paths.卷纲(卷)) !== null
  sections(readText(root, paths.卷纲(卷)), paths.卷纲(卷), ['叙事结构'], '当前卷规划')
  const 卷纲缺段: string[] = []
  if (卷纲存在) {
    const volumeText = readText(root, paths.卷纲(卷)) ?? ''
    const titles = new Set<string>()
    for (const line of volumeText.split(/\r?\n/)) {
      const m = /^##\s+(.+?)\s*$/.exec(line.trim())
      if (m !== null) titles.add((m[1] ?? '').replace(/\s*[〔(](?:已确认|留白|暂定)[〕)]\s*$/, '').trim())
    }
    for (const name of ['叙事结构', '弧线', '线索推进', '卷末兑现']) {
      if (!titles.has(name)) 卷纲缺段.push(name)
    }
  }
  for (const name of 卷纲缺段.filter(name => name !== '叙事结构')) 内容问题.push({ 路径: paths.卷纲(卷), 分部: name, 问题: '缺少分部', 阶段: '当前卷规划' })
  const planText = readText(root, paths.计划时间线(卷))
  const 计划时间线存在 = planText !== null
  if (planText !== null && !hasDesignContent(planText.replace(/〔(?:已确认|暂定)〕/g, ''))) {
    内容问题.push({ 路径: paths.计划时间线(卷), 分部: '计划时间线', 问题: '缺少内容', 阶段: '当前卷规划' })
  } else if (planText !== null && isLegacySeedPlan(planText)) {
    内容问题.push({ 路径: paths.计划时间线(卷), 分部: '计划时间线', 问题: '疑似模板占位', 阶段: '当前卷规划' })
  }
  const 窗口文 = readText(root, paths.近期窗口(卷))
  const 近期窗口存在 = 窗口文 !== null
  const 窗口有可进入条目 = 窗口文 !== null && parseWindow(窗口文).some((e) => isWindowEntryReady(e.state))

  return {
    书仓存在,
    构想冻结,
    契约六部已确认,
    世界书最小模块足够,
    骨架当前阶段已确认,
    当前卷分配完整,
    卷纲存在,
    卷纲缺段,
    计划时间线存在,
    近期窗口存在,
    窗口有可进入条目,
    内容问题,
  }
}

/** 分卷布局卷行分配条目(任务21, B2/F21-3):行级标注优先、缺标注继承所属小节、皆无则缺失。 */
export interface VolumeAllocation {
  readonly 卷: number
  /** 卷行原文名(如「卷二·誊正（江州府城，3 案／15 章）」)。 */
  readonly 名称: string
  readonly 行级状态: string | null
  readonly 小节状态: string | null
  /** 行级 ?? 小节级;皆无为 null(缺失,不算已确认);冲突恒为 null。 */
  readonly 有效状态: string | null
  /** 同卷多行互斥，或正式分配段与行级状态矛盾：呈报冲突，不静默放行。 */
  readonly 冲突?: boolean
}

/** 卷行确认门槛的可接受行级/小节级状态词(计划族基础态;缺失不默认确认)。 */
const ALLOCATION_STATES = new Set(['已确认', '暂定', '留白'])

interface AllocationRow {
  readonly 卷: number
  readonly 名称: string
  readonly 行级状态: string | null
  readonly 小节状态: string | null
}

/**
 * 分卷布局卷行解析(scanDesign 与 scanDesignDetail 同一口径,任务21 B2/F21-3):
 * 只认「故事阶段分配」小节的卷行——该小节存在即严格范围(即使为空),其他小节的卷行一律不计;
 * 继承只来自该小节的标注,不能从别的小节或嵌套标题借状态。
 * 无「故事阶段分配」小节(legacy 旧书)时回退:只认全文自带行级状态词(〔已确认/暂定/留白〕)的卷行,无标注行不计。
 * 同卷出现有效状态互斥的多行分配，或正式段与显式行级矛盾 → 冲突(有效状态=null)。
 * legacy 回退的其他小节不为行级状态提供确认依据，也不制造层级冲突。
 */
export function parseVolumeAllocations(分卷文: string): readonly VolumeAllocation[] {
  const sectionRe = /^\s*#{1,6}\s+(.+?)\s*(?:[〔(]\s*(.+?)\s*[〕)])?\s*$/
  const rowRe = /^\s*-\s+(卷(?:\d+|[一二三四五六七八九十两]+))(?:[·\s：:〔(（]|$)(.*)$/
  const tailStateRe = /[〔(]\s*([^〔〕()（）]+?)\s*[〕)]\s*$/
  interface Section {
    readonly name: string
    readonly state: string | null
    readonly rows: AllocationRow[]
  }
  const sections: Section[] = []
  const preambleRows: AllocationRow[] = []
  let current: Section | null = null
  for (const line of 分卷文.split('\n')) {
    const section = sectionRe.exec(line.trim())
    if (section !== null) {
      const state = section[2]?.trim()
      current = { name: section[1]!.trim(), state: state !== undefined && ALLOCATION_STATES.has(state) ? state : null, rows: [] }
      sections.push(current)
      continue
    }
    const row = rowRe.exec(line)
    if (row === null) continue
    const numeral = row[1]!.slice(1)
    const 卷 = /^\d+$/.test(numeral) ? Number(numeral) : CN_NUMERAL[numeral]
    if (卷 === undefined) continue
    const tail = tailStateRe.exec(row[2] ?? '')
    const tailState = tail?.[1]?.trim()
    const 行级状态 = tailState !== undefined && ALLOCATION_STATES.has(tailState) ? tailState : null
    const entry: AllocationRow = { 卷, 名称: line.trim().replace(/^-\s+/, ''), 行级状态, 小节状态: current?.state ?? null }
    if (current === null) preambleRows.push(entry)
    else current.rows.push(entry)
  }
  const formal = sections.find((s) => s.name === '故事阶段分配')
  const counted: readonly AllocationRow[] = formal !== undefined
    ? formal.rows
    : [...preambleRows, ...sections.flatMap((s) => s.rows)].filter((r) => r.行级状态 !== null)
  const byVol = new Map<number, AllocationRow[]>()
  for (const r of counted) {
    const list = byVol.get(r.卷) ?? []
    list.push(r)
    byVol.set(r.卷, list)
  }
  const out: VolumeAllocation[] = []
  for (const [卷, rows] of [...byVol.entries()].sort((a, b) => a[0] - b[0])) {
    const states = new Set(rows.map((r) => r.行级状态 ?? r.小节状态))
    const levelConflict = formal !== undefined && rows.some(row => row.行级状态 !== null && row.小节状态 !== null && row.行级状态 !== row.小节状态)
    if (states.size > 1 || levelConflict) {
      for (const r of rows) out.push({ 卷, 名称: r.名称, 行级状态: r.行级状态, 小节状态: r.小节状态, 有效状态: null, 冲突: true })
    } else {
      for (const r of rows) out.push({ 卷, 名称: r.名称, 行级状态: r.行级状态, 小节状态: r.小节状态, 有效状态: r.行级状态 ?? r.小节状态 })
    }
  }
  return out
}

/** `- 名称 〔状态〕` 或 `## 名称 〔状态〕`。 */
export function parseLabeledStates(text: string): ReadonlyArray<{ name: string; state: string }> {
  const out: Array<{ name: string; state: string }> = []
  for (const line of text.split('\n')) {
    const list = /^\s*-\s+(.+?)\s*[〔(]\s*(.+?)\s*[〕)]\s*$/.exec(line)
    if (list) {
      out.push({ name: list[1]!.trim(), state: list[2]!.trim() })
      continue
    }
    const heading = /^\s*#{1,6}\s+(.+?)\s*[〔(]\s*(.+?)\s*[〕)]\s*$/.exec(line)
    if (heading) out.push({ name: heading[1]!.trim(), state: heading[2]!.trim() })
  }
  return out
}

function allLabeledConfirmed(entries: ReadonlyArray<{ name: string; state: string }>, required: readonly string[]): boolean {
  return required.every((name) => entries.some((e) => e.name === name && e.state === '已确认'))
}

function moduleHasConfirmedEntry(root: string, 模块: string): boolean {
  const dir = path.join(root, '世界书', 模块)
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return false }
  return names.some((name) => {
    if (!name.endsWith('.md')) return false
    const text = readText(root, path.posix.join('世界书', 模块, name).replace(/\\/g, '/'))
    if (text === null) return false
    const r = parseDocument(text)
    return r.ok && r.data.fields['状态'] === '已确认'
  })
}

function readText(root: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf-8')
  } catch {
    return null
  }
}

function exists(abs: string): boolean {
  try {
    return fs.existsSync(abs)
  } catch {
    return false
  }
}
