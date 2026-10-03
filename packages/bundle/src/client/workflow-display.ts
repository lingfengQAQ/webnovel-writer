import { runLabels, type RunState, type WorkflowCall, type WorkflowView } from '../study/workflow-types'

/** Display groups follow the approved Archify artwork; they never authorize or schedule work. */
export const workflowNodes = [
  { id: 'concept', label: '构思立项', note: '探索构想，作者确认后建书并选定当前作品。' },
  { id: 'design', label: '作品定调', note: '契约、世界书、骨架、分卷和卷纲经作者确认；远期允许留白。' },
  { id: 'outline', label: '章细纲', note: '从近期窗口定位本章，呈报并确认细纲。' },
  { id: 'materials', label: '写作备料', note: '读取真源与材料，核对缺口；本章已委托时继续写作。' },
  { id: 'draft', label: '起草 · 润色', note: 'AI 初稿先保真润色；作者待审稿直接审读，按要求才润色。' },
  { id: 'review', label: '全面审读', note: '审读结果须适用当前稿，回写齐全且发现项有效处置后才能通过。' },
  { id: 'revision', label: '修改正文', note: '按已授权处置落实新稿；正文或依据变化后重审，上游变化另走提案。' },
  { id: 'package', label: '备包 · 呈报', note: '核对七件候选、正文证据与卷对账，完整呈报后再请作者裁决。' },
  { id: 'approval', label: '作者裁决', note: '只有实际待答才标待确认。作者可批准入档、退回正文或调整沉淀候选。' },
  { id: 'settled', label: '定稿入档', note: '显示定稿工具的执行与结果；成功调用不独自证明整章完成。' },
  { id: 'wait', label: '本章完成', note: '完成事实来自书仓定稿记录。本章入档后停止，跨章需要新的委托。' },
  { id: 'export', label: '导出合集', note: '确认范围与新目录后导出本地 Markdown 与来源清单。通用写盘不推测为导出执行。' },
  { id: 'volume', label: '卷末收束', note: '核对定稿、遗留事项和卷摘要，经确认后再委托下卷规划。' },
] as const
export type WorkflowNodeId = typeof workflowNodes[number]['id']
export interface NodeActivity { id: WorkflowNodeId; state?: RunState; label?: string; activeCount: number }
export const inFlight = (call: WorkflowCall) => call.ended === undefined && ['running', 'preparing', 'waiting'].includes(call.state)

export function workflowNodeForCall(call: WorkflowCall): WorkflowNodeId | undefined {
  if (call.stage === 'confirm') return call.state === 'waiting' ? 'approval' : 'settled'
  const mapping: Partial<Record<NonNullable<WorkflowCall['stage']>, WorkflowNodeId>> = {
    idea: 'concept', design: 'design', skeleton: 'design', volumes: 'design', volume: 'design',
    outline: 'outline', materials: 'materials', draft: 'draft', polish: 'draft',
    review: 'review', revise: 'revision', settle: 'package', 'volume-close': 'volume',
  }
  return call.stage ? mapping[call.stage] : undefined
}
export function callsForNode(calls: readonly WorkflowCall[], id: WorkflowNodeId) {
  // The approval inspector retains the related call after the actual wait ends.
  return calls.filter(c => id === 'approval' ? c.stage === 'confirm' : workflowNodeForCall(c) === id)
}
export function workflowDisplay(value: WorkflowView | undefined, chapter: number, disconnected = false) {
  const live = Boolean(value?.available && value.active && !value.syncing && !disconnected)
  const calls = (value?.calls ?? []).filter(c => !chapter || c.chapter === chapter).map(c =>
    !live && inFlight(c) ? { ...c, state: 'unknown' as const, summary: '执行状态待核对。' } : c)
  const latest = (items: readonly WorkflowCall[]) => items.reduce<WorkflowCall | undefined>((a, b) => !a || b.started >= a.started ? b : a, undefined)
  const current = live ? latest(calls.filter(inFlight)) : undefined
  const nodes: NodeActivity[] = workflowNodes.map(node => {
    const matching = calls.filter(c => workflowNodeForCall(c) === node.id)
    const active = matching.filter(inFlight)
    const waiting = active.filter(c => c.state === 'waiting')
    const recent = latest(waiting.length ? waiting : active.length ? active : matching)
    return { id: node.id, state: recent?.state, label: recent ? (active.length > 1 ? active.length + ' 项 · ' : '') + runLabels[recent.state] : undefined, activeCount: active.length }
  })
  return { calls, current, currentNode: current && workflowNodeForCall(current), nodes }
}
