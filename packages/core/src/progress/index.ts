/**
 * 书级进度与状态面(B 任务,2026-08-29):
 * 一条原则——能算的现算,只写「算不出来的」。工件状态/计数/章进度一律现算,
 * 落盘只落两样:待补便签(随工件走 design:)与偏离处置结论(作者层记忆,书房)。
 * 书级进度卡不进 context;由主 Agent 在选完书、动设计侧节点前显式查询。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { writeFileAtomic } from '../repo/atomic'
import { parseDocument } from '../repo/frontmatter'
import { pad, paths } from '../repo/paths'
import { canonicalizeChapterKeys, listChapters, parseWindow, scanChapter, type ChapterKey } from '../derive/scan'
import { deriveChapterFacts } from '../derive/derive'
import { parseLabeledStates, parseVolumeAllocations, 契约六部, 故事骨架九部, 分卷布局八部 } from '../derive/design'
import { isWindowEntryReady } from '../derive/states'
import type { LastCommitResult } from '../commit/history'
import { bookWriter } from '../repo/atomic'

export interface DesignPartDetail {
  readonly 名称: string
  readonly 状态: string
  readonly 待补: readonly string[]
  /** 标「已确认」却只有状态标注、没有正文(不参与推导,只作提示)。 */
  readonly 无内容?: true
}

export interface DesignDocDetail {
  readonly 路径: string
  readonly 分部: readonly DesignPartDetail[]
}

export interface VolumePlanDetail {
  readonly 卷号: number
  readonly 卷纲: readonly DesignPartDetail[]
  readonly 计划时间线: { readonly 覆盖至: string | null; readonly 条目数: number }
  readonly 近期窗口: { readonly 条目: readonly { readonly 名称: string; readonly 状态: string }[]; readonly 余量: number }
}

export interface WorldbookModuleDetail {
  readonly 名称: string
  readonly 条目数: number
  readonly 已确认数: number
  /** 已确认但正文为空的条目名(只提示,不影响已确认数)。 */
  readonly 无正文?: readonly string[]
}

export interface ChapterProgress {
  readonly 已定稿: readonly { readonly 卷: number; readonly 章: number; readonly 章名: string }[]
  readonly 活跃章: ChapterKey | null
}

export interface DesignDetail {
  readonly 契约: DesignDocDetail
  readonly 骨架: DesignDocDetail
  readonly 分卷: DesignDocDetail & { readonly 各卷: readonly { readonly 卷号: number; readonly 状态: string }[] }
  readonly 卷规划: readonly VolumePlanDetail[]
  readonly 世界书: {
    readonly 已声明模块: readonly string[]
    readonly 未声明模块: readonly string[]
    readonly 各模块: readonly WorldbookModuleDetail[]
  }
  readonly 章进度: ChapterProgress
}

function readText(root: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf-8')
  } catch {
    return null
  }
}

/**
 * 解析一个文档:每个带标注条目(##/###/`- 名称 〔状态〕`)下挂其后的 `待补：` 行,并判「无内容」。
 * 内容区:标题分部延伸到下一个同级或更高级的标题分部(其下带标注的列表行——如分卷卷行——算内容);
 * 列表分部到下一个带标注条目为止,`名称：说明` 式行内文字也算内容。`待补：` 便签不算内容。
 */
