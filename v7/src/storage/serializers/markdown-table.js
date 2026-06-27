/**
 * 序列化 Markdown 表格（与 parsers/markdown-table.js 配对）。
 * @param {string[]} headers 表头
 * @param {object[]} rows 行对象数组（按 header 取值，缺失补空）
 * @returns {string} Markdown 表格文本（含尾换行）
 */
export function serializeMarkdownTable(headers, rows) {
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${headers.map((h) => String(r[h] ?? '')).join(' | ')} |`)
  return [head, sep, ...body].join('\n') + '\n'
}
