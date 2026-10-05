export interface AnnouncedSave {
  readonly commit: 'saved' | 'not-required' | 'failed'
  readonly notification: 'delivered' | 'failed' | 'not-required'
}

export interface SaveToastSource {
  readonly operationId: string
  readonly changed: boolean
  readonly previousPath: string
  readonly path: string
  readonly commit: AnnouncedSave['commit']
  readonly notification: AnnouncedSave['notification']
}

/** 按与已提示状态的差异生成文案，并返回更新后的记录。无差异时沿用原来的 Map。 */
export function nextSaveToast(
  saved: SaveToastSource | undefined,
  announced: ReadonlyMap<string, AnnouncedSave>,
): { readonly text?: string; readonly announced: ReadonlyMap<string, AnnouncedSave> } {
  if (!saved) return { announced }
  const before = announced.get(saved.operationId)
  if (before && before.commit === saved.commit && before.notification === saved.notification) return { announced }
  const parts: string[] = []
  if (!before) {
    parts.push(saved.changed ? (saved.previousPath !== saved.path ? '文件已保存 · 已生成新稿' : '文件已保存') : '文档没有变化')
  }
  if (saved.commit === 'saved' && before?.commit !== 'saved') parts.push('版本已提交')
  if (saved.notification === 'delivered' && before?.notification !== 'delivered') parts.push('已交给主控，处理结果见对话')
  const next = new Map(announced)
  next.set(saved.operationId, { commit: saved.commit, notification: saved.notification })
  return parts.length ? { text: parts.join(' · '), announced: next } : { announced: next }
}
