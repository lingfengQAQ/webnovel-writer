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

/**
 * 在首个标题含 sectionTitle 的 ## 小节段尾追加一行（段不存在则在文末新建该段）。
 * @param {string} body Markdown 正文
 * @param {string} sectionTitle 小节标题关键词
 * @param {string} line 要追加的整行（如 "- 第152章：推进——..."）
 * @returns {string} 追加后的正文
 */
export function appendUnderSection(body, sectionTitle, line) {
  const lines = body.split('\n')
  let secIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ') && lines[i].includes(sectionTitle)) {
      secIdx = i
      break
    }
  }
  if (secIdx === -1) {
    const sep = body.endsWith('\n') ? '' : '\n'
    return `${body}${sep}\n## ${sectionTitle}\n${line}\n`
  }
  // 段落范围 = secIdx+1 .. 下一个 ## 或文末
  let endIdx = lines.length
  for (let i = secIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      endIdx = i
      break
    }
  }
  // 插到段内最后一个非空行之后
  let insertAt = endIdx
  while (insertAt > secIdx + 1 && lines[insertAt - 1].trim() === '') insertAt--
  lines.splice(insertAt, 0, line)
  return lines.join('\n')
}
