import { serializeYAML } from './yaml-dialect.js'

/**
 * 组装 front matter + 正文为完整 Markdown 文件。
 * 保留未知字段：从 originalYAML 提取非 data 中的字段，拼接到输出。
 * @param {object} data - 已知字段对象
 * @param {string} body - Markdown 正文
 * @param {string} originalYAML - 原始 YAML 字符串（可选，用于保留未知字段）
 * @returns {string} 完整 Markdown 文件内容
 */
export function serializeFrontMatter(data, body, originalYAML = '') {
  let yamlContent = serializeYAML(data)

  // 如果有原始 YAML，尝试保留未知字段
  if (originalYAML) {
    const unknownFields = extractUnknownFields(originalYAML, data)
    if (unknownFields.length > 0) {
      yamlContent += '\n' + unknownFields.join('\n')
    }
  }

  return `---\n${yamlContent}\n---\n${body}`
}

/**
 * 从原始 YAML 中提取未知字段（不在 data 中的字段）。
 * @param {string} originalYAML
 * @param {object} data - 已知字段
 * @returns {string[]} 未知字段行数组
 */
function extractUnknownFields(originalYAML, data) {
  const knownKeys = new Set(Object.keys(data))
  const unknownLines = []

  const lines = originalYAML.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // 跳过空行和注释
    if (trimmed === '' || trimmed.startsWith('#')) {
      i++
      continue
    }

    // 解析键（支持 "key:" 和 "key: value" 两种形式）
    const match = trimmed.match(/^([^:]+):/)
    if (match) {
      const key = match[1].trim()
      if (!knownKeys.has(key)) {
        // 未知字段，保留整行
        unknownLines.push(line)

        // 如果是列表字段，保留后续的列表项
        i++
        while (i < lines.length && lines[i].trim().startsWith('-')) {
          unknownLines.push(lines[i])
          i++
        }
        continue
      }
    }

    i++
  }

  return unknownLines
}
