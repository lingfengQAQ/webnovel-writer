import type { ToolCallPhaseProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { isStoppedError, maintenanceNeedsAttention } from '../study/workflow-types'

export const novelToolTitles: Readonly<Record<string, string>> = {
  novel_reference_source: '管理参考小说', novel_reference_analyze: '渐进拆解小说',
  novel_reference_query: '查找参考机制', novel_reference_report: '保存拆书成果',
  novel_select_book: '选择作品', novel_create_book: '创建作品', novel_update_contract: '更新作品契约',
  novel_get_story_status: '查看写作状态', novel_search_finalized: '检索定稿', novel_index_manage: '管理检索索引',
  novel_check_book: '检查书仓', novel_begin_chapter: '开章前核对',
  novel_preview_book_upgrade: '预览书仓升级', novel_apply_book_upgrade: '执行书仓升级', novel_resume_book_upgrade: '续办书仓升级',
  novel_preview_draft_retention: '预览草稿留档', novel_confirm_draft_retention: '确认草稿留档',
  novel_prepare_pack: '准备定稿包', novel_settle_chapter: '定稿入档', novel_new_outline_draft: '准备大纲草案',
  novel_confirm_outline: '确认大纲', novel_update_skeleton: '更新故事骨架', novel_update_volume_layout: '更新分卷布局',
  novel_roll_window: '更新近期窗口', novel_confirm_worldbook_entry: '确认世界书', novel_confirm_volume_outline: '确认卷纲',
  novel_assemble_materials: '组装写作材料', novel_apply_revision: '应用改稿', novel_apply_revision_batch: '应用批次改稿',
  novel_import_draft: '导入草稿', novel_record_review_findings: '记录审读结果', novel_record_proposal: '记录提案',
  novel_resolve_proposal: '处置提案', novel_apply_retcon: '应用吃书补偿', novel_record_memory: '记录记忆',
  novel_note_pending: '记录待补事项', novel_get_book_progress: '查看作品进度',
  novel_editor_suggest: '交回编辑建议',
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
  if (value.maintenance === 'book-upgrade') return bookUpgradeResultModel(result, value)
  if (value.maintenance === 'draft-retention') return draftRetentionResultModel(result, value)
  if (!value.ok || value.commitState === 'failed') return { ...result, state: 'error', label: '未完成', summary: text(value.reason) ?? text(value.message) ?? '本次操作未完成，请查看详情' }
  const facts: { label: string; value: string }[] = []
  if (value.scope === 'book' || value.scope === 'author') facts.push({ label: '记忆归属', value: value.scope === 'book' ? '本书' : '作者' })
  if (typeof value.changed === 'boolean') facts.push({ label: '文件', value: value.changed ? '已更新' : '无变化' })
  for (const [key, label] of [['bookName', '作品'], ['bookId', '书 ID'], ['卷', '当前卷'], ['规划卷', '规划目标卷']] as const) {
    if (typeof value[key] === 'string' || typeof value[key] === 'number') facts.push({ label, value: String(value[key]) })
  }
  let pending = false
  const inspection = object(value.书仓检查) ? value.书仓检查 : undefined
  const opening = object(value.开章核对) ? value.开章核对 : undefined
  if (opening && text(opening.状态)) facts.push({ label: '开章核对', value: opening.状态 as string })
  if (inspection && text(inspection.状态)) facts.push({ label: '书仓检查', value: inspection.状态 as string })
  if (inspection && text(inspection.结论)) facts.push({ label: '受检结论', value: inspection.结论 as string })
  if (inspection && Array.isArray(inspection.未检范围)) facts.push({ label: '未检项', value: String(inspection.未检范围.length) })
  if (opening && Array.isArray(opening.提示) && opening.提示.length) facts.push({ label: '开章留档提示', value: String(opening.提示.length) })
  if (inspection && Array.isArray(inspection.提示) && inspection.提示.length) facts.push({ label: '书仓留档提示', value: String(inspection.提示.length) })
  pending ||= maintenanceNeedsAttention(value)
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
  return { ...result, facts, ...(text(value.渲染) ? { report: value.渲染 as string } : {}), state: pending ? 'attention' : 'success', label: pending ? '有待处理项' : inspection ? '检查完成' : value.commitState === 'unchanged' ? '无变化' : '操作成功',
    summary: text(value.reason) ?? text(value.message) ?? (pending ? '本次操作已返回，仍有事项需要核对' : '本次操作已完成，可展开查看结果'),
  }
}

function bookUpgradeResultModel(base: NovelResultModel, value: Record<string, unknown>): NovelResultModel {
  const facts: { label: string; value: string }[] = []
  for (const [key, label] of [['inspectionBefore', '原书检查'], ['inspectionAfter', '拟变换后检查（未写入）']] as const) {
    const inspection = value[key]
    if (object(inspection) && text(inspection.结论)) facts.push({ label, value: inspection.结论 as string })
  }
  if (Array.isArray(value.expectedStaleIssues) && value.expectedStaleIssues.length) facts.push({ label: '预计过期材料', value: String(value.expectedStaleIssues.length) })
  for (const [key, label] of [['bookId', '书 ID'], ['operationId', '操作编号'], ['commit', '提交']] as const) {
    if (text(value[key])) facts.push({ label, value: value[key] as string })
  }
  for (const [key, label] of [['activeWork', '保留未完工件'], ['changes', '拟变更文件'], ['effects', '受影响工件'], ['issues', '阻断项'], ['notices', '留档提示'], ['paths', '原批次文件']] as const) {
    if (Array.isArray(value[key])) facts.push({ label, value: String(value[key].length) })
  }
  const state = text(value.state)
  if (!value.ok) return { ...base, facts, state: 'error', label: state === 'written-pending-commit' ? '已写待提交' : '未完成', summary: text(value.reason) ?? '本次书仓升级未完成，请核对已有结果。' }
  const labels: Readonly<Record<string, { state: NovelResultModel['state']; label: string; summary: string }>> = {
    ready: { state: 'attention', label: '待批准', summary: '整仓预览已生成，尚未写入。请核对文件差异和受影响工件。' },
    unchanged: { state: 'success', label: '无需升级', summary: '当前受支持范围无须升级，本次没有写入或新增提交。' },
    blocked: { state: 'attention', label: '暂不可升级', summary: '整仓条件尚未满足，请核对阻断项。' },
    committed: { state: 'success', label: '升级已提交', summary: '本次整仓升级的文件与格式标记已提交。' },
    'already-committed': { state: 'success', label: '已核实原提交', summary: '原升级已有可信提交，本次没有重复写入。' },
    recovered: { state: 'attention', label: '已恢复，待重新预览', summary: '原中断批次已恢复。继续升级前需重新预览并请求作者批准。' },
    'written-pending-commit': { state: 'error', label: '已写待提交', summary: '文件已写入，提交尚未完成。请按原操作编号续办。' },
  }
  return state !== undefined && labels[state] ? { ...base, facts, ...labels[state]! } : { ...base, facts }
}

function draftRetentionResultModel(base: NovelResultModel, value: Record<string, unknown>): NovelResultModel {
  const facts: { label: string; value: string }[] = []
  for (const [key, label] of [['bookId', '书 ID'], ['operationId', '操作编号'], ['commit', '提交']] as const) {
    if (text(value[key])) facts.push({ label, value: value[key] as string })
  }
  if (object(value.chapter) && text(value.chapter.章名)) facts.push({ label: '章节', value: String(value.chapter.章名) })
  if (object(value.manifest)) {
    if (text(value.manifest.sourceDraft)) facts.push({ label: '来源稿', value: value.manifest.sourceDraft as string })
    if (Array.isArray(value.manifest.files)) facts.push({ label: '留档工件', value: String(value.manifest.files.length) })
  }
  for (const [key, label] of [['issues', '阻断项'], ['notices', '留档提示']] as const) {
    if (Array.isArray(value[key])) facts.push({ label, value: String(value[key].length) })
  }
  const state = text(value.state)
  if (!value.ok) return { ...base, facts, state: 'error', label: state === 'written-pending-commit' ? '已写待提交' : '未完成', summary: text(value.reason) ?? '本次留档确认未完成，请核对当前证据。' }
  const labels: Readonly<Record<string, { state: NovelResultModel['state']; label: string; summary: string }>> = {
    ready: { state: 'attention', label: value.action === 'resume' ? '待批准续办' : '待确认留档', summary: '本次清单已列出，等待作者确认当前这些工件仅作本章历史留档。' },
    unchanged: { state: 'success', label: '已有留档证据', summary: '本章留档证据已核实，无须重复确认或新增提交。' },
    committed: { state: 'success', label: '留档确认已提交', summary: '本章当前留档清单与定稿元数据已提交。' },
    'already-committed': { state: 'success', label: '已核实原提交', summary: '原留档已有可信提交，本次没有重复写入。' },
    'written-pending-commit': { state: 'error', label: '已写待提交', summary: '留档确认已写入，提交尚未完成。重新预览后续办原操作。' },
  }
  return state !== undefined && labels[state] ? { ...base, facts, ...labels[state]! } : { ...base, facts }
}

export type EditorDecisionLabel = 'accepted' | 'rejected' | 'reopened' | 'cancelled' | 'expired'
export type EditorIntentLabel = 'polish' | 'expand' | 'condense' | 'review' | 'continue' | 'custom'

export interface EditorSuggestionOverlay {
  decision?: EditorDecisionLabel
  intent?: EditorIntentLabel
}

const DECISION_LABEL: Record<EditorDecisionLabel, string> = {
  accepted: '已采纳', rejected: '已拒绝', reopened: '已撤销采纳', cancelled: '已取消', expired: '已过期',
}
const AUTHOR_SUCCESS = '已送到编辑器，由作者决定是否采用'
const DECISION_SUMMARY: Record<EditorDecisionLabel, string> = {
  accepted: '作者已采纳这条建议', rejected: '作者已拒绝这条建议', reopened: '作者已撤销采纳',
  cancelled: '作者已取消这条请求', expired: '这条请求已过期',
}
/** Author-facing lines for the four model-facing failure reasons. Anything else stays generic. */
const AUTHOR_FAILURE: Readonly<Record<string, string>> = {
  '未知请求编号；只有书房编辑器发来的请求才能用此工具回复。': '未知编号',
  '作者已取消此请求，停止处理，不要改写文件。': '作者已取消',
  '该请求已经回复过；作者需要新版本时会重新发起。': '已交回过',
  '此请求已结束且没有交回结果；作者需要新版本时会重新发起，不要改写文件。': '请求已结束未交回',
}
const AUTHOR_FAILURE_GENERIC = '这次没有交回编辑建议'
const INTENT_LABEL: Record<EditorIntentLabel, string> = {
  polish: '润色', expand: '扩写', condense: '精简', review: '审读', continue: '续写', custom: '按要求改',
}
const KIND_LABEL: Record<string, string> = { replace: '替换建议', insert: '续写', comments: '审读批注', none: '无需改动' }

function parsed(raw: string): Record<string, unknown> | undefined {
  if (!raw.trim()) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    return object(value) ? value : undefined
  } catch { return undefined }
}

