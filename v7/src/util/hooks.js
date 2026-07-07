/**
 * 弱钩判据单源（E8）：front matter「钩子」字段形如「危机钩-强」「日常钩-弱」或含「弱钩」。
 * 判据变更只改这里——此前四处逐字复制，漏改一处即判据漂移。
 * @param {string|undefined} hook front matter 钩子字段原文
 * @returns {boolean}
 */
export function isWeakHook(hook) {
  const h = String(hook || '')
  return h.includes('弱钩') || h.endsWith('-弱')
}
