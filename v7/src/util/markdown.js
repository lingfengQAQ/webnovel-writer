/**
 * 从 Markdown 提取首个标题含 title 的 ## 小节正文（到下一个 ## 为止）。
 * @param {string} content Markdown 全文
 * @param {string} title 小节标题关键词
 * @returns {string} 去首尾空白的小节正文；未命中返回空串
 */
export function extractSection(content, title) {
  const lines = content.split('\n')
  let inSection = false
  const out = []
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (inSection) break
      if (line.includes(title)) {
        inSection = true
        continue
      }
    }
    if (inSection) out.push(line)
  }
  return out.join('\n').trim()
}
