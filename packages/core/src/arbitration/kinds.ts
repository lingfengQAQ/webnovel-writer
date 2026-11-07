/**
 * 不可逆动作清单(插件规格 §6):全部经 ctx.userQuestions,模型碰不到裁决通道。
 */

export const IRREVERSIBLE_KINDS = [
  '定稿入档',
  '世界书条目转正',
  '记忆入记',
  '吃书补偿',
  '规则来源声明',
  '书仓升级',
  '书仓升级续办',
] as const

export type IrreversibleKind = (typeof IRREVERSIBLE_KINDS)[number]

export function isIrreversibleKind(value: string): value is IrreversibleKind {
  return (IRREVERSIBLE_KINDS as readonly string[]).includes(value)
}
