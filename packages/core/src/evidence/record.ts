/**
 * 证据与审核记录(插件规格 §9 / 不变量 7):草稿区/审核/卷NN-章名.json。
 */

import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ChapterKey } from '../derive/scan'
import { writeFileAtomic } from '../repo/atomic'
import { paths } from '../repo/paths'
import { MACHINE_SCHEMA_VERSION, parseMachineJson, serializeMachineJson } from '../repo/schema'
import { bookWriter } from '../repo/atomic'

export const 处置状态列表 = ['待处理', '已接受修改', '已解决', '作者保留', '已驳回', '无法判断'] as const
export type 处置状态 = (typeof 处置状态列表)[number]

export interface Finding {
  readonly 审核编号: string
  readonly 模块名: string
  readonly 发现项编号: string
  readonly 严重程度: string
  readonly 是否建议阻断: boolean
  readonly 证据位置: string
  readonly 所依据材料及版本: string
  readonly 问题说明: string
  readonly 影响范围: string
  readonly 不确定性说明: string
  readonly 修改建议: string
  readonly 建议返回节点: string
  readonly 建议复审模块: string
  readonly 材料完整性: string
  readonly 处置状态: 处置状态
  /** scan 兼容字段,与 处置状态 同步。 */
  readonly 处置: 处置状态
  /** 改稿批回填:子代理映射清单或作者口述的那一行改动说明。 */
  readonly 处置说明?: string
}

export interface ModuleRunState {
  readonly 完成: boolean
  readonly 失败: boolean
  readonly 跳过?: boolean
  /** 隔离子 Agent 形态:发现项尚未经 ingestFindings 回写,不得判审核完成。 */
  readonly 待回写?: boolean
  readonly 理由?: string
}

export interface ReviewPlan {
  readonly 动作: string
  readonly 理由: string
  readonly 跳过?: ReadonlyArray<{ readonly 模块: string; readonly 理由: string }>
}

export interface ReviewRecord {
  readonly schemaVersion: number
  readonly 完成: boolean
  readonly 问题: readonly Finding[]
  readonly 模块: Readonly<Record<string, ModuleRunState>>
  readonly 方案?: ReviewPlan
  /** F5(2026-09-05):被审待审稿正文的 sha256——审核证据与稿件版本绑定;缺省=旧记录(视为过期)。 */
  readonly 审稿哈希?: string
  /** F5/R7:正文之外的审核输入指纹（细纲、材料清单、方案与审核版本）。 */
  readonly 审读指纹?: string
  /** 上轮已裁决的身份三元组；仅供尚未回写的模块认亲，不是当前稿发现项。 */
  readonly 待继承处置?: readonly ReviewDisposition[]
}

export type ReviewDisposition = Pick<Finding, '模块名' | '证据位置' | '问题说明' | '处置状态' | '处置说明'>

export function emptyReviewRecord(): ReviewRecord {
  return { schemaVersion: MACHINE_SCHEMA_VERSION, 完成: false, 问题: [], 模块: {} }
}

/** 被审正文内容哈希(F5):审核证据与稿件版本的绑定键。 */
export function draftHashOf(body: string): string {
  return createHash('sha256').update(body, 'utf-8').digest('hex')
}

/** Stable object serialization for the review applicability fingerprint. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * Fingerprint all deterministic inputs which make one review result
 * applicable. Keep this helper in core so recovery does not import the review
 * registry and a late module write can compare the same identity as a fresh
 * scan.
 */
export function reviewInputFingerprintOf(input: {
  readonly 正文: string
  readonly 细纲: string
  readonly 材料清单?: string | null
  readonly 方案?: unknown
  readonly 章节篇幅?: string
}): string {
  const payload = {
    version: 'review-input-v1',
    正文: input.正文,
    细纲: input.细纲,
    材料清单: input.材料清单 ?? null,
    方案: input.方案 ?? null,
    ...(input.章节篇幅 === undefined ? {} : { 章节篇幅: input.章节篇幅 }),
  }
  return createHash('sha256').update(stableJson(payload), 'utf-8').digest('hex')
}

export function isNoFindingReview(record: ReviewRecord): boolean {
  return record.完成 === true && record.问题.length === 0
}

export function isReviewIncomplete(record: ReviewRecord): boolean {
  return record.完成 !== true
}

function readText(root: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf-8')
  } catch {
    return null
  }
}

function asDisposition(v: unknown): 处置状态 {
  if (typeof v === 'string' && (处置状态列表 as readonly string[]).includes(v)) return v as 处置状态
  return '待处理'
}

