/**
 * 书仓扫描:从文件收集「章节事实」供状态推导(格式规格 §8 的输入面)。
 * 只读文件与状态标注——草稿区工件不作状态真源(D31/D48/D56)。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseDocument } from '../repo/frontmatter'
import { MACHINE_SCHEMA_VERSION, parseMachineJson } from '../repo/schema'
import { isWindowEntryReady } from './states'
import { draftHashOf, reviewInputFingerprintOf, reviewRecordHashOf } from '../evidence/record'
import { chapterNo } from '../repo/paths'
import { materialReviewIdentity } from '../assembly/read'
import { isDraftMarkdownFile } from '../repo/drafts'
import { chapterLengthIdentity, readChapterLength } from '../design/chapter-length'

export interface ChapterKey {
  readonly 卷: number
  readonly 章: number
  readonly 章名: string
}

export interface ChapterFacts {
  readonly key: ChapterKey
  /** 近期窗口有可进入细纲的条目(推导行 1)。 */
  readonly 窗口就绪: boolean
  /** 草稿区有候选细纲(行 2)。 */
  readonly 候选细纲: boolean
  /** 真源区有已确认细纲(行 3)。 */
  readonly 确认细纲: boolean
  /** 材料包状态(null=无包;行 3/4)。 */
  readonly 材料包状态: string | null
  /** 有草稿(行 5)。 */
  readonly 有草稿: boolean
  /** 唯一待审稿(行 6)。 */
  readonly 唯一待审稿: boolean
  /** 当前轮审核记录存在(行 7)。 */
  readonly 有审核记录: boolean
  /** Exact current record bytes; optional for old callers constructing facts. */
  readonly 审核记录哈希?: string
  /** 审核完成且每条问题有处置状态(行 8)。F5:还须证据哈希与当前稿匹配。 */
  readonly 审核完成: boolean
  /** F5:审核证据与当前待审稿哈希失配(或旧格式无哈希)=证据过期。 */
  readonly 审核证据过期: boolean
  /** 待定稿包完整(行 9)。 */
  readonly 待定稿包完整: boolean
  /** 裁决:已批准/已退回/null(行 9/10)。 */
  readonly 裁决: '已批准' | '已退回' | null
  /** 定稿章文件在(行 11)。 */
  readonly 已定稿: boolean
  /** 叠加标记:细纲/草稿需复核(格式规格 §8 叠加标记)。 */
  readonly 需复核标记: readonly string[]
}

function readText(root: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf-8')
  } catch {
    return null
  }
}

/** 近期窗口解析:`- <名称> 〔状态〕` 行式(作者可读且可解析)。 */
export function parseWindow(text: string): ReadonlyArray<{ name: string; state: string }> {
  const out: Array<{ name: string; state: string }> = []
  for (const line of text.split('\n')) {
    const m = /^\s*-\s+(.+?)\s*[〔(]\s*(.+?)\s*[〕)]\s*$/.exec(line)
    if (m) out.push({ name: m[1]!, state: m[2]! })
  }
  return out
}

/** 审核记录(草稿区/审核/*.json):完成态、问题处置与模块态。 */
interface ReviewRecord {
  readonly 完成?: boolean
  readonly 问题?: ReadonlyArray<{ 处置?: string; 处置状态?: string }>
  readonly 模块?: Readonly<Record<string, { readonly 完成?: boolean; readonly 待回写?: boolean }>>
  /** F5:被审待审稿正文哈希;缺省=旧格式记录(视为证据过期)。 */
  readonly 审稿哈希?: string
  readonly 审读指纹?: string
  readonly 方案?: unknown
}

function issueDisposition(p: { readonly 处置?: string; readonly 处置状态?: string }): string {
  if (typeof p.处置 === 'string' && p.处置 !== '') return p.处置
  if (typeof p.处置状态 === 'string') return p.处置状态
  return ''
}

function parseReview(text: string | null): ReviewRecord | null {
  if (text === null) return null
  const r = parseMachineJson(text, MACHINE_SCHEMA_VERSION)
  if (!r.ok) return {} // 存在但解析失败——视为「有记录、未完成」(B4:不当无)
  return r.data as ReviewRecord
}

const 待定稿包文件 = ['清单.json', '正文.md', '事实变更.md', '时间线变更.md', '账本变更.md', '章摘要.md', '卷对账.md', '本书层记忆候选.md'] as const

