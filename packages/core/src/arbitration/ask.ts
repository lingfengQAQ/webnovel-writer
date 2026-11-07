/**
 * userQuestions 请求形状与答案解释。缺答/非选项一律拒绝。
 *
 * 类型取自 dsh `@deepseek-ai/dsh-user-questions/types`(裁决 14)。该子路径不带
 * cordis/service 导入,core 保持纯真源逻辑,不引入宿主运行时依赖。
 */

import type {
  AskUserQuestionAnswer,
  AskUserQuestionAnswerItem,
  AskUserQuestionItem,
} from '@deepseek-ai/dsh-user-questions/types'
import type { IrreversibleKind } from './kinds'
import type { 裁决决定 } from './record'

export const APPROVE_LABEL = '批准'
export const REJECT_LABEL = '退回'

export type AskQuestion = AskUserQuestionItem
export type AskAnswer = AskUserQuestionAnswerItem
export type AskResponse = AskUserQuestionAnswer

/**
 * 与 dsh `AskUserQuestionRequest` 结构兼容。此处不从主入口导入该接口:主入口声明
 * 带 cordis/dsh-agent/dsh-llm 依赖链,core 只用 `/types` 这一不带链的子路径。
 * `agent` 故不锚死 dsh `Agent` 类型,由宿主侧传入时收窄。
 */
export interface AskRequest {
  questions: AskQuestion[]
  agent?: unknown
  signal?: AbortSignal
}

export interface ArbitrationPayload {
  readonly 范围: string
  readonly 版本?: string | number
  readonly 摘要?: string
}

/**
 * 空载兜底文案。dsh `ask()` 拒绝「带 intent 却无 detail」的问题
 * (user-questions/src/index.ts:130,BAD_INTENT):UI 把 detail 当作被审的那份东西
 * 展示,无 detail 就等于让作者批准看不见的内容。范围/摘要皆缺时用它顶上。
 */
const KIND_FALLBACK_DETAIL: Record<IrreversibleKind, string> = {
  定稿入档: '本章定稿入档:入档后只增不改,后续更正走吃书补偿。',
  世界书条目转正: '世界书条目由计划转为事实:转正后成为下游可依赖的真源。',
  记忆入记: '本书记忆候选入记:入记后进入长期记忆,后续检索可见。',
  吃书补偿: '吃书补偿事件:已入档内容与后续设定冲突,以补偿方式收口。',
  规则来源声明: '规则来源声明:声明后作为裁决依据被引用。',
  书仓升级: '按本次预览转换书仓格式；文件、格式标记和版本提交按同一计划核对。',
  书仓升级续办: '核对指定维护操作的收据，仅恢复其中断批次或补办原批次提交。',
}

const KIND_QUESTION: Record<IrreversibleKind, string> = {
  定稿入档: '是否批准本章定稿入档?',
  世界书条目转正: '是否批准将该世界书条目由计划转为事实?',
  记忆入记: '是否批准将本书记忆候选入记?',
  吃书补偿: '是否批准吃书补偿事件?',
  规则来源声明: '是否确认该规则来源声明?',
  书仓升级: '是否批准这份书仓升级计划？',
  书仓升级续办: '是否批准续办这次书仓升级？',
}

export function buildAskRequest(kind: IrreversibleKind, payload: ArbitrationPayload): AskRequest {
  const parts = [payload.范围, payload.摘要].filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  const detail = parts.length > 0 ? parts.join(kind === '书仓升级' || kind === '书仓升级续办' ? '\n\n' : ' · ') : KIND_FALLBACK_DETAIL[kind]
  return {
    questions: [
      {
        id: kind,
        header: kind,
        question: KIND_QUESTION[kind],
        detail,
        options: [
          { label: APPROVE_LABEL, description: kind === '书仓升级' ? '只执行本次预览并核对提交' : kind === '书仓升级续办' ? '只续办列出的原维护操作' : '不可逆动作生效' },
          { label: REJECT_LABEL, description: '退回,不生效' },
        ],
        multiSelect: false,
        // 具名批准选项:UI 不从选项顺序推断裁决(dsh 侧 ask() 校验 approve 须命名本题选项)
        intent: { kind: 'plan-review', approve: APPROVE_LABEL },
      },
    ],
  }
}

export type InterpretedAnswer =
  | { readonly ok: true; readonly 决定: 裁决决定 }
  | { readonly ok: false; readonly reason: string }

export function interpretAnswer(kind: IrreversibleKind, answer: AskAnswer | undefined): InterpretedAnswer {
  if (!answer) return { ok: false, reason: '缺答案，拒绝(fail-closed)' }
  if (answer.id !== kind) return { ok: false, reason: '答案 id 与种类不匹配，拒绝' }
  const selected = answer.selected
  if (!Array.isArray(selected) || selected.length !== 1) return { ok: false, reason: '答案缺失或非单一选项，拒绝' }
  const label = selected[0]
  if (label === APPROVE_LABEL) return { ok: true, 决定: kind === '规则来源声明' ? '已确认' : '已批准' }
  if (label === REJECT_LABEL) return { ok: true, 决定: '已退回' }
  return { ok: false, reason: `答案「${String(label)}」不在提供选项内，拒绝` }
}