function parseDocDetail(text: string): DesignPartDetail[] {
  const lines = text.split('\n')
  const parts: { 名称: string; 状态: string; line: number; level: number }[] = []
  const entry = /^\s*(?:#{1,6}\s+)?-\s+(.+?)\s*[〔(]\s*(.+?)\s*[〕)]\s*$/
  const heading = /^\s*(#{1,6})\s+(.+?)\s*[〔(]\s*(.+?)\s*[〕)]\s*$/
  for (const [i, line] of lines.entries()) {
    const h = heading.exec(line)
    const m = h === null ? entry.exec(line) : null
    if (h !== null) parts.push({ 名称: h[2]!.trim(), 状态: h[3]!.trim(), line: i, level: h[1]!.length })
    else if (m !== null) parts.push({ 名称: m[1]!.trim(), 状态: m[2]!.trim(), line: i, level: Infinity })
  }
  return parts.map((p, index) => {
    const next = parts[index + 1]
    const upper = next === undefined ? lines.length : next.line
    const 待补: string[] = []
    for (let i = p.line + 1; i < upper; i++) {
      const t = lines[i]!.trim()
      if (t.startsWith('待补：') || t.startsWith('待补:')) 待补.push(t.replace(/^待补[:：]\s*/, ''))
    }
    const contentEnd = p.level === Infinity
      ? upper
      : parts.slice(index + 1).find((q) => q.level <= p.level)?.line ?? lines.length
    const 有内容 = /[：:]\s*\S/.test(p.名称)
      || lines.slice(p.line + 1, contentEnd).some((l) => l.trim() !== '' && !PENDING_RE.test(l))
    return { 名称: p.名称, 状态: p.状态, 待补, ...(p.状态 === '已确认' && !有内容 ? { 无内容: true as const } : {}) }
  })
}

function walkFiles(dir: string, fn: (abs: string) => void): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(abs, fn)
    else if (e.isFile()) fn(abs)
  }
}

