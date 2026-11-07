/**
 * 文件工具路径门禁(插件规格 §14 / 格式规格 §11 不变量 4/5)。
 * 草稿区可写;定稿/构想只读;其余真源仅书仓写入器可写。
 */

import * as path from 'node:path'
import { canonicalizePath } from './canonical'
import type { FileAccessDecision } from './types'

export function toPosixRel(rel: string): string {
  return rel.split(/[\\/]/).join('/')
}

/** 解析目标路径相对书仓根;逃逸或越界一律拒绝。
 *  dsh 运行时对齐批(2026-09-06):双方先 canonical 化——junction/symlink 别名、
 *  盘符大小写变体、`\\?\` 形态不再误判逃逸。 */
export function resolveInsideBook(bookRoot: string, target: string):
  | { readonly ok: true; readonly relPath: string }
  | { readonly ok: false; readonly reason: string } {
  const root = canonicalizePath(bookRoot)
  const abs = canonicalizePath(path.isAbsolute(target) ? target : path.resolve(bookRoot, target))
  const rel = path.relative(root, abs)
  if (rel === '') return { ok: false, reason: '禁止改写书仓根本身' }
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, reason: '路径逃逸书仓根，拒绝写入' }
  }
  return { ok: true, relPath: toPosixRel(rel) }
}

export function classifyRelPath(relPath: string): '草稿区' | '定稿' | '构想' | '真源' {
  const p = toPosixRel(relPath)
  if (p === '草稿区' || p.startsWith('草稿区/')) return '草稿区'
  if (p === '定稿' || p.startsWith('定稿/')) return '定稿'
  if (p === '构想' || p.startsWith('构想/')) return '构想'
  return '真源'
}

/** 给定书仓根与目标路径,判定文件工具可否写入。 */
export function gateFileAccess(bookRoot: string, target: string): FileAccessDecision {
  const resolved = resolveInsideBook(bookRoot, target)
  if (!resolved.ok) return { allow: false, reason: resolved.reason, zone: '逃逸' }
  const zone = classifyRelPath(resolved.relPath)
  // Missing paths have no realpath yet. Windows still treats case and trailing
  // dots/spaces as aliases, including when an internal directory is first made.
  const protectedPath = process.platform === 'win32'
    ? resolved.relPath.split('/').map(part => part.replace(/[. ]+$/, '').toLowerCase()).join('/')
    : resolved.relPath
  if (/^草稿区\/\.(archive-receipts|maintenance-receipts|author-edits)(?:\/|$)/.test(protectedPath)) {
    return { allow: false, zone, relPath: resolved.relPath, reason: '操作收据由工作台维护，文件工具不得修改。需要处理收据时，请把情况呈报作者' }
  }
  if (zone === '草稿区') return { allow: true, zone, relPath: resolved.relPath }
  if (zone === '定稿') {
    return { allow: false, reason: '定稿区只读，禁止用文件工具改写。要修改已定稿的章节，请走吃书补偿（novel_apply_retcon），并先获得作者批准', zone, relPath: resolved.relPath }
  }
  if (zone === '构想') {
    return { allow: false, reason: '构想快照建书后只读，禁止改写。要调整作品方向，请用 novel_update_contract 修改作品契约', zone, relPath: resolved.relPath }
  }
  return {
    allow: false,
    reason: `这个文件属于真源区，只能经专用工具写入，文件工具不得改写。${trueSourceTool(resolved.relPath)}`,
    zone,
    relPath: resolved.relPath,
  }
}

/** 真源区文件对应的专用工具（拒绝文件工具写入时给出下一步）。 */
export function trueSourceTool(relPath: string): string {
  const rules: ReadonlyArray<readonly [RegExp, string]> = [
    [/^作品契约\//, 'novel_update_contract'],
    [/^大纲\/故事骨架\.md$/, 'novel_update_skeleton'],
    [/^大纲\/分卷布局\.md$/, 'novel_update_volume_layout'],
    [/^大纲\/卷规划\/[^/]+\/近期窗口\.md$/, 'novel_roll_window'],
    [/^大纲\/卷规划\/[^/]+\/章细纲\//, 'novel_new_outline_draft 和 novel_confirm_outline'],
    [/^大纲\/卷规划\/[^/]+\/章摘要\//, 'novel_apply_retcon（更正已有章摘要）；摘要缺失时请作者先核对备份，不能用卷纲工具补写'],
    [/^大纲\/卷规划\/[^/]+\/(卷纲|计划时间线|卷摘要)\.md$/, 'novel_confirm_volume_outline'],
    [/^世界书\//, 'novel_confirm_worldbook_entry（设计条目）；已入档事实更正走 novel_apply_retcon'],
    [/^账本\//, 'novel_settle_chapter（新增沉淀）；已入档条目更正走 novel_apply_retcon'],
    [/^本书记忆\//, 'novel_record_memory（本书范围）；定稿候选随 novel_settle_chapter 沉淀'],
  ]
  const tool = rules.find(([pattern]) => pattern.test(relPath))?.[1]
  return tool === undefined ? '请改用对应的专用工具。' : `请改用 ${tool}。`
}
