import path from 'node:path'

/**
 * 工作区相对路径归一（R4/C2/G-4/C4 单源）：剥「工作区/」前缀 + 按路径段拒绝 `..` 穿越。
 * 拒绝时返回 null——调用方跳过并告警，不得静默清到工作区外。
 * 段级检查而非子串检查：`笔记..草稿.md` 是合法文件名，不误拦。
 * @param {string} name 宿主给的工作区文件名（可能带「工作区/」前缀）
 * @returns {string|null}
 */
export function normalizeWorkspaceRel(name) {
  const stripped = String(name).replace(/^工作区[\\/]/, '').replace(/[\\/]+$/, '')
  if (!stripped) return null
  if (path.isAbsolute(stripped)) return null
  const segments = stripped.split(/[\\/]/).filter(Boolean)
  if (!segments.length || segments.some((s) => s === '..')) return null
  return segments.join(path.sep)
}
