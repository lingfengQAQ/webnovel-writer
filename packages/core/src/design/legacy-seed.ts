import { parseDocument } from '../repo/frontmatter'

/** Recognize the entire old seed body, never infer provenance from an event name. */
export function isLegacySeedPlan(text: string): boolean {
  const original = '# 计划时间线\n\n## 窗口覆盖\n\n- 开篇任务（先后:最先）\n\n## 窗口外锚点\n\n- 卷末锚点'
  const parsed = parseDocument(text)
  return parsed.ok && parsed.data.body.trim() === original
}
