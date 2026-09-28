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
  if (rel === '') return { ok: false, reason: '禁止改写书仓根本身(不变量 4)' }
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, reason: '路径逃逸书仓根,拒绝写入(不变量 4)' }
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
  if (/^草稿区\/\.(archive-receipts|author-edits)(?:\/|$)/.test(protectedPath)) {
    return { allow: false, zone, relPath: resolved.relPath, reason: '操作收据由受信写入器维护，文件工具不得修改' }
  }
  if (zone === '草稿区') return { allow: true, zone, relPath: resolved.relPath }
  if (zone === '定稿') {
    return { allow: false, reason: '定稿区只读,禁止文件工具改写(不变量 4)', zone, relPath: resolved.relPath }
  }
  if (zone === '构想') {
    return { allow: false, reason: '构想快照建书后只读,禁止改写(不变量 5)', zone, relPath: resolved.relPath }
  }
  return {
    allow: false,
    reason: '真源区仅书仓写入器可写,文件工具不得改写(不变量 4)',
    zone,
    relPath: resolved.relPath,
  }
}
