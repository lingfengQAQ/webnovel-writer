/**
 * 章细纲写入与确认(格式规格 §3.3 / 插件规格 §5):
 * 候选住草稿区;确认门槛过关后移入真源区。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseWindow, type ChapterKey } from '../derive/scan'
import { isWindowEntryReady } from '../derive/states'
import { applyVersionFields, bumpVersion, initialVersion } from '../provenance'
import { writeBatchAtomic, writeFileAtomic } from '../repo/atomic'
import { removeSync } from '../repo/remove'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { assertSegment, paths } from '../repo/paths'
import { parseSourceRef, type SourceRef } from '../repo/sourceRef'
import { parseOutline } from './parse'
import { 定位段小节, 单元字段 } from './template'
import { emptyCandidateBody } from './template'
import { bookWriter } from '../repo/atomic'

export interface WriteCandidateInput {
  readonly 卷: number
  readonly 章?: number
  readonly 章名: string
  readonly body?: string
  readonly 来源引用?: readonly string[]
}

export type Confirmable =
  | { readonly ok: true; readonly 播报?: readonly string[] }
  | { readonly ok: false; readonly gaps: readonly string[]; readonly 播报?: readonly string[] }

export interface ConfirmOutlineInput {
  readonly 卷: number
  readonly 章: number
  readonly 章名: string
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

function normalizeRefs(raw: readonly string[] | undefined): string[] {
  if (raw === undefined) return []
  return raw.map(asRefLine).filter((s) => s !== '来源:')
}

function labeledStateOf(text: string): string | null {
  const r = parseDocument(text)
  if (!r.ok) return null
  const v = r.data.fields['状态']
  return typeof v === 'string' ? v : null
}

function readyWindowNames(bookRoot: string, 卷: number): string[] {
  const 窗口文 = readText(bookRoot, paths.近期窗口(卷))
  if (窗口文 === null) return []
  return parseWindow(窗口文).filter((e) => isWindowEntryReady(e.state)).map((e) => e.name)
}

function windowHasChapter(bookRoot: string, 卷: number, 章名: string): boolean {
  return readyWindowNames(bookRoot, 卷).includes(章名)
}

/**
 * 再确认判定(F-001,任务19):真源已有状态「已确认」的同名确认细纲时,
 * 候选→确认是改细纲重入(版本+1),不再要求窗口存在「已确认」条目。
 * 首次确认(真源无确认细纲)不受影响,窗口门槛照旧。
 */
