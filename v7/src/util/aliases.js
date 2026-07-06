/**
 * 别名分隔单源（R6/A5）：中文作者惯用全角逗号/顿号，三处解析点必须同刀。
 * undefined/缺列容错（A13：名册缺「别名」列不得炸整次重建）。
 * @param {string|string[]|undefined} v 名册单元格原文或数组
 * @returns {string[]}
 */
export function splitAliases(v) {
  if (Array.isArray(v)) return v.filter(Boolean).map((s) => String(s).trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
  return []
}
