import { serializeYAML } from './yaml-dialect.js'

/**
 * 组装 front matter + 正文为完整 Markdown 文件。
 * 未知字段的保留由读侧达成：parseFrontMatter 把全部键放进 data，
 * 更新方以 `{...parsed.data, ...updates}` 展开即不丢字段（§4.5）。
 * @param {object} data - 全量字段对象
 * @param {string} body - Markdown 正文
 * @returns {string} 完整 Markdown 文件内容
 */
export function serializeFrontMatter(data, body) {
  return `---\n${serializeYAML(data)}\n---\n${body}`
}
