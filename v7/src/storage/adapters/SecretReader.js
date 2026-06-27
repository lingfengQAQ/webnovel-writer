import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../parsers/front-matter.js'

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

  async listUnrevealed() {
    if (!this.cache) return []

    try {
      const rows = await this.cache.query(
        'SELECT * FROM secrets WHERE reader_knows = 0'
      )
      return rows
    } catch (err) {
      return []
    }
  }

  async _findSecretFile(id) {
    const secretDir = path.join(this.repoPath, '定稿', '设定', '信息差')
    try {
      const files = await fs.readdir(secretDir)
      const found = files.find((file) => file.startsWith(id))
      return found ? path.join(secretDir, found) : null
    } catch (err) {
      return null
    }
  }
}
