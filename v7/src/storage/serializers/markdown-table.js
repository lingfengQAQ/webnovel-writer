/**
 * 序列化 Markdown 表格（与 parsers/markdown-table.js 配对，转义读写对称）。
 * 单元格内 `|` 转义为 `\|`（R11：别名「刀疤|老王」不再被切丢后半）、`\` 转义为 `\\`、
 * 换行替换为空格（表格单元格不容纳换行）。
 * 行对象里表头之外的额外列（作者手加的列）按首次出现序追加在尾部，全表重写不丢列（A11）。
 * @param {string[]} headers 表头
 * @param {object[]} rows 行对象数组（按 header 取值，缺失补空）
 * @returns {string} Markdown 表格文本（含尾换行）
 */
export function serializeMarkdownTable(headers, rows) {
  const allHeaders = [...headers]
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!allHeaders.includes(k)) allHeaders.push(k)
    }
  }
  const cell = (v) =>
    String(v ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .replace(/\r?\n/g, ' ')
  const head = `| ${allHeaders.map(cell).join(' | ')} |`
  const sep = `| ${allHeaders.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${allHeaders.map((h) => cell(r[h])).join(' | ')} |`)
  return [head, sep, ...body].join('\n') + '\n'
}
