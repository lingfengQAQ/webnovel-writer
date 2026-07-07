import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../parsers/front-matter.js'

function parseJSONArray(text) {
  try {
    const v = JSON.parse(text || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/**
 * SecretReader：读取信息差。
 */
export class SecretReader {
  constructor(repoPath, cache = null) {
    this.repoPath = repoPath
    this.cache = cache
  }

  async readBasicInfo(id) {
    const filePath = await this._findSecretFile(id)
    if (!filePath) {
      return { ok: false, data: null, error: `信息差 ${id} 不存在` }
    }

    try {
      const content = await fs.readFile(filePath, 'utf8')
      const parsed = parseFrontMatter(content)
      if (!parsed.ok) {
        return { ok: false, data: null, error: `解析失败：${parsed.error}` }
      }
      return { ok: true, data: parsed.data, error: '' }
    } catch (err) {
      return { ok: false, data: null, error: err.message }
    }
  }

  async readContent(id) {
    const filePath = await this._findSecretFile(id)
    if (!filePath) {
      return { ok: false, content: '', error: `信息差 ${id} 不存在` }
    }

    try {
      const content = await fs.readFile(filePath, 'utf8')
      const parsed = parseFrontMatter(content)
      if (!parsed.ok) {
        return { ok: false, content: '', error: `解析失败：${parsed.error}` }
      }

      // 提取 "## 内容" 段落
      const lines = parsed.body.split('\n')
      let inContent = false
      const contentLines = []

      for (const line of lines) {
        if (line.startsWith('## ')) {
          if (inContent) break
          if (line.includes('内容')) {
            inContent = true
            continue
          }
        }
        if (inContent) contentLines.push(line)
      }

      return { ok: true, content: contentLines.join('\n').trim(), error: '' }
    } catch (err) {
      return { ok: false, content: '', error: err.message }
    }
  }

  /**
   * 列出未揭晓信息差（缓存直出，供备料"信息差边界"与两审"信息差候选"）。
   * @returns {Promise<Array<{id: string, 短题: string, 知情人: string[], 关键词: string[], 登记章: number}>>}
   */
  async listUnrevealed() {
    if (!this.cache) return []

    try {
      const rows = await this.cache.query(
        'SELECT id, short_title, known_to, keywords, registered_chapter FROM secrets WHERE reader_knows = 0'
      )
      return rows.map((r) => ({
        id: r.id,
        短题: r.short_title || r.id,
        知情人: parseJSONArray(r.known_to),
        关键词: parseJSONArray(r.keywords),
        登记章: r.registered_chapter,
      }))
    } catch (err) {
      return []
    }
  }

  /**
   * 读「## 内容」段首行（精准片段，备料注入用）。
   * @param {string} id
   * @returns {Promise<{ok: boolean, line: string, error: string}>}
   */
  async readContentFirstLine(id) {
    const r = await this.readContent(id)
    if (!r.ok) return { ok: false, line: '', error: r.error }
    const line = r.content.split('\n').map((s) => s.trim()).find(Boolean) || ''
    return { ok: true, line, error: '' }
  }

  async _findSecretFile(id) {
    const secretDir = path.join(this.repoPath, '定稿', '设定', '信息差')
    try {
      const files = await fs.readdir(secretDir)
      // 有界匹配（C3）：信息差-1 不得命中 信息差-10-*.md
      const found = files.find((file) => file === `${id}.md` || file.startsWith(`${id}-`))
      return found ? path.join(secretDir, found) : null
    } catch (err) {
      return null
    }
  }
}
