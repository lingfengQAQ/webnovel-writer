/**
 * tools/pre-execute 纯策略(插件规格 §6):非改写工具放行;改写文件工具先路径门禁再写稿门槛。
 * 缺路径/不可解析一律拒绝(fail-closed)。
 */

import { gateFileAccess } from './paths'
import type { PreToolDecision, ToolCall } from './types'
import { gateWriteDraft } from './writeDraft'

const MUTATING_FILE_TOOLS = new Set(['write', 'edit', 'str_replace_editor'])
const STR_REPLACE_MUTATING = new Set(['create', 'str_replace', 'insert'])

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringField(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj) return null
  const v = obj[key]
  return typeof v === 'string' && v !== '' ? v : null
}

export function isMutatingFileTool(exec: ToolCall): boolean {
  if (!MUTATING_FILE_TOOLS.has(exec.name)) return false
  if (exec.name !== 'str_replace_editor') return true
  const cmd = stringField(asRecord(exec.arguments), 'command')
  if (cmd === 'view') return false
  if (cmd === null) return true
  return STR_REPLACE_MUTATING.has(cmd) || cmd !== 'view'
}

export function extractToolPath(exec: ToolCall): string | null {
  const args = asRecord(exec.arguments)
  if (exec.name === 'read' || exec.name === 'write' || exec.name === 'edit') return stringField(args, 'file_path')
  if (exec.name === 'str_replace_editor') return stringField(args, 'path')
  return null
}

export function decidePreExecute(bookRoot: string, exec: ToolCall): PreToolDecision {
  if (!isMutatingFileTool(exec)) return { kind: 'allow' }
  const target = extractToolPath(exec)
  if (target === null) return { kind: 'deny', reason: '文件工具缺少可解析路径,拒绝写入' }
  const access = gateFileAccess(bookRoot, target)
  if (!access.allow) return { kind: 'deny', reason: access.reason }
  const draft = gateWriteDraft(bookRoot, access.relPath)
  if (!draft.allow) return { kind: 'deny', reason: draft.reason }
  return { kind: 'allow' }
}
