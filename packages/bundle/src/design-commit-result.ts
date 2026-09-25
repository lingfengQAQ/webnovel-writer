import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionSeq } from '@deepseek-ai/dsh-session'
import type { commitConfirmed } from '@webnovel/core'
import type { ToolExecContext } from './novel-tools'

export const NATIVE_DESIGN_TOOLS = new Set([
  'novel_update_contract', 'novel_update_skeleton', 'novel_update_volume_layout',
  'novel_roll_window', 'novel_confirm_worldbook_entry', 'novel_confirm_volume_outline',
])

export const DESIGN_COMMIT_FIELDS = {
  commitState: { type: 'string' as const, enum: ['committed', 'unchanged', 'not-required', 'failed'], description: '提交结果；unchanged 是成功完成，不需要补提交' },
  retryable: { type: 'boolean' as const, description: '仅提交失败允许处理原因后原参数补试一次，成功不重试' },
}

type CommitState = 'committed' | 'unchanged' | 'not-required' | 'failed'
export type DesignCommitResult =
  | { readonly ok: true; readonly commitState: Exclude<CommitState, 'failed'>; readonly retryable: false; readonly message: string }
  | { readonly ok: false; readonly commitState: 'failed'; readonly retryable: true; readonly reason: string }

function recordedState(content: readonly ContentBlock[]): CommitState | undefined {
  for (const block of content) {
    if (block.type !== 'text') continue
    try {
      const value: unknown = JSON.parse(block.text)
      if (value === null || typeof value !== 'object' || !('commitState' in value) || !('ok' in value)) continue
      if (value.ok === true && ['committed', 'unchanged', 'not-required'].includes(String(value.commitState))) return value.commitState as CommitState
      if (value.ok === false && value.commitState === 'failed') return 'failed'
    } catch { /* Only this plugin's structured design results are recognized. */ }
  }
  return undefined
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}'
  }
  return JSON.stringify(value) ?? 'undefined'
}

function sameOperation(previous: unknown, args: Record<string, unknown>): boolean {
  if (previous === null || typeof previous !== 'object' || Array.isArray(previous)) return false
  // A new commit summary cannot turn an unchanged design into new work.
  const withoutSummary = (value: object) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'summary'))
  return canonical(withoutSummary(previous)) === canonical(withoutSummary(args))
}

/** Read only native call/result evidence in this turn; no parallel progress or replay store. */
export function repeatedDesignNoChange(args: Record<string, unknown>, exec?: ToolExecContext): boolean {
  const session = exec?.agent?.session
  if (!session?.eventAt || session.seq === undefined || !exec?.name || !NATIVE_DESIGN_TOOLS.has(exec.name)) return false
  const results = new Map<string, CommitState>()
  for (let seq = session.seq - 1; seq >= 0; seq--) {
    const event = session.eventAt(seq as SessionSeq)
    if (!event) continue
    if (event.type === 'turn/start' || event.type === 'turn/end') break
    if (event.type === 'user/message' && (event.data.source.kind === 'user'
      || (event.data.source.kind === 'plugin' && event.data.source.plugin === 'webnovel'))) break
    if (event.type === 'tool/result') {
      const block = event.data.message.content[0]
      const state = block.isError ? undefined : recordedState(block.content)
      if (state !== undefined) results.set(block.toolCallId, state)
    }
    if (event.type === 'tool/call' && NATIVE_DESIGN_TOOLS.has(event.data.name) && results.has(event.data.callId)) {
      try {
        return results.get(event.data.callId) === 'unchanged' && event.data.name === exec.name
          && sameOperation(JSON.parse(event.data.arguments), args)
      } catch { return false }
    }
    if (event.type === 'tool/ptc-dispatch' && NATIVE_DESIGN_TOOLS.has(event.data.name)) {
      const state = event.data.isError ? undefined : recordedState(event.data.content)
      if (state !== undefined) return state === 'unchanged' && event.data.name === exec.name && sameOperation(event.data.arguments, args)
    }
  }
  return false
}

export function designCommitResult(
  commit: ReturnType<typeof commitConfirmed>, summary: string, args: Record<string, unknown>, exec?: ToolExecContext,
): DesignCommitResult {
  if (!commit.ok) return {
    ok: false, commitState: 'failed', retryable: true,
    reason: `已落盘但未提交：${commit.reason}。处理失败原因后，最多原参数补试一次；仍失败就停止并报告，不重写内容。`,
  }
  const stopped = commit.noChanges === true && !!exec?.concludeTurn && repeatedDesignNoChange(args, exec)
  if (stopped) exec!.concludeTurn!()
  return {
    ok: true, commitState: commit.noChanges === true ? 'unchanged' : 'committed', retryable: false,
    message: commit.noChanges === true
      ? `${summary} 已完成：当前内容与已提交版本一致，无需补提交，不要重复调用。${stopped ? '同一轮重复执行已完成的操作，本轮已停止；没有新增提交。' : ''}`
      : `${summary} 已确认（${commit.message}）`,
  }
}
