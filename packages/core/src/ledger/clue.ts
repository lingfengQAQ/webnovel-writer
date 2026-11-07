/**
 * 线索机器字段合同(格式规格 §5.2):埋设点、预期兑现区间,已弃时的弃因。
 *
 * 沉淀把候选开头字段区里的这三项写进 `### 正文` 之前的系统字段区;读侧只认系统区。
 * 正文里的同名行属于作者原文,既不剥除,也不当字段。
 */

import { CLUE_FIELDS } from '../repo/ledger-field-contract'

export { CLUE_FIELDS } from '../repo/ledger-field-contract'

/** 账本字段行:可带列表符,全角或半角冒号。读侧解析与线索开头字段识别共用。 */
export const FIELD_RE = /^\s*(?:[-*]\s*)?([^：:]+)[：:]\s*(.*?)\s*$/

/** 修复前沉淀写入器固定产出的系统头,只用于识别旧形态,不随新写入器变化。 */
const SETTLED_HEADER = ['名称', '类型', '状态', '计划来源', '实际落点', '来源', '裁决记录'] as const

export interface LeadingField {
  readonly field: string
  readonly value: string
  /** 在传入行数组中的下标。 */
  readonly index: number
}

/** 开头连续的字段行:空行不打断,遇到第一行其他内容即止。 */
export function leadingFields(lines: readonly string[], fields: readonly string[]): LeadingField[] {
  const found: LeadingField[] = []
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue
    const match = FIELD_RE.exec(line)
    const field = match?.[1]?.trim()
    if (match === null || field === undefined || !fields.includes(field)) break
    found.push({ field, value: match[2]!, index })
  }
  return found
}

/** Detect the retired producer shape for a maintenance diagnostic; never recover fields. */
export function hasLegacyClueFields(fields: Readonly<Record<string, string>>, prose: string): boolean {
  return ledgerContentShape('线索', fields, prose)?.format === 'legacy'
}

/** Identify displaced metadata, without interpreting prose in complete current entries. */
export function ledgerContentShape(kind: '线索' | '时间线', fields: Readonly<Record<string, string>>, prose: string):
  { readonly format: 'legacy' | 'invalid'; readonly reason: string } | undefined {
  const targets = kind === '线索' ? CLUE_FIELDS : ['事件', '时点']
  const required = kind === '线索' ? ['埋设点', '预期兑现区间', ...(fields['状态'] === '已弃' ? ['弃因'] : [])] : ['事件', '时点']
  if (required.every(key => !!fields[key])) return undefined
  const lead = leadingFields(prose.split('\n'), targets)
  if (!lead.length) return undefined
  const existing = targets.some(key => Object.hasOwn(fields, key))
  const header = kind === '线索' ? SETTLED_HEADER : ['章号', '来源', '裁决记录']
  // A short hand-written entry is not evidence of the retired producer.
  if (!existing && (!header.every(key => !!fields[key]) || kind === '线索' && fields['类型'] !== '线索')) return undefined
  const duplicate = lead.find((field, index) => lead.findIndex(other => other.field === field.field) !== index)
  if (duplicate) return { format: 'invalid', reason: `旧${kind}前缀字段重复：${duplicate.field}` }
  if (existing) return { format: 'invalid', reason: `${kind}字段分散在结构区与正文前缀，不能自动搬位；请核对缺失字段：${required.filter(key => !fields[key]).join('、')}` }
  const legacyRequired = kind === '时间线' ? ['事件'] : required
  if (legacyRequired.some(key => !lead.some(field => field.field === key && field.value))) {
    return { format: 'invalid', reason: `旧${kind}缺少有唯一来源的前置${legacyRequired.join('、')}字段` }
  }
  if (kind === '线索' && lead.some(field => !field.value)) return { format: 'invalid', reason: '旧线索字段为空，不能猜补' }
  return { format: 'legacy', reason: `旧${kind}字段仍在正文前缀；请先运行书仓检查并预览升级，当前读取未转换原文` }
}