export function editorRequestId(props: ToolCallPhaseProps): string | undefined {
  if (props.phase === 'preparing') return undefined
  const args = parsed(props.phase === 'start' ? props.block.argsRaw : props.block.call?.argsRaw ?? '')
  const fromArgs = text(args?.requestId)
  if (fromArgs) return fromArgs
  if (props.phase !== 'result') return undefined
  const raw = props.block.content.map(item => item.type === 'text' ? item.text : '').join('\n')
  return text(parsed(raw)?.requestId)
}

/** Frozen tool output, plus the author's decision only while this page still has it. A refresh passes no overlay. */
export function editorSuggestionModel(props: ToolCallPhaseProps, overlay?: EditorSuggestionOverlay): NovelResultModel {
  const base = { facts: [] as { label: string; value: string }[], raw: '', args: '' }
  const requestId = editorRequestId(props)
  const argsRaw = props.phase === 'preparing' ? '' : props.phase === 'start' ? props.block.argsRaw : props.block.call?.argsRaw ?? ''
  const args = parsed(argsRaw)
  const facts: { label: string; value: string }[] = []
  if (requestId) facts.push({ label: '编号', value: '#' + requestId })
  const kind = text(args?.kind)
  const kindLabel = kind ? KIND_LABEL[kind] : undefined
  if (kindLabel) facts.push({ label: '类型', value: kindLabel })
  const intentLabel = overlay?.intent ? INTENT_LABEL[overlay.intent] : undefined
  if (intentLabel) facts.push({ label: '意图', value: intentLabel })
  const note = text(args?.note)
  if (note) facts.push({ label: '说明', value: note })
  const decisionLabel = overlay?.decision ? DECISION_LABEL[overlay.decision] : undefined
  if (decisionLabel) facts.push({ label: '作者决定', value: decisionLabel })
  if (props.phase === 'preparing') return { ...base, state: 'preparing', label: '准备中', summary: '正在准备调用参数' }
  if (props.phase === 'start') return { ...base, facts, args: argsRaw, state: 'running', label: '进行中', summary: '等待把建议交回编辑器' }
  const block = props.block
  const raw = block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2)).join('\n')
  const result: NovelResultModel = { ...base, facts, raw, args: argsRaw, state: 'unknown', label: '待核对', summary: '结果格式无法识别，请查看原始详情' }
  if (isStoppedError(block.error)) return { ...result, state: 'stopped', label: '已中断', summary: '操作已中断；继续前请核对已产生的结果' }
  if (block.isError) return { ...result, state: 'error', label: '执行异常', summary: '请查看错误详情，核对已产生的结果后再决定是否重试' }
  if (block.content.length !== 1 || block.content[0]?.type !== 'text') return result
  const value = parsed(raw)
  if (!value || typeof value.ok !== 'boolean') return result
  if (!value.ok) {
    const reason = text(value.reason)
    return { ...result, state: 'error', label: '未完成', summary: (reason && AUTHOR_FAILURE[reason]) ?? AUTHOR_FAILURE_GENERIC }
  }
  return {
    ...result, state: 'success', label: '已交回',
    summary: (overlay?.decision && DECISION_SUMMARY[overlay.decision]) || AUTHOR_SUCCESS,
  }
}
