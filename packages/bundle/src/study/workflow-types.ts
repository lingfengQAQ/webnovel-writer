/** Display vocabulary only. These stages never schedule or authorize work. */
export const workflowStages = [
  { id: 'idea', label: '构思', group: 'book', note: '收集灵感，确定这本书要讲什么。' },
  { id: 'design', label: '设定', group: 'book', note: '作品定调、人物与世界设定。' },
  { id: 'skeleton', label: '骨架', group: 'book', note: '整理故事主线与关键转折。' },
  { id: 'volumes', label: '分卷', group: 'book', note: '安排各卷的目标与篇幅。' },
  { id: 'volume', label: '卷纲', group: 'book', note: '规划当前卷和近期章节。' },
  { id: 'volume-close', label: '卷末收束', group: 'book', note: '核对卷末状态并确认卷摘要。' },
  { id: 'outline', label: '细纲', group: 'chapter', note: '准备并确认本章细纲。' },
  { id: 'materials', label: '备料', group: 'chapter', note: '核对并整理本章写作材料。' },
  { id: 'draft', label: '写稿', group: 'chapter', note: '依照细纲与材料完成正文。' },
  { id: 'polish', label: '润色', group: 'chapter', note: '打磨文字，保留原意。' },
  { id: 'review', label: '审读', group: 'chapter', note: '检查本章，记录需要处理的问题。' },
  { id: 'revise', label: '改稿', group: 'chapter', note: '按已确认的意见修改，必要时重新审读。' },
  { id: 'settle', label: '沉淀', group: 'chapter', note: '整理摘要、线索与世界书，准备定稿包。' },
  { id: 'confirm', label: '定稿', group: 'chapter', note: '等待作者裁决，批准后入档。本章完成后不自动开下一章。' },
] as const
export type WorkflowStage = typeof workflowStages[number]['id']
export type RunState = 'preparing' | 'running' | 'waiting' | 'success' | 'attention' | 'error' | 'stopped' | 'unknown'
export const runLabels: Record<RunState, string> = { preparing: '准备中', running: '进行中', waiting: '待确认', success: '操作完成', attention: '待处理', error: '出错了', stopped: '已中断', unknown: '待核对' }
export const toolStages: Readonly<Record<string, WorkflowStage>> = {
  novel_create_book: 'idea', novel_update_contract: 'design', novel_confirm_worldbook_entry: 'design',
  novel_update_skeleton: 'skeleton', novel_update_volume_layout: 'volumes', novel_confirm_volume_outline: 'volume', novel_roll_window: 'volume',
  novel_new_outline_draft: 'outline', novel_confirm_outline: 'outline', novel_assemble_materials: 'materials',
  novel_import_draft: 'draft', novel_record_review_findings: 'review', novel_apply_revision: 'revise', novel_apply_revision_batch: 'revise',
  novel_prepare_pack: 'settle', novel_settle_chapter: 'confirm',
}
export interface WorkflowCall {
  id: string
  name: string
  stage?: WorkflowStage
  bookId?: string
  chapter?: number
  state: RunState
  started: number
  ended?: number
  summary: string
  failureCode?: string
}
export interface WorkflowView {
  available: boolean
  active: boolean
  syncing: boolean
  asOf: number
  calls: WorkflowCall[]
  otherActive: number
  waiting: boolean
}
export const recordOf = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export const isStoppedError = (error: unknown): boolean => ['interrupted', 'ABORTED', 'ABORTED_BEFORE_DISPATCH', 'ASK_ABORTED'].includes(String(recordOf(error).code))
export function resultState(content: unknown, isError: unknown, error: unknown): Pick<WorkflowCall, 'state' | 'summary'> {
  if (isStoppedError(error)) return { state: 'stopped', summary: '操作已中断，请核对已有结果。' }
  if (isError === true) return { state: 'error', summary: '操作失败，请查看对话中的错误详情。' }
  const parts = Array.isArray(content) ? content : []
  if (parts.length !== 1 || recordOf(parts[0]).type !== 'text') return { state: 'unknown', summary: '结果已返回，完成情况待核对。' }
  let value: Record<string, unknown>
  try { value = recordOf(JSON.parse(String(recordOf(parts[0]).text))) } catch { return { state: 'unknown', summary: '结果已返回，完成情况待核对。' } }
  if (typeof value.ok !== 'boolean') return { state: 'unknown', summary: '结果已返回，完成情况待核对。' }
  if (!value.ok || value.commitState === 'failed') return { state: 'error', summary: '操作未完成，请查看对话中的原因。' }
  if (value.commitState !== undefined && !['committed', 'unchanged', 'not-required'].includes(String(value.commitState))) return { state: 'unknown', summary: '提交结果待核对。' }
  const pending = value.完成 === false || value.审核通过 === false || ['待处置数', '待继承处置数', '待回写模块', '未决偏离', '待核对', '内容问题'].some(key => typeof value[key] === 'number' ? Number(value[key]) > 0 : Array.isArray(value[key]) && value[key].length > 0)
  return pending ? { state: 'attention', summary: '本次操作已返回，仍有事项待处理。' } : { state: 'success', summary: '本次操作完成，不代表整个环节已完成。' }
}
