/**
 * 解析 Markdown 表格。
 * @param {string} content - Markdown 表格文本（含表头 | A | B | C |）
 * @returns {{ok: boolean, headers: string[], rows: object[], error: string}}
 */
export function parseMarkdownTable(content) {
  if (typeof content !== 'string') {
    return {
      ok: false,
      headers: [],
      rows: [],
      error: '内容必须是字符串',
    }
  }

  const lines = content.split('\n').map((line) => line.trim()).filter((line) => line !== '')

  if (lines.length < 2) {
    return {
      ok: false,
      headers: [],
      rows: [],
      error: 'Markdown 表格至少需要两行（表头 + 分隔符）',
    }
  }

  // 解析表头（第一行）
  const headerLine = lines[0]
  if (!headerLine.startsWith('|') || !headerLine.endsWith('|')) {
    return {
      ok: false,
      headers: [],
      rows: [],
      error: '表头行必须以 | 开头和结尾',
    }
  }

  const headers = headerLine
    .slice(1, -1)
    .split('|')
    .map((h) => h.trim())

  // 跳过分隔符行（第二行，GFM：每格仅 - 与 :，至少一横；支持 |---| 与 |-| 与对齐 |:--:|--:|）
  const separatorLine = lines[1]
  if (!isDelimiterRow(separatorLine, headers.length)) {
    return {
      ok: false,
      headers: [],
      rows: [],
      error: '表格第二行必须是分隔符行（|---|---|）',
    }
  }

  // 解析数据行（从第三行开始）
  const rows = []
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i]

    // 跳过空行
    if (line === '') continue

    // 跳过不是表格行的内容
    if (!line.startsWith('|') || !line.endsWith('|')) {
      continue
    }

    const cells = line
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim())

    // 容错：单元格数量不匹配表头时跳过（或补空）
    if (cells.length !== headers.length) {
      // 补齐或截断
      while (cells.length < headers.length) {
        cells.push('')
      }
      cells.splice(headers.length)
    }

    const row = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j]
    }
    rows.push(row)
  }

  return {
    ok: true,
    headers: headers,
    rows: rows,
    error: '',
  }
}

/**
 * GFM 分隔符行判定：以 | 围栏,格数与表头一致,每格仅 - 与 : 且至少一横。
 * 接受 |---|、|-|、|:--:|、|--:|、|:--| 等所有合法形态。
 */
function isDelimiterRow(line, expectedCount) {
  if (typeof line !== 'string' || !line.startsWith('|') || !line.endsWith('|')) return false
  const cells = line.slice(1, -1).split('|').map((c) => c.trim())
  if (cells.length !== expectedCount) return false
  return cells.every((c) => /^:?-+:?$/.test(c))
}
