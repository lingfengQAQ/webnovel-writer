/**
 * 解析 Markdown 表格。
 * - 识别 GFM `\|` 转义与 `\\`（与 serializer 对称，R11/A8）
 * - 整行全角管道 `｜` 归一为 `|`（作者用中文输入法打整表的场景，A7）
 * - 行格数多于表头时截断并记 warning，不再静默（A8）
 * @param {string} content - Markdown 表格文本（含表头 | A | B | C |）
 * @returns {{ok: boolean, headers: string[], rows: object[], warnings: string[], error: string}}
 */
export function parseMarkdownTable(content) {
  if (typeof content !== 'string') {
    return {
      ok: false,
      headers: [],
      rows: [],
      warnings: [],
      error: '内容必须是字符串',
    }
  }

  const lines = content
    .split('\n')
    .map((line) => normalizeFullWidthPipes(line.trim()))
    .filter((line) => line !== '')

  if (lines.length < 2) {
    return {
      ok: false,
      headers: [],
      rows: [],
      warnings: [],
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
      warnings: [],
      error: '表头行必须以 | 开头和结尾',
    }
  }

  const headers = splitCells(headerLine)

  // 跳过分隔符行（第二行，GFM：每格仅 - 与 :，至少一横；支持 |---| 与 |-| 与对齐 |:--:|--:|）
  const separatorLine = lines[1]
  if (!isDelimiterRow(separatorLine, headers.length)) {
    return {
      ok: false,
      headers: [],
      rows: [],
      warnings: [],
      error: '表格第二行必须是分隔符行（|---|---|）',
    }
  }

  // 解析数据行（从第三行开始）
  const warnings = []
  const rows = []
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i]

    // 跳过不是表格行的内容
    if (!line.startsWith('|') || !line.endsWith('|')) {
      continue
    }

    const cells = splitCells(line)

    // 容错：格数少补空；多于表头则截断并告警（内容会丢，作者该修表）
    if (cells.length > headers.length) {
      warnings.push(`第 ${i + 1} 行有 ${cells.length} 格，多于表头 ${headers.length} 格，多余内容已忽略：${line}`)
      cells.splice(headers.length)
    }
    while (cells.length < headers.length) {
      cells.push('')
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
    warnings,
    error: '',
  }
}

/**
 * 切一行的单元格：先把 `\\` 与 `\|` 换成占位符再按 `|` 切，切完还原——
 * 与 serializeMarkdownTable 的转义严格对称。
 */
function splitCells(line) {
  const ESC_BACKSLASH = '\x00'
  const ESC_PIPE = '\x01'
  return line
    .slice(1, -1)
    .replace(/\\\\/g, ESC_BACKSLASH)
    .replace(/\\\|/g, ESC_PIPE)
    .split('|')
    .map((c) => c.trim().replaceAll(ESC_PIPE, '|').replaceAll(ESC_BACKSLASH, '\\'))
}

/** 整行以全角 ｜ 起围栏时归一为半角（只救整表全角，不动半角行内的全角字符）。 */
function normalizeFullWidthPipes(line) {
  if (!line.startsWith('｜')) return line
  return line.replaceAll('｜', '|')
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
