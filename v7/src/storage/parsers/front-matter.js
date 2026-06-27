import { parseYAML } from './yaml-safe.js'

/**
 * 解析 Markdown 文件的 front matter（--- 包裹的 YAML）与正文。
 * @param {string} content - 完整文件内容
 * @returns {{ok: boolean, data: object|null, body: string, error: string, rawYAML: string}}
 */
export function parseFrontMatter(content) {
  if (typeof content !== 'string') {
    return {
      ok: false,
      data: null,
      body: '',
      error: '内容必须是字符串',
      rawYAML: '',
    }
  }

  // 查找 front matter 分隔符（开头的 ---）
  const lines = content.split('\n')

  // 必须以 --- 开头（允许前面有空行）
  let startIndex = -1
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed === '---') {
      startIndex = i
      break
    }
    if (trimmed !== '') {
      // 遇到非空非 --- 行，说明没有 front matter
      return {
        ok: false,
        data: null,
        body: content,
        error: '缺少 front matter 分隔符（文件必须以 --- 开头）',
        rawYAML: '',
      }
    }
  }

  if (startIndex === -1) {
    return {
      ok: false,
      data: null,
      body: content,
      error: '缺少 front matter 分隔符',
      rawYAML: '',
    }
  }

  // 查找结束的 ---
  let endIndex = -1
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIndex = i
      break
    }
  }

  if (endIndex === -1) {
    return {
      ok: false,
      data: null,
      body: content,
      error: 'front matter 分隔符不配对（缺少结束的 ---）',
      rawYAML: '',
    }
  }

  // 提取 YAML 部分与正文部分
  const yamlLines = lines.slice(startIndex + 1, endIndex)
  const rawYAML = yamlLines.join('\n')
  const bodyLines = lines.slice(endIndex + 1)
  const body = bodyLines.join('\n').trim()

  // 解析 YAML
  const yamlResult = parseYAML(rawYAML)
  if (!yamlResult.ok) {
    return {
      ok: false,
      data: null,
      body: body,
      error: `YAML 解析失败：${yamlResult.error}`,
      rawYAML: rawYAML,
    }
  }

  return {
    ok: true,
    data: yamlResult.data,
    body: body,
    error: '',
    rawYAML: rawYAML,
  }
}
