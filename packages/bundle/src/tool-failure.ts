/**
 * 工具失败的统一结构（修复计划 PR-6）。
 *
 * 每个失败结果都回答三个问题：失败了什么（reason）、属于哪一类（code）、
 * 下一步做什么（next）。主 Agent 按 code 决定重试、改参数还是问作者。
 */

import { BookLockError, TransactionConflictError, SettlementParseError } from '@webnovel/core'

export type ToolFailureCode =
  | 'invalid-argument'
  | 'book-not-found'
  | 'book-locked'
  | 'lock-interrupted'
  | 'runtime-link'
  | 'transaction-conflict'
  | 'author-declined'
  | 'author-cancelled'
  | 'approval-stale'
  | 'source-conflict'
  | 'parse-error'
  | 'host-unavailable'
  | 'partial-commit'
  | 'internal'

export interface ToolFailure {
  readonly ok: false
  readonly code: string
  readonly reason: string
  readonly next: string
}

/** 每类失败的默认下一步。 */
export const NEXT_STEP: Readonly<Record<ToolFailureCode, string>> = {
  'invalid-argument': '按 reason 修正参数后重新调用。',
  'book-not-found': '调用 novel_select_book 核对书目和书id，再重新调用。',
  'book-locked': '等几秒后重试一次。仍然失败时，请作者检查是否开着其他写作窗口。',
  'lock-interrupted': '等 30 秒后重试一次。确认持有进程退出的 acquire.lock 会自动回收；归属不明时，请作者核对并确认没有其他写作窗口后再清理。',
  'runtime-link': '本次没有写入。请作者核对 reason 中的运行路径，保留证据，不要用链接替代书仓运行目录。',
  'transaction-conflict': '先把隔离事务的备份和当前文件呈报作者。处理冲突后再写入，目标未知时暂停所有写入。',
  'author-declined': '不要重新调用本工具。先问作者要改什么，再按回答回到对应节点。',
  'author-cancelled': '本次没有写入。等作者明确批准后，再调用本工具。',
  'approval-stale': '旧批准已失效。重新呈报作者，获得新的批准后再调用。',
  'source-conflict': '不要用相同参数重试。把冲突原文呈报作者，由作者决定保留哪一份。',
  'parse-error': '按 reason 指出的位置修正内容，再重新调用一次。仍然失败时，把 reason 原文告诉作者。',
  'host-unavailable': '本次没有写入。请作者重启工作台，或核对 DSH 版本是否与插件配套。',
  'partial-commit': '文件已写入但还没有提交。用相同参数重新调用本工具即可补提交。',
  internal: '不要用相同参数反复重试。把 reason 原文告诉作者。',
}

export function toolFailure(code: ToolFailureCode, reason: string, next: string = NEXT_STEP[code]): ToolFailure {
  return { ok: false, code, reason, next }
}

/** 错误的可读文本：只取 message，避免 `Error:` 前缀层层嵌套。 */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Expected business errors share the result contract; unknown host errors stay thrown. */
export function expectedFailure(error: unknown): ToolFailure | undefined {
  const seen = new Set<unknown>()
  for (let current = error; current instanceof Error && !seen.has(current); current = current.cause) {
    seen.add(current)
    if (current instanceof BookLockError || current instanceof TransactionConflictError) return toolFailure(current.code, errorText(error))
    if (current instanceof SettlementParseError) return toolFailure('parse-error', errorText(error))
  }
  return undefined
}

/** Preserve typed causes before adding the existing operation-specific context. */
export function failureFrom(error: unknown, prefix = ''): ToolFailure {
  const known = expectedFailure(error)
  const reason = `${prefix}${errorText(error)}`
  return known === undefined ? toolFailure(classifyReason(reason), reason) : { ...known, reason }
}

const RULES: ReadonlyArray<readonly [ToolFailureCode, RegExp]> = [
  ['lock-interrupted', /锁获取曾中断|acquire\.lock/],
  ['book-locked', /书仓写入锁定中|书仓.*锁定/],
  ['partial-commit', /提交失败|未形成提交|已落盘但未提交/],
  ['author-declined', /未获作者批准|作者.{0,4}(驳回|拒绝)/],
  ['author-cancelled', /裁决.{0,2}取消|作者关闭了裁决|作者已取消/],
  ['approval-stale', /等待作者裁决期间|旧批准/],
  ['source-conflict', /冲突|已隔离|只增不改|已被另行修改|新归档须同时新建本章定稿与章摘要/],
  ['host-unavailable', /裁决窗口|工作范围未就绪|未配置|不可用|尚未就绪/],
  ['book-not-found', /书id|bookId|书目/],
  ['parse-error', /解析失败|未分类正文|无法解析|第 \d+ 行：/],
  ['invalid-argument', /必须|不能为空|不得|非法|不合法|必填|为空|缺少|不存在|过长|超过|不支持|须/],
]

/** 按 reason 文本归类（仅在调用方没有给出 code 时使用）。 */
export function classifyReason(reason: string): ToolFailureCode {
  for (const [code, pattern] of RULES) if (pattern.test(reason)) return code
  return 'internal'
}

/**
 * 把任意 `{ ok: false, reason }` 结果补齐为统一结构：保留已有字段，
 * 缺 code 时按 reason 归类，缺 next 时给出该类的默认下一步。
 */
export function normalizeFailure<T>(result: T): T {
  if (result === null || typeof result !== 'object') return result
  const value = result as Record<string, unknown>
  if (value['ok'] !== false || typeof value['reason'] !== 'string') return result
  const known = typeof value['code'] === 'string' && value['code'] in NEXT_STEP ? value['code'] as ToolFailureCode : undefined
  const code = typeof value['code'] === 'string' ? value['code'] : classifyReason(value['reason'])
  const next = typeof value['next'] === 'string' && value['next'] !== ''
    ? value['next']
    : NEXT_STEP[known ?? (code in NEXT_STEP ? code as ToolFailureCode : classifyReason(value['reason']))]
  return { ...value, code, next } as T
}

/** 输出 schema 中统一追加的字段说明。 */
export const FAILURE_FIELDS = {
  code: { type: 'string', description: '失败类别（如 invalid-argument、book-locked、author-declined），成功时不返回' },
  next: { type: 'string', description: '失败后的下一步，成功时不返回' },
} as const
