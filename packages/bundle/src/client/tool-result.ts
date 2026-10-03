import type { ToolCallPhaseProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { isStoppedError } from '../study/workflow-types'

export const novelToolTitles: Readonly<Record<string, string>> = {
  novel_reference_source: '管理参考小说', novel_reference_analyze: '渐进拆解小说',
  novel_reference_query: '查找参考机制', novel_reference_report: '保存拆书成果',
  novel_select_book: '选择作品', novel_create_book: '创建作品', novel_update_contract: '更新作品契约',
  novel_get_story_status: '查看写作状态', novel_search_finalized: '检索定稿', novel_index_manage: '管理检索索引',
  novel_prepare_pack: '准备定稿包', novel_settle_chapter: '定稿入档', novel_new_outline_draft: '准备大纲草案',
  novel_confirm_outline: '确认大纲', novel_update_skeleton: '更新故事骨架', novel_update_volume_layout: '更新分卷布局',
  novel_roll_window: '更新近期窗口', novel_confirm_worldbook_entry: '确认世界书', novel_confirm_volume_outline: '确认卷纲',
  novel_assemble_materials: '组装写作材料', novel_apply_revision: '应用改稿', novel_apply_revision_batch: '应用批次改稿',
  novel_import_draft: '导入草稿', novel_record_review_findings: '记录审读结果', novel_record_proposal: '记录提案',
  novel_resolve_proposal: '处置提案', novel_apply_retcon: '应用吃书补偿', novel_record_memory: '记录本书记忆',
  novel_note_pending: '记录待补事项', novel_get_book_progress: '查看作品进度',
}

export interface NovelResultModel {
  state: 'preparing' | 'running' | 'success' | 'attention' | 'error' | 'stopped' | 'unknown'
  label: string
  summary: string
  facts: readonly { label: string; value: string }[]
  raw: string
  args: string
  report?: string
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined

/** Read only the frozen result, never infer current book state from a historical call. */
export function novelResultModel(props: ToolCallPhaseProps): NovelResultModel {
  const base = { facts: [], raw: '', args: '' }
  if (props.phase === 'preparing') return { ...base, state: 'preparing', label: '准备中', summary: '正在准备调用参数' }
  if (props.phase === 'start') return { ...base, args: props.block.argsRaw, state: 'running', label: '进行中', summary: '等待本次操作返回结果' }
  const block = props.block
  const raw = block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2)).join('\n')
  const result: NovelResultModel = { ...base, raw, args: block.call?.argsRaw ?? '', state: 'unknown', label: '待核对', summary: '结果格式无法识别，请查看原始详情' }
  // Runtime failure always wins, even if a partial result contains ok:true.
  if (isStoppedError(block.error)) return { ...result, state: 'stopped', label: '已中断', summary: '操作已中断；继续前请核对已产生的结果' }
  if (block.isError) return { ...result, state: 'error', label: '执行异常', summary: '请查看错误详情，核对已产生的结果后再决定是否重试' }
  if (block.content.length !== 1 || block.content[0]?.type !== 'text') return result
  let value: unknown
  try { value = JSON.parse(raw) } catch { return result }
  if (!object(value) || typeof value.ok !== 'boolean') return result
  if (!value.ok || value.commitState === 'failed') return { ...result, state: 'error', label: '未完成', summary: text(value.reason) ?? text(value.message) ?? '本次操作未完成，请查看详情' }
  const facts: { label: string; value: string }[] = []
  for (const [key, label] of [['bookName', '作品'], ['bookId', '书 ID'], ['卷', '当前卷'], ['规划卷', '规划目标卷']] as const) {
    if (typeof value[key] === 'string' || typeof value[key] === 'number') facts.push({ label, value: String(value[key]) })
  }
  let pending = false
  if (typeof value.verifiedBatches === 'number') facts.push({ label: '已校验批次', value: String(value.verifiedBatches) })
  if (typeof value.fullBookComplete === 'boolean') facts.push({ label: '报告范围', value: value.fullBookComplete ? '全书可读正文' : '局部拆解' })
  if (typeof value.selectedRangeComplete === 'boolean') facts.push({ label: '选定范围', value: value.selectedRangeComplete ? '已完成' : '尚未完成' })
  if (Array.isArray(value.issues) && value.issues.length) { pending = true; facts.push({ label: '待核对问题', value: String(value.issues.length) }) }
  for (const key of ['待处置数', '待继承处置数', '待回写模块', '未决偏离', '待核对', '疑似占位待核对', '内容问题']) {
    const item = value[key]
    const count = Array.isArray(item) ? item.length : typeof item === 'number' && Number.isFinite(item) && item >= 0 ? item : undefined
    if (count !== undefined) { facts.push({ label: key, value: String(count) }); if (count > 0) pending = true }
  }
  if (object(value.design)) {
    if (text(value.design.建议)) facts.push({ label: '设计建议', value: value.design.建议 as string })
    for (const key of ['已确认无内容', '内容问题']) {
      const issues = value.design[key]
      if (Array.isArray(issues) && issues.length > 0) { pending = true; facts.push({ label: key, value: String(issues.length) }) }
    }
  }
  if (typeof value.完成 === 'boolean') facts.push({ label: '模块回写', value: value.完成 ? '全部回写' : '尚未全部回写' })
  if (typeof value.审核通过 === 'boolean') facts.push({ label: '审核', value: value.审核通过 ? '通过' : '尚未通过' })
  pending ||= value.完成 === false || value.审核通过 === false
  const commitLabels: Record<string, string> = { committed: '已提交', unchanged: '无变化，无需重复提交', 'not-required': '无需提交' }
  if (typeof value.commitState === 'string') {
    if (!commitLabels[value.commitState]) return result
    facts.push({ label: '提交', value: commitLabels[value.commitState]! })
  }
  return { ...result, facts, ...(text(value.渲染) ? { report: value.渲染 as string } : {}), state: pending ? 'attention' : 'success', label: pending ? '有待处理项' : value.commitState === 'unchanged' ? '无变化' : '操作成功',
    summary: text(value.reason) ?? text(value.message) ?? (pending ? '本次操作已返回，仍有事项需要核对' : '本次操作已完成，可展开查看结果'),
  }
}