function asFinding(raw: unknown): Finding | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  // 单一解析:两个字段同义,处置状态为准、处置兜底,避免两字段各自解析后分叉
  const 处置 = asDisposition(o['处置状态'] ?? o['处置'])
  return {
    审核编号: typeof o['审核编号'] === 'string' ? o['审核编号'] : '',
    模块名: typeof o['模块名'] === 'string' ? o['模块名'] : '',
    发现项编号: typeof o['发现项编号'] === 'string' ? o['发现项编号'] : '',
    严重程度: typeof o['严重程度'] === 'string' ? o['严重程度'] : '',
    是否建议阻断: o['是否建议阻断'] === true,
    证据位置: typeof o['证据位置'] === 'string' ? o['证据位置'] : '',
    所依据材料及版本: typeof o['所依据材料及版本'] === 'string' ? o['所依据材料及版本'] : '',
    问题说明: typeof o['问题说明'] === 'string' ? o['问题说明'] : '',
    影响范围: typeof o['影响范围'] === 'string' ? o['影响范围'] : '',
    不确定性说明: typeof o['不确定性说明'] === 'string' ? o['不确定性说明'] : '',
    修改建议: typeof o['修改建议'] === 'string' ? o['修改建议'] : '',
    建议返回节点: typeof o['建议返回节点'] === 'string' ? o['建议返回节点'] : '',
    建议复审模块: typeof o['建议复审模块'] === 'string' ? o['建议复审模块'] : '',
    材料完整性: typeof o['材料完整性'] === 'string' ? o['材料完整性'] : '',
    处置状态: 处置,
    处置,
    ...(typeof o['处置说明'] === 'string' ? { 处置说明: o['处置说明'] } : {}),
  }
}

/** 子 Agent 产出的发现项规范化(发现项回写通道入口;解析失败的条目返回 null)。 */
export function normalizeFinding(raw: unknown): Finding | null {
  return asFinding(raw)
}

export function loadReviewRecord(bookRoot: string, key: Pick<ChapterKey, '卷' | '章名'>): ReviewRecord | null {
  const text = readText(bookRoot, paths.审核记录(key.卷, key.章名))
  if (text === null) return null
  return parseReviewRecord(text)
}

function parseReviewRecord(text: string): ReviewRecord {
  const r = parseMachineJson(text, MACHINE_SCHEMA_VERSION)
  if (!r.ok) return { ...emptyReviewRecord(), 完成: false }
  const 问题 = Array.isArray(r.data['问题']) ? r.data['问题'].map(asFinding).filter((x): x is Finding => x !== null) : []
  const 待继承处置: ReviewDisposition[] = Array.isArray(r.data['待继承处置'])
    ? r.data['待继承处置'].flatMap((raw) => {
      const finding = asFinding(raw)
      if (finding === null || !finding.模块名 || finding.处置状态 === '待处理') return []
      const { 模块名, 证据位置, 问题说明, 处置状态, 处置说明 } = finding
      return [{ 模块名, 证据位置, 问题说明, 处置状态, ...(处置说明 === undefined ? {} : { 处置说明 }) }]
    }) : []
  const 模块Raw = r.data['模块']
  const 模块: Record<string, ModuleRunState> = {}
  if (模块Raw !== null && typeof 模块Raw === 'object' && !Array.isArray(模块Raw)) {
    for (const [name, st] of Object.entries(模块Raw as Record<string, unknown>)) {
      if (st === null || typeof st !== 'object' || Array.isArray(st)) continue
      const s = st as Record<string, unknown>
      模块[name] = {
        完成: s['完成'] === true,
        失败: s['失败'] === true,
        ...(s['跳过'] === true ? { 跳过: true } : {}),
        ...(s['待回写'] === true ? { 待回写: true } : {}),
        ...(typeof s['理由'] === 'string' ? { 理由: s['理由'] } : {}),
      }
    }
  }
  let 方案: ReviewPlan | undefined
  const planRaw = r.data['方案']
  if (planRaw !== null && typeof planRaw === 'object' && !Array.isArray(planRaw)) {
    const p = planRaw as Record<string, unknown>
    const 跳过Raw = p['跳过']
    方案 = {
      动作: typeof p['动作'] === 'string' ? p['动作'] : '',
      理由: typeof p['理由'] === 'string' ? p['理由'] : '',
      跳过: Array.isArray(跳过Raw)
        ? 跳过Raw.flatMap((item) => {
          if (item === null || typeof item !== 'object' || Array.isArray(item)) return []
          const o = item as Record<string, unknown>
          if (typeof o['模块'] !== 'string') return []
          return [{ 模块: o['模块'], 理由: typeof o['理由'] === 'string' ? o['理由'] : '' }]
        })
        : undefined,
    }
  }
  return {
    schemaVersion: MACHINE_SCHEMA_VERSION,
    完成: r.data['完成'] === true,
    问题,
    模块,
    方案,
    ...(typeof r.data['审稿哈希'] === 'string' ? { 审稿哈希: r.data['审稿哈希'] } : {}),
    ...(typeof r.data['审读指纹'] === 'string' ? { 审读指纹: r.data['审读指纹'] } : {}),
    ...(待继承处置.length === 0 ? {} : { 待继承处置 }),
  }
}