export function scanChapter(root: string, key: ChapterKey): ChapterFacts {
  const { 卷, 章, 章名 } = key
  const 卷NN = String(卷).padStart(2, '0')

  const 窗口文 = readText(root, `大纲/卷规划/卷${卷NN}/近期窗口.md`)
  const 窗口就绪 = 窗口文 !== null && parseWindow(窗口文).some((e) => isWindowEntryReady(e.state))

  const 候选文 = readText(root, `草稿区/章细纲/卷${卷NN}-${章名}.md`)
  const 候选细纲 = 候选文 !== null && stateOf(候选文) === '候选'

  const 确认文 = readText(root, `大纲/卷规划/卷${卷NN}/章细纲/${chapterNo(章)}-${章名}.md`)
  const 确认细纲 = 确认文 !== null && stateOf(确认文) === '已确认'

  const 材料清单 = readText(root, `草稿区/材料包/卷${卷NN}-${章名}/材料清单.json`)
  let 材料包状态: string | null = null
  if (材料清单 !== null) {
    const r = parseMachineJson(材料清单, MACHINE_SCHEMA_VERSION)
    材料包状态 = r.ok && typeof r.data['状态'] === 'string' ? r.data['状态'] : '组装中'
  }

  const 草稿目录 = path.join(root, `草稿区/草稿/卷${卷NN}-${章名}`)
  let 有草稿 = false
  let 唯一待审稿 = false
  let 唯一待审稿正文: string | null = null
  if (fs.existsSync(草稿目录) && fs.statSync(草稿目录).isDirectory()) {
    const drafts = fs.readdirSync(草稿目录).filter(isDraftMarkdownFile)
    有草稿 = drafts.length > 0
    const 待审 = drafts.filter((f) => {
      const doc = parseDocument(fs.readFileSync(path.join(草稿目录, f), 'utf-8'))
      return doc.ok && doc.data.fields['角色'] === '待审稿'
    })
    唯一待审稿 = 待审.length === 1
    if (唯一待审稿) {
      const doc = parseDocument(fs.readFileSync(path.join(草稿目录, 待审[0]!), 'utf-8'))
      唯一待审稿正文 = doc.ok ? doc.data.body : null
    }
  }

  const 审核文 = readText(root, `草稿区/审核/卷${卷NN}-${章名}.json`)
  const 审核 = parseReview(审核文)
  const 有审核记录 = 审核 !== null
  // F5(2026-09-05):审核证据绑定被审正文哈希——记录哈希与当前唯一待审稿哈希失配(或
  // 记录无哈希的旧格式)时,审核完成事实视为不成立,叠加「证据过期」标记。作者仍可推进
  // (播报不拒绝),但恢复视图不再冒充当前稿已审。
  const materials = materialReviewIdentity(root, key, 材料清单)
  if (materials.问题.length > 0) 材料包状态 = '已过期'
  const 当前审读指纹 = 唯一待审稿 && 唯一待审稿正文 !== null
    ? reviewInputFingerprintOf({ 正文: 唯一待审稿正文, 细纲: 确认文 ?? '', 材料清单: materials.标识, 方案: 审核?.方案, 章节篇幅: chapterLengthIdentity(readChapterLength(root)) })
    : null
  const 审核证据过期 = 审核 !== null && 唯一待审稿
    ? (() => {
      if (审核.审稿哈希 === undefined) return true
      if (唯一待审稿正文 === null) return true
      if (draftHashOf(唯一待审稿正文) !== 审核.审稿哈希) return true
      if (审核.审读指纹 === undefined || 当前审读指纹 === null) return true
      return 当前审读指纹 !== 审核.审读指纹
    })()
    : false
  // fail-closed(拍板:空审不通过):完成为真还必须——记录带模块态(手写假记录没有)、
  // 无隔离子 Agent 待回写模块、每条问题处置非空非「待处理」、证据未过期(F5)。
  const 审核完成 = 审核?.完成 === true
    && !审核证据过期
    && 审核.模块 !== undefined
    && Object.keys(审核.模块).length > 0
    && Object.values(审核.模块).every((m) => m.待回写 !== true)
    && (审核.问题 ?? []).every((p) => {
      const d = issueDisposition(p)
      return d !== '' && d !== '待处理'
    })

  const 包目录 = `草稿区/定稿准备/卷${卷NN}-${章名}`
  const 待定稿包完整 = 待定稿包文件.every((f) => readText(root, `${包目录}/${f}`) !== null)
  let 裁决: ChapterFacts['裁决'] = null
  const 裁决文 = readText(root, `${包目录}/清单.json`)
  if (裁决文 !== null) {
    const r = parseMachineJson(裁决文, MACHINE_SCHEMA_VERSION)
    if (r.ok) {
      const v = r.data['裁决']
      if (v === '已批准' || v === '已退回') 裁决 = v
    }
  }

  const 已定稿 = readText(root, `定稿/卷${卷NN}/${chapterNo(章)}-${章名}.md`) !== null

  const 需复核标记: string[] = []
  for (const [label, text] of [['细纲', 确认文 ?? 候选文], ['草稿', null as string | null]] as const) {
    if (text !== null && stateOf(text) === '需复核') 需复核标记.push(label)
  }
  if (审核证据过期) 需复核标记.push('审核证据对当前稿过期→须重审')

  return { key, 窗口就绪, 候选细纲, 确认细纲, 材料包状态, 有草稿, 唯一待审稿, 有审核记录, 审核完成, 待定稿包完整, 裁决, 已定稿, 需复核标记, 审核证据过期,
    ...(审核文 === null ? {} : { 审核记录哈希: reviewRecordHashOf(审核文) }),
  }
}