function hasConfirmedOutline(bookRoot: string, key: Pick<ChapterKey, '卷' | '章名'> & { readonly 章?: number }): boolean {
  if (key.章 === undefined || !Number.isInteger(key.章) || key.章 < 1) return false
  const text = readText(bookRoot, paths.确认细纲(key.卷, key.章, key.章名))
  return text !== null && labeledStateOf(text) === '已确认'
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

function targetIsBlankSetting(bookRoot: string, rel: string): boolean {
  const abs = resolveInsideBook(bookRoot, rel)
  if (abs === null) return false
  let text: string
  try {
    text = fs.readFileSync(abs, 'utf-8')
  } catch {
    return false
  }
  const r = parseDocument(text)
  if (!r.ok) return false
  return r.data.fields['状态'] === '留白'
}

/** 写入草稿区候选细纲(状态:候选)。 */
function writeCandidateLocked(bookRoot: string, input: WriteCandidateInput): string {
  assertSegment(input.章名, '章名')
  const body = input.body ?? emptyCandidateBody()
  const refs = normalizeRefs(input.来源引用)
  const fields: Record<string, unknown> = applyVersionFields(
    {
      状态: '候选',
      身份: { 卷: input.卷, 章: input.章 ?? 0, 章名: input.章名 },
      ...(refs.length > 0 ? { 来源引用: refs } : {}),
    },
    initialVersion('章细纲'),
  )
  const rel = paths.候选细纲(input.卷, input.章名)
  writeFileAtomic(bookRoot, rel, serializeDocument(fields, body))
  return rel
}

export const writeCandidate = bookWriter(writeCandidateLocked)

export function checkConfirmable(bookRoot: string, key: Pick<ChapterKey, '卷' | '章名'> & { readonly 章?: number }): Confirmable {
  const gaps: string[] = []
  const 播报: string[] = []
  assertSegment(key.章名, '章名')

  const candidateRel = paths.候选细纲(key.卷, key.章名)
  const candidateText = readText(bookRoot, candidateRel)
  if (candidateText === null) gaps.push('候选细纲不存在')

  if (!windowHasChapter(bookRoot, key.卷, key.章名) && !hasConfirmedOutline(bookRoot, key)) {
    // 带上可进入条目名:章名须与其中一条同名,调用方一次就能对上,不必反复试窗口
    const ready = readyWindowNames(bookRoot, key.卷)
    gaps.push(`窗口未就绪或无匹配已确认窗口项（章名须与近期窗口中一条可进入条目同名；${ready.length === 0 ? '当前窗口无可进入条目' : `当前可进入：${ready.join('、')}`}）`)
  }

  const refLines = candidateText === null ? [] : parseOutline(candidateText).来源引用
  if (refLines.length === 0) gaps.push('来源引用缺失或无效')

  if (candidateText !== null) {
    const parsed = parseOutline(candidateText)
    const missing定位 = 定位段小节.filter((name) => {
      const value = parsed.定位[name]
      return value === undefined || value.trim() === ''
    })
    if (missing定位.length > 0) gaps.push(`定位段不完整:${missing定位.join('、')}`)

    if (parsed.units.length === 0) {
      gaps.push('细纲段缺少叙事单元')
    } else {
      parsed.units.forEach((unit, index) => {
        const missingFields = 单元字段.filter((field) => {
          const value = unit.fields[field]
          return value === undefined || value.trim() === ''
        })
        if (missingFields.length > 0) gaps.push(`叙事单元${index + 1}字段不完整:${missingFields.join('、')}`)
      })
    }

    if (parsed.constraints.length === 0) gaps.push('约束分级缺失:正文至少一行带行内标记〔硬〕/〔软〕/〔自由〕（章节功能或单元行，不是独立小节）')
    const precondition = parsed.定位['前置条件核对结果']
    if (precondition === undefined || precondition.trim() === '') gaps.push('前置条件核对结果缺失')
  }

  for (const line of refLines) {
    const ref = parseSourceRef(asRefLine(line))
    if (ref === null) {
      gaps.push(`来源引用无效:${line}（合法形态：来源:<仓内相对路径>@<版本>，如 大纲/卷规划/卷01/卷纲.md@1；或 来源:作者自定义 / 来源:对谈共创；锚点、行号、绝对路径均非法）`)
      continue
    }
    const result = checkRef(bookRoot, ref, line)
    if (result.gap !== undefined) gaps.push(result.gap)
    if (result.播报 !== undefined) 播报.push(result.播报)
  }

  if (gaps.length > 0) return 播报.length > 0 ? { ok: false, gaps, 播报 } : { ok: false, gaps }
  return 播报.length > 0 ? { ok: true, 播报 } : { ok: true }
}

function checkRef(bookRoot: string, ref: SourceRef, line: string): { readonly gap?: string; readonly 播报?: string } {
  if (ref.kind === '作者自定义' || ref.kind === '对谈共创' || ref.kind === '知识库') return {}
  const abs = resolveInsideBook(bookRoot, ref.path)
  if (abs === null) return { gap: `来源路径逃逸:${line}` }
  if (!fs.existsSync(abs)) return { gap: `仓内引用目标不存在:${ref.path}` }
  if (targetIsBlankSetting(bookRoot, ref.path)) return { 播报: `引用留白设定:${ref.path}` }
  return {}
}

/** 确认门槛过关后写入真源区并删除候选。章号必须 ≥ 1。 */
function confirmOutlineLocked(bookRoot: string, key: ConfirmOutlineInput): Confirmable & { readonly replayed?: boolean } {
  assertSegment(key.章名, '章名')
  if (!Number.isInteger(key.章) || key.章 < 1) {
    return { ok: false, gaps: ['确认细纲要求章号 ≥ 1'] }
  }
  const confirmedRel = paths.确认细纲(key.卷, key.章, key.章名)
  const candidateRel = paths.候选细纲(key.卷, key.章名)
  const candidateText = readText(bookRoot, candidateRel)

  // 幂等可重放(拍板 2):真源已落位、候选已删——重跑确认＝放行,由工具层补 design: 提交,不重写文件
  if (candidateText === null) {
    const confirmedText = readText(bookRoot, confirmedRel)
    if (confirmedText !== null && labeledStateOf(confirmedText) === '已确认') {
      return { ok: true, replayed: true }
    }
    return { ok: false, gaps: ['候选细纲不存在'] }
  }

  const gate = checkConfirmable(bookRoot, key)
  if (!gate.ok) return gate

  const doc = parseDocument(candidateText)
  if (!doc.ok) return { ok: false, gaps: [`候选细纲解析失败:${doc.detail}`] }

  const fields: Record<string, unknown> = {
    ...doc.data.fields,
    状态: '已确认',
    身份: { 卷: key.卷, 章: key.章, 章名: key.章名 },
  }
  // 已有确认细纲再确认(改细纲重入):版本 +1,沿用 provenance 版本协议(拍板默认)
  const existingText = readText(bookRoot, confirmedRel)
  if (existingText === null) {
    Object.assign(fields, applyVersionFields(fields, initialVersion('细纲确认', null)))
  } else {
    const prev = parseDocument(existingText)
    const prevVersion = prev.ok && typeof prev.data.fields['版本'] === 'number' ? prev.data.fields['版本'] : 1
    Object.assign(fields, applyVersionFields(fields, bumpVersion(prevVersion, '细纲确认', null)))
  }
  writeBatchAtomic(bookRoot, [{ relPath: confirmedRel, content: serializeDocument(fields, doc.data.body) }])

  const candidateAbs = path.join(bookRoot, candidateRel)
  try { removeSync(candidateAbs) } catch { /* 确认文件已落位即可 */ }

  return { ok: true }
}

export const confirmOutline = bookWriter(confirmOutlineLocked)

export function isOutlineConfirmed(bookRoot: string, key: ConfirmOutlineInput): boolean {
  const text = readText(bookRoot, paths.确认细纲(key.卷, key.章, key.章名))
  return text !== null && labeledStateOf(text) === '已确认'
}
