import {
  deriveDesign,
  diagnoseBookRuntime,
  listConfirmedEmpty,
  listResumable,
  renderStatusCard,
  scanDesign,
  scanDesignDetail,
  selectCurrentVolume,
} from '@webnovel/core'

/** Shared best-effort status projection, not evidence that maintenance checks passed. */
export function readStoryStatus(bookRoot: string) {
  const selection = selectCurrentVolume(bookRoot)
  const derived = deriveDesign(scanDesign(bookRoot, selection.kind === 'active' ? selection.卷 : selection.kind === 'planning' ? selection.规划卷 : 1))
  const 已确认无内容 = listConfirmedEmpty(scanDesignDetail(bookRoot))
  const design = 已确认无内容.length === 0 ? derived : { ...derived, 已确认无内容 }
  const chapters = listResumable(bookRoot).map((r) => ({
    key: r.key,
    建议: r.derived.建议,
    事实项: r.derived.事实项,
    叠加标记: r.derived.叠加标记,
    statusCard: renderStatusCard(bookRoot, r.key),
    ...(r.facts.审核记录哈希 === undefined ? {} : { 审核记录哈希: r.facts.审核记录哈希 }),
  }))
  const 书仓诊断 = diagnoseBookRuntime(bookRoot)
  return { design, chapters, ...(书仓诊断.length === 0 ? {} : { 书仓诊断 }) }
}
