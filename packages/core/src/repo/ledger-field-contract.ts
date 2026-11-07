/** Current ledger metadata; historical format detectors keep their own frozen keys. */
export const LEDGER_FIELD_KEYS = ['名称', '类型', '状态', '计划来源', '实际落点', '来源', '裁决记录'] as const
export const CLUE_FIELDS = ['埋设点', '预期兑现区间', '弃因'] as const

export const LEDGER_STATES = ['进行中', '已兑现', '已结束', '已放弃'] as const
export const CLUE_STATES = ['已埋', '已示', '已收', '已弃'] as const
export const ACTIVE_CLUE_STATES = ['已埋', '已示'] as const satisfies readonly (typeof CLUE_STATES)[number][]

export type LedgerField = (typeof LEDGER_FIELD_KEYS)[number]
export type ClueField = (typeof CLUE_FIELDS)[number]

/** Candidate rules do not make historical readers require these fields. */
export const LEDGER_FIELD_RULES = {
  名称: { owner: 'heading', candidate: 'optional-match-heading', empty: 'use-heading' },
  类型: { owner: 'classification', candidate: 'optional-match-classification', empty: 'use-classification' },
  状态: { owner: 'candidate', candidate: 'required-domain-state', empty: 'reject' },
  计划来源: { owner: 'candidate', candidate: 'required-text', empty: 'reject' },
  实际落点: { owner: 'settlement', candidate: 'overwritten', empty: 'use-approved-chapter' },
  来源: { owner: 'settlement', candidate: 'overwritten', empty: 'use-approved-source' },
  裁决记录: { owner: 'settlement', candidate: 'overwritten', empty: 'use-approved-decision' },
} as const satisfies Readonly<Record<LedgerField, { readonly owner: string; readonly candidate: string; readonly empty: string }>>

export const CLUE_FIELD_RULES = {
  埋设点: { owner: 'candidate', candidate: 'required-text', empty: 'reject' },
  预期兑现区间: { owner: 'candidate', candidate: 'required-text', empty: 'reject' },
  弃因: { owner: 'candidate', candidate: 'required-when-abandoned', empty: 'allowed-unless-abandoned' },
} as const satisfies Readonly<Record<ClueField, { readonly owner: string; readonly candidate: string; readonly empty: string }>>