function stateOf(text: string): string | null {
  const r = parseDocument(text)
  if (!r.ok) return null
  const v = r.data.fields['状态']
  return typeof v === 'string' ? v : null
}

/** 枚举书中全部章键(从窗口、细纲、草稿区、定稿各处收集;已失效/已消费窗口条目不产生键)。 */
export function listChapters(root: string): ReadonlyArray<ChapterKey> {
  const seen = new Map<string, ChapterKey>()
  const add = (k: ChapterKey) => seen.set(`${k.卷}/${k.章}/${k.章名}`, k)

  // 卷规划近期窗口(近期窗口条目);已消费/已失效条目是历史记录,不再是可进入的章(拍板:窗口失效过滤)
  walk(path.join(root, '大纲/卷规划'), (p) => {
    const m = /卷规划[\\/]卷(\d+)[\\/]近期窗口\.md$/.exec(p)
    if (m) {
      const 卷 = Number(m[1])
      try {
        const text = fs.readFileSync(p, 'utf-8')
        for (const item of parseWindow(text)) {
          if (item.state === '已消费' || item.state === '已失效') continue
          add({ 卷, 章: 0, 章名: item.name })
        }
      } catch { /* 忽略读取错误 */ }
    }
  })

  // 真源区:确认细纲与定稿章(文件名即编号;[\\/] 兼容两种分隔符)
  walk(path.join(root, '大纲/卷规划'), (p) => {
    const m = /卷规划[\\/]卷(\d+)[\\/]章细纲[\\/](\d+)-(.+)\.md$/.exec(p)
    if (m) add({ 卷: Number(m[1]), 章: Number(m[2]), 章名: m[3]! })
  })
  walk(path.join(root, '定稿'), (p) => {
    const m = /定稿[\\/]卷(\d+)[\\/](\d+)-(.+)\.md$/.exec(p)
    if (m) add({ 卷: Number(m[1]), 章: Number(m[2]), 章名: m[3]! })
  })

  // 草稿区:目录名/文件名形如 卷NN-章名(章号未知,以 0 占位);机器态 JSON（审核记录等）不是章键
  for (const dir of DRAFT_SCAN_DIRS) {
    const abs = path.join(root, '草稿区', dir)
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(abs, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.name.endsWith('.md')) continue
      const m = /^卷(\d+)-(.+?)(?:\.md)?$/.exec(entry.name)
      if (m) add({ 卷: Number(m[1]), 章: 0, 章名: m[2]! })
    }
  }
  return canonicalizeChapterKeys([...seen.values()].filter((k) => k.章名 !== ''))
}

/**
 * 章名归一(仅用于分组,不改变原章名):全角括号折算半角、去空白。
 * 归一后仍不同的章名是两章,绝不静默合并。
 */
export function normalizeChapterName(章名: string): string {
  return 章名
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+/g, '')
}

/**
 * 幻影章键归并:按 (卷, 归一章名) 分组,组内存在 章号>0 的键(真源侧权威)即丢弃该组全部 章:0 键;
 * 整组都无章号时保留 章:0(该章确实尚未定位)。同一键去重,带号键按 (章号) 排序输出。
 */
export function canonicalizeChapterKeys(keys: readonly ChapterKey[]): ChapterKey[] {
  const exact = new Map<string, ChapterKey>()
  for (const k of keys) exact.set(`${k.卷}/${k.章}/${k.章名}`, k)
  const groups = new Map<string, ChapterKey[]>()
  for (const k of exact.values()) {
    const gk = `${k.卷}/${normalizeChapterName(k.章名)}`
    const list = groups.get(gk) ?? []
    list.push(k)
    groups.set(gk, list)
  }
  const out: ChapterKey[] = []
  for (const list of groups.values()) {
    const numbered = list.filter((k) => k.章 > 0).sort((a, b) => a.章 - b.章)
    out.push(...(numbered.length > 0 ? numbered : list))
  }
  return out.sort((a, b) => a.卷 - b.卷 || a.章 - b.章)
}

const DRAFT_SCAN_DIRS = ['章细纲', '草稿', '材料包', '审核', '定稿准备'] as const

function walk(dir: string, fn: (rel: string) => void): void {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, fn)
    else fn(p)
  }
}