/** Single serialization contract for standalone writes and multi-file revision transactions. */
export function serializeReviewRecord(record: ReviewRecord): string {
  const payload: Record<string, unknown> = {
    ...record,
    完成: record.完成,
    问题: record.问题.map((f) => ({ ...f, 处置: f.处置, 处置状态: f.处置状态 })),
    模块: record.模块,
    ...(record.审稿哈希 === undefined ? {} : { 审稿哈希: record.审稿哈希 }),
    ...(record.审读指纹 === undefined ? {} : { 审读指纹: record.审读指纹 }),
    ...(record.方案 === undefined ? {} : { 方案: record.方案 }),
  }
  return serializeMachineJson(payload, MACHINE_SCHEMA_VERSION)
}

export function reviewRecordHashOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Read once: the compare token and editable record must describe the same bytes. */
export function readReviewRecordForUpdate(bookRoot: string, key: Pick<ChapterKey, '卷' | '章名'>):
  | { readonly ok: true; readonly record: ReviewRecord; readonly hash: string }
  | { readonly ok: false; readonly reason: string } {
  let text: string
  try { text = fs.readFileSync(path.join(bookRoot, paths.审核记录(key.卷, key.章名)), 'utf8') }
  catch (error) {
    return { ok: false, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? '无审核记录' : '审核记录读取失败' }
  }
  const parsed = parseMachineJson(text, MACHINE_SCHEMA_VERSION)
  if (!parsed.ok || !Array.isArray(parsed.data['问题']) || typeof parsed.data['完成'] !== 'boolean'
    || parsed.data['模块'] === null || typeof parsed.data['模块'] !== 'object' || Array.isArray(parsed.data['模块'])) {
    return { ok: false, reason: '审核记录格式无效，请重新读取并核对原记录' }
  }
  const record = parseReviewRecord(text)
  const rawFindings = parsed.data['问题']
  if (record.问题.length !== rawFindings.length) return { ok: false, reason: '审核记录含无效发现项' }
  // Preserve extension fields as well as the declared evidence fields during a targeted update.
  const rawModules = parsed.data['模块'] as Record<string, unknown>
  if (Object.keys(record.模块).length !== Object.keys(rawModules).length) return { ok: false, reason: '审核记录含无效模块状态' }
  const 问题 = record.问题.map((finding, i) => ({ ...rawFindings[i], ...finding }))
  const 模块 = Object.fromEntries(Object.entries(record.模块).map(([name, state]) => [name, {
    ...(rawModules[name] as object), ...state,
  }]))
  return { ok: true, hash: reviewRecordHashOf(text), record: {
    ...parsed.data, ...record, 问题, 模块,
    ...(record.方案 === undefined ? {} : { 方案: { ...(parsed.data['方案'] as object), ...record.方案 } }),
  } }
}

function writeReviewRecordLocked(bookRoot: string, key: Pick<ChapterKey, '卷' | '章名'>, record: ReviewRecord): string {
  const rel = paths.审核记录(key.卷, key.章名)
  writeFileAtomic(bookRoot, rel, serializeReviewRecord(record))
  return rel
}

export const writeReviewRecord = bookWriter(writeReviewRecordLocked)

function planReviewRecordLocked(bookRoot: string, key: Pick<ChapterKey, '卷' | '章名'>, plan: ReviewPlan): ReviewRecord {
  const existing = loadReviewRecord(bookRoot, key) ?? emptyReviewRecord()
  const next: ReviewRecord = { ...existing, 方案: plan }
  writeReviewRecord(bookRoot, key, next)
  return next
}

export const planReviewRecord = bookWriter(planReviewRecordLocked)
