/**
 * 提交说明(D4):机器前缀 ch:/vol:/design:/retcon:/fix: ＋条目速记。
 * retcon: 仅吃书补偿通道可产生(不变量 4)。
 * design: 携带活跃章 Scope(章号全书连续,格式 design(chNNNN):);
 *   提交点跟随作者确认(2026-08-29 拍板 1/7),ch: 不带 Scope。
 */

export const COMMIT_PREFIXES = ['ch', 'vol', 'design', 'retcon', 'fix'] as const
export type CommitPrefix = (typeof COMMIT_PREFIXES)[number]

export interface CommitMessageInput {
  readonly prefix: CommitPrefix
  readonly summary: string
  readonly lines?: readonly string[]
  readonly kind?: string
  /** 活跃章号 Scope,仅 design: 携带;格式化为 (chNNNN)。 */
  readonly chapterScope?: number
}

export function formatCommitMessage(input: CommitMessageInput): string {
  if (input.prefix === 'retcon' && input.kind !== '吃书补偿') {
    throw new Error('retcon: 前缀仅补偿通道可产生')
  }
  if (input.chapterScope !== undefined && input.prefix !== 'design') {
    throw new Error('章号 Scope 仅 design: 前缀携带')
  }
  const scope = input.chapterScope === undefined ? '' : `(ch${String(input.chapterScope).padStart(4, '0')})`
  const head = `${input.prefix}${scope}: ${input.summary.trim()}`
  const extra = (input.lines ?? []).map((l) => l.trim()).filter((l) => l !== '')
  return extra.length === 0 ? head : [head, '', ...extra].join('\n')
}