/** 设计侧明细扫描(现算,不落盘);词表与路径全部复用既有定义,不另立第二套。 */
export function scanDesignDetail(bookRoot: string): DesignDetail {
  const 契约文 = readText(bookRoot, paths.契约())
  const 骨架文 = readText(bookRoot, paths.故事骨架())
  const 分卷文 = readText(bookRoot, paths.分卷布局())

  // 契约分部按六部全量给出(未写的部标「留白」),骨架/分卷按实际标注行。
  const 契约标注 = new Map(parseDocDetail(契约文 ?? '').map((p) => [p.名称, p]))
  const 契约分部: DesignPartDetail[] = 契约文 === null ? [] : 契约六部.map((n) => {
    const hit = 契约标注.get(n)
    return hit ?? { 名称: n, 状态: '留白', 待补: [] }
  })

  // 卷行分配与 scanDesign 同一解析口径(任务21 B2/F21-3):行级优先、缺标注继承小节、缺失不报已确认;
  // 同卷冲突呈报「冲突」,同态重复行去重。
  const 各卷: { 卷号: number; 状态: string }[] = []
  for (const a of parseVolumeAllocations(分卷文 ?? '')) {
    const existing = 各卷.find((v) => v.卷号 === a.卷)
    if (existing !== undefined) {
      if (a.冲突 === true) existing.状态 = '冲突'
      continue
    }
    各卷.push({ 卷号: a.卷, 状态: a.冲突 === true ? '冲突' : (a.有效状态 ?? '缺失') })
  }

  // 卷规划:扫描已有的卷目录(不预设只看当前卷)。
  const 卷规划: VolumePlanDetail[] = []
  const 卷规划根 = path.join(bookRoot, '大纲/卷规划')
  let 卷目录: string[] = []
  try {
    卷目录 = fs.readdirSync(卷规划根).filter((n) => /^卷\d+$/.test(n)).sort()
  } catch {
    卷目录 = []
  }
  for (const name of 卷目录) {
    const 卷号 = Number(name.replace(/^卷/, ''))
    const 卷纲文 = readText(bookRoot, paths.卷纲(卷号))
    const 时间线文 = readText(bookRoot, paths.计划时间线(卷号))
    const 窗口文 = readText(bookRoot, paths.近期窗口(卷号))
    const 时间线条目 = 时间线文 === null ? [] : parseLabeledStates(时间线文)
    const 窗口条目 = 窗口文 === null ? [] : parseWindow(窗口文)
    卷规划.push({
      卷号,
      卷纲: 卷纲文 === null ? [] : parseDocDetail(卷纲文),
      计划时间线: {
        覆盖至: 时间线条目.length === 0 ? null : 时间线条目[时间线条目.length - 1]!.name,
        条目数: 时间线条目.length,
      },
      近期窗口: {
        条目: 窗口条目.map((e) => ({ 名称: e.name, 状态: e.state })),
        余量: 窗口条目.filter((e) => isWindowEntryReady(e.state)).length,
      },
    })
  }

  // 世界书:声明 + 目录扫描。
  const 声明文 = readText(bookRoot, '世界书/模块声明.md')
  const 已声明模块 = 声明文 === null ? [] : (声明文.split('\n').map((l) => /^\s*[-#]\s*(.+?)\s*$/.exec(l)?.[1]?.trim() ?? '').filter((n) => n !== '' && !n.includes('〔') && n !== '模块声明'))
  let 模块目录: string[] = []
  try {
    模块目录 = fs.readdirSync(path.join(bookRoot, '世界书'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    模块目录 = []
  }
  const 未声明模块 = 模块目录.filter((m) => !已声明模块.includes(m))
  const 各模块: WorldbookModuleDetail[] = 模块目录.map((m) => {
    let names: string[] = []
    try {
      names = fs.readdirSync(path.join(bookRoot, '世界书', m)).filter((n) => n.endsWith('.md'))
    } catch {
      names = []
    }
    let 已确认数 = 0
    const 无正文: string[] = []
    for (const n of names) {
      const text = readText(bookRoot, `世界书/${m}/${n}`)
      const r = text === null ? { ok: false } as const : parseDocument(text)
      if (!r.ok || r.data.fields['状态'] !== '已确认') continue
      已确认数++
      // 只剩标题行(写入器缺省正文是 `# 名称`)即无正文
      if (!r.data.body.split('\n').some((l) => l.trim() !== '' && !/^\s*#/.test(l))) 无正文.push(n.replace(/\.md$/, ''))
    }
    return { 名称: m, 条目数: names.length, 已确认数, ...(无正文.length === 0 ? {} : { 无正文 }) }
  })

  // 章进度:定稿目录扫描 + 活跃章(第一个未定稿章)。
  const 已定稿: { 卷: number; 章: number; 章名: string }[] = []
  walkFiles(path.join(bookRoot, '定稿'), (abs) => {
    const m = /定稿[\\/]卷(\d+)[\\/](\d+)-(.+)\.md$/.exec(abs)
    if (m) 已定稿.push({ 卷: Number(m[1]), 章: Number(m[2]), 章名: m[3]! })
  })
  已定稿.sort((a, b) => a.卷 - b.卷 || a.章 - b.章)
  const 定稿集合 = new Set(已定稿.map((c) => `${c.卷}/${c.章}/${c.章名}`))
  const 活跃章 = canonicalizeChapterKeys(listChapters(bookRoot)).find((k) => !定稿集合.has(`${k.卷}/${k.章}/${k.章名}`)) ?? null

  return {
    契约: { 路径: paths.契约(), 分部: 契约分部 },
    骨架: { 路径: paths.故事骨架(), 分部: parseDocDetail(骨架文 ?? '') },
    分卷: { 路径: paths.分卷布局(), 分部: parseDocDetail(分卷文 ?? ''), 各卷 },
    卷规划,
    世界书: { 已声明模块, 未声明模块, 各模块 },
    章进度: { 已定稿, 活跃章 },
  }
}

/** 便签行(写入与清除共用)。 */
const PENDING_RE = /^\s*待补[:：]/

/**
 * 待补便签写入器(算不出来的才落盘):在 relPath 工件的「节名」分节内写/清 `待补：<文本>` 行。
 * 文本 null 表示清除该节全部便签(补齐后清理)。真源改动,必须经工具(novel_note_pending)并 design: 提交。
 */
function writePendingLocked(bookRoot: string, relPath: string, 节名: string, 文本: string | null):
  | { readonly ok: true; readonly relPath: string }
  | { readonly ok: false; readonly reason: string } {
  const text = readText(bookRoot, relPath)
  if (text === null) return { ok: false, reason: `工件不存在:${relPath}` }
  const lines = text.split('\n')
  const escaped = 节名.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const heading = new RegExp(`^\\s*#{1,6}\\s+${escaped}\\s*$`)
  const labeled = new RegExp(`^\\s*#{0,6}\\s*-\\s+${escaped}\\s*[〔(]`)
  const boundary = /^\s*(?:#{1,6}\s+.*|#{0,6}\s*-\s+.+\s*[〔(].+\s*[〕)])\s*$/
  let start = -1
  for (const [i, line] of lines.entries()) {
    if (heading.test(line) || labeled.test(line)) {
      start = i
      break
    }
  }
  if (start === -1) return { ok: false, reason: `工件「${relPath}」中没有分节「${节名}」` }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (boundary.test(lines[i]!)) {
      end = i
      break
    }
  }
  const kept: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (i > start && i < end && PENDING_RE.test(lines[i]!)) continue
    kept.push(lines[i]!)
  }
  if (文本 !== null && 文本.trim() !== '') {
    const insertAt = Math.min(end, kept.length)
    kept.splice(insertAt, 0, `待补：${文本.trim()}`)
  }
  writeFileAtomic(bookRoot, relPath, kept.join('\n'))
  return { ok: true, relPath }
}

export const writePending = bookWriter(writePendingLocked)

/** 上次改动的展示:design(chNNNN)/定稿路径 → 第NNNN章;从未提交 → 未提交。 */
function 改动章(history: Readonly<Record<string, LastCommitResult>>, relPath: string): string {
  const h = history[relPath]
  if (h === undefined || !h.ok) return '未提交'
  if (h.chapter !== null) return `第${String(h.chapter.章).padStart(4, '0')}章`
  return '未绑定章'
}

/**
 * 已确认但无内容的设计分部与世界书条目(`契约·题材与读者定位`、`世界书·人物档案/主角` 形)。
 * 不参与推导(标注即作者确认):状态面与进度卡据此提示补内容——起草拿不到只有标注的设计。
 */
export function listConfirmedEmpty(detail: DesignDetail): string[] {
  const out: string[] = []
  const doc = (label: string, parts: readonly DesignPartDetail[]) => {
    for (const p of parts) if (p.无内容 === true) out.push(`${label}·${p.名称}`)
  }
  doc('契约', detail.契约.分部)
  doc('故事骨架', detail.骨架.分部)
  doc('分卷布局', detail.分卷.分部)
  for (const vp of detail.卷规划) doc(`卷${pad(vp.卷号)}卷纲`, vp.卷纲)
  for (const m of detail.世界书.各模块) for (const n of m.无正文 ?? []) out.push(`世界书·${m.名称}/${n}`)
  return out
}

/** 书级进度卡渲染(纯函数:固定输入固定输出,不含时间戳)。 */
export function renderBookProgress(
  detail: DesignDetail,
  history: Readonly<Record<string, LastCommitResult>>,
  未决偏离: readonly string[],
  章级待核对数 = 0,
): string {
  const lines: string[] = ['【书级进度卡】', '']
  const 无内容数 = listConfirmedEmpty(detail).length
  if (无内容数 > 0) {
    lines.push(`已确认但无内容：${无内容数} 处（下文标「无内容」；只有状态标注、没有正文，起草拿不到这部分设定。推导照常，建议补内容）`, '')
  }

  const part = (d: DesignDocDetail) => d.分部.map((p) => `- ${p.名称}〔${p.状态}〕${p.无内容 === true ? '（无内容）' : ''}${p.待补.length > 0 ? `（待补:${p.待补.join(';')}）` : ''}｜${改动章(history, d.路径)}`)

  lines.push(`契约（${detail.契约.路径}）`, ...part(detail.契约), '')
  lines.push(`故事骨架（${detail.骨架.路径}）`, ...part(detail.骨架), '')
  lines.push(`分卷布局（${detail.分卷.路径}）`, ...part(detail.分卷))
  if (detail.分卷.各卷.length > 0) {
    lines.push(`各卷：${detail.分卷.各卷.map((v) => `卷${pad(v.卷号)}〔${v.状态}〕`).join('、')}`)
  }
  lines.push('')

  for (const vp of detail.卷规划) {
    lines.push(`卷${pad(vp.卷号)}：卷纲${vp.卷纲.length}节｜计划时间线${vp.计划时间线.条目数}条（覆盖至：${vp.计划时间线.覆盖至 ?? '空'}）｜近期窗口余量 ${vp.近期窗口.余量}${vp.近期窗口.余量 <= 2 ? '（见底，需滚动补充）' : ''}`)
    for (const p of vp.卷纲) {
      const notes = [...(p.无内容 === true ? ['无内容'] : []), ...(p.待补.length > 0 ? [`待补:${p.待补.join(';')}`] : [])]
      if (notes.length > 0) lines.push(`  - ${p.名称}（${notes.join('；')}）`)
    }
  }
  lines.push('')

  lines.push('世界书：')
  for (const m of detail.世界书.各模块) {
    lines.push(`  - ${m.名称}：${m.条目数}条（已确认 ${m.已确认数}${m.无正文 === undefined ? '' : `；无正文：${m.无正文.join('、')}`}）`)
  }
  if (detail.世界书.未声明模块.length > 0) {
    lines.push(`  - 未声明模块：${detail.世界书.未声明模块.join('、')}（补进 世界书/模块声明.md）`)
  }
  lines.push('')

  lines.push(`章进度：已定稿 ${detail.章进度.已定稿.length} 章（${detail.章进度.已定稿.map((c) => `卷${pad(c.卷)}第${String(c.章).padStart(4, '0')}章`).join('、') || '无'}）`)
  if (detail.章进度.活跃章 !== null) {
    const k = detail.章进度.活跃章
    lines.push(`活跃章：卷${pad(k.卷)} 第${String(k.章).padStart(4, '0')}章 ${k.章名}`)
  }
  lines.push('')

  lines.push(`本卷未决偏离：${未决偏离.length} 条${未决偏离.length > 0 ? `（${未决偏离.join('；')}）` : ''}`)
  // 章级待核对单独计数呈报(任务21, B1):不计入偏离数;非空时任何消费者不得呈报无偏离
  if (章级待核对数 > 0) lines.push(`本卷章级待核对：${章级待核对数} 条（按章号关联同章事实供核对，同章任一事件不等于内容兑现）`)
  return lines.join('\n')
}

/**
 * 卷纲标题/体量行明确声明的本卷计划章数(任务19, F-002):只读推导,不落盘。
 * 只取 `# 卷纲` 标题之后、第一个 `##` 小节之前的体量行区域;`第N章` 是章号引用
 * (章号全书连续),不是章数声明,不计入。缺失/不可解析/声明冲突均返回 null,
 * 由调用方如实报「完成情况未知」,不猜测完成。
 */
function declaredVolumeChapters(卷纲文: string): number | null {
  const lines = 卷纲文.split('\n')
  const block: string[] = []
  let seenTitle = false
  for (const line of lines) {
    if (/^\s*##\s/.test(line)) break
    if (/^\s*#\s/.test(line)) { seenTitle = true; continue }
    if (seenTitle && line.trim() !== '') block.push(line.trim())
  }
  const found = new Set<number>()
  for (const line of block) {
    const re = /(\d+)\s*章/g
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      if (/第\s*$/.test(line.slice(0, m.index))) continue
      const n = Number(m[1])
      if (n >= 1) found.add(n)
    }
  }
  return found.size === 1 ? [...found][0]! : null
}

function collectFinalized(bookRoot: string): { readonly 卷: number; readonly 章: number }[] {
  const 已定稿: { 卷: number; 章: number }[] = []
  const walk = (dir: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) walk(abs)
      else {
        const m = /定稿[\\/]卷(\d+)[\\/](\d+)-/.exec(abs)
        if (m) 已定稿.push({ 卷: Number(m[1]), 章: Number(m[2]) })
      }
    }
  }
  walk(path.join(bookRoot, '定稿'))
  已定稿.sort((a, b) => a.卷 - b.卷 || a.章 - b.章)
  return 已定稿
}

/**
 * 当前卷选择(任务21, B3):只读;完成事实与规划目标分字段,禁止同一卷号代两者。
 * activeChapterLine 与 bundle 侧 scanDesign/默认对账卷共用本选择器,按职责消费。
 */
export type CurrentVolumeSelection =
  | { readonly kind: 'active'; readonly 卷: number }
  | { readonly kind: 'planning'; readonly 已完成卷: number | null; readonly 规划卷: number }
  | { readonly kind: 'empty' }

export function selectCurrentVolume(bookRoot: string): CurrentVolumeSelection {
  const 定稿卷 = new Map<number, Set<number>>()
  for (const c of collectFinalized(bookRoot)) {
    const set = 定稿卷.get(c.卷) ?? new Set<number>()
    set.add(c.章)
    定稿卷.set(c.卷, set)
  }
  // 准备卷:非空卷纲/计划时间线/窗口(任一条目)、确认细纲文件、可识别身份候选细纲;空目录不计。
  const 准备卷 = new Set<number>()
  let 卷目录: string[] = []
  try {
    卷目录 = fs.readdirSync(path.join(bookRoot, '大纲/卷规划')).filter((n) => /^卷\d+$/.test(n))
  } catch {
    卷目录 = []
  }
  for (const name of 卷目录) {
    const v = Number(name.replace(/^卷/, ''))
    const hasOutline = (readText(bookRoot, paths.卷纲(v)) ?? '').trim() !== ''
    const hasTimeline = (readText(bookRoot, paths.计划时间线(v)) ?? '').trim() !== ''
    const windowText = readText(bookRoot, paths.近期窗口(v))
    const hasWindow = windowText !== null && parseWindow(windowText).length > 0
    let hasOutlineFiles = false
    try {
      hasOutlineFiles = fs.readdirSync(path.join(bookRoot, `大纲/卷规划/${name}/章细纲`)).some((f) => f.endsWith('.md'))
    } catch { /* 无细纲目录 */ }
    if (hasOutline || hasTimeline || hasWindow || hasOutlineFiles) 准备卷.add(v)
  }
  try {
    for (const f of fs.readdirSync(path.join(bookRoot, '草稿区/章细纲'))) {
      const m = /^卷(\d+)-(.+)\.md$/.exec(f)
      if (m !== null) 准备卷.add(Number(m[1]))
    }
  } catch { /* 无候选目录 */ }
  const 窗口就绪 = (v: number): boolean => {
    const t = readText(bookRoot, paths.近期窗口(v))
    return t !== null && parseWindow(t).some((e) => isWindowEntryReady(e.state))
  }
  // 完成证明沿用任务19规则:卷纲明确章数可读且本卷去重定稿数达到;未知/冲突不算完成。
  const 证完成 = (v: number): boolean => {
    const 卷纲文 = readText(bookRoot, paths.卷纲(v))
    if (卷纲文 === null) return false
    const 计划章数 = declaredVolumeChapters(卷纲文)
    if (计划章数 === null) return false
    return (定稿卷.get(v)?.size ?? 0) >= 计划章数
  }
  if (定稿卷.size > 0) {
    const C = Math.max(...定稿卷.keys())
    if (!证完成(C)) return { kind: 'active', 卷: C }
    const N = C + 1
    if (窗口就绪(N)) return { kind: 'active', 卷: N }
    return { kind: 'planning', 已完成卷: C, 规划卷: N }
  }
  if (准备卷.size > 0) {
    const P = Math.min(...准备卷)
    if (窗口就绪(P)) return { kind: 'active', 卷: P }
    return { kind: 'planning', 已完成卷: null, 规划卷: P }
  }
  return { kind: 'empty' }
}

/**
 * 每轮 context 瘦身的轻量路径(阶段 5):只定位「当前卷」的活跃章,只对该章跑
 * scanChapter + deriveChapter;不读账本、不跑对账、不扫全书。
 * 「当前卷」由 selectCurrentVolume 给出(B3);卷内逻辑(含任务19见底三态)不变。
 */
export function activeChapterLine(bookRoot: string):
  | { readonly ok: true; readonly 卷: number; readonly 章: number; readonly 章名: string; readonly 位置: string; readonly 行: string }
  | { readonly ok: true; readonly 行: string; readonly 空: true }
  | { readonly ok: false; readonly reason: string } {
  const 已定稿 = collectFinalized(bookRoot)
  const selection = selectCurrentVolume(bookRoot)
  if (selection.kind === 'empty') return { ok: true, 行: '尚无已规划章节（从建立分卷大纲与近期窗口开始）。', 空: true }
  if (selection.kind === 'planning') {
    if (selection.已完成卷 !== null) {
      return { ok: true, 行: `卷${pad(selection.已完成卷)} 已全部完成；卷${pad(selection.规划卷)} 待规划（窗口未就绪或尚无材料）。`, 空: true }
    }
    return { ok: true, 行: `卷${pad(selection.规划卷)} 尚未开写，待完成规划并确认窗口。`, 空: true }
  }
  const 当前卷 = selection.卷

  // 只扫当前卷:窗口条目 + 章细纲 + 定稿。
  const keys: ChapterKey[] = []
  const 窗口文 = readText(bookRoot, paths.近期窗口(当前卷))
  if (窗口文 !== null) {
    for (const e of parseWindow(窗口文)) {
      if (e.state === '已消费' || e.state === '已失效') continue
      keys.push({ 卷: 当前卷, 章: 0, 章名: e.name })
    }
  }
  let 细纲: string[] = []
  try {
    细纲 = fs.readdirSync(path.join(bookRoot, `大纲/卷规划/卷${pad(当前卷)}/章细纲`))
  } catch {
    细纲 = []
  }
  for (const name of 细纲) {
    const m = /^(\d+)-(.+)\.md$/.exec(name)
    if (m) keys.push({ 卷: 当前卷, 章: Number(m[1]), 章名: m[2]! })
  }
  for (const c of 已定稿.filter((c) => c.卷 === 当前卷)) {
    keys.push({ 卷: 当前卷, 章: c.章, 章名: '' })
  }
  // 定稿键需要章名,从 canonical 集合里借:直接复用 listChapters 的当前卷键补充。
  for (const k of listChapters(bookRoot)) {
    if (k.卷 === 当前卷 && k.章 > 0) keys.push(k)
  }

  const 定稿集合 = new Set(已定稿.filter((c) => c.卷 === 当前卷).map((c) => `${c.章}`))
  const merged = canonicalizeChapterKeys(keys).filter((k) => !定稿集合.has(`${k.章}`))
  const active = merged.find((k) => k.章 > 0) ?? merged[0]
  if (active === undefined) {
    // 窗口见底(F-002,任务19):窗口条目全部已消费/已失效不等于本卷完成。
    // 只按卷纲体量行明确声明的本卷章数与本卷去重定稿章数比较;读不到/冲突如实报未知。
    const 卷纲文 = readText(bookRoot, paths.卷纲(当前卷))
    const 计划章数 = 卷纲文 === null ? null : declaredVolumeChapters(卷纲文)
    const 本卷定稿数 = new Set(已定稿.filter((c) => c.卷 === 当前卷).map((c) => c.章)).size
    if (计划章数 !== null && 本卷定稿数 >= 计划章数) {
      return { ok: true, 行: `卷${pad(当前卷)}章节已全部完成，可进入下一卷规划。`, 空: true }
    }
    if (计划章数 !== null) {
      return { ok: true, 行: `卷${pad(当前卷)} 已定稿 ${本卷定稿数} 章，近期窗口无可进入条目，先滚动补充（卷纲 ${计划章数} 章）`, 空: true }
    }
    return { ok: true, 行: `卷${pad(当前卷)} 近期窗口无可进入条目，本卷完成情况未知，请核对卷纲后滚动补充`, 空: true }
  }
  const facts = scanChapter(bookRoot, active)
  const 环节 = deriveChapterFacts(facts).建议.环节
  return {
    ok: true,
    卷: active.卷,
    章: active.章,
    章名: active.章名,
    位置: 环节,
    行: `卷${pad(active.卷)} 第${String(active.章).padStart(4, '0')}章 ${active.章名} · ${环节}`,
  }
}
