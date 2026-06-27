import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../parsers/front-matter.js'
import { parseMarkdownTable } from '../parsers/markdown-table.js'

/**
 * EntityReader：读取角色卡、解析别名。
 */
export class EntityReader {
  constructor(repoPath, cache = null) {
    this.repoPath = repoPath
    this.cache = cache
  }

  /**
   * 读取角色卡 front matter。
   * @param {string} name - 正名
   * @returns {Promise<{ok: boolean, data: object|null, error: string}>}
   */
  async readCharacterFrontMatter(name) {
    const filePath = path.join(this.repoPath, '定稿', '设定', '角色', `${name}.md`)

    try {
      const content = await fs.readFile(filePath, 'utf8')
      const parsed = parseFrontMatter(content)
      if (!parsed.ok) {
        return { ok: false, data: null, error: `解析失败：${parsed.error}` }
      }
      return { ok: true, data: parsed.data, error: '' }
    } catch (err) {
      return { ok: false, data: null, error: `角色 ${name} 不存在` }
    }
  }

  /**
   * 读取角色卡完整内容（front matter + 正文）。
   * @param {string} name
   * @returns {Promise<{ok: boolean, frontMatter: object|null, body: string, error: string}>}
   */
  async readCharacterFull(name) {
    const filePath = path.join(this.repoPath, '定稿', '设定', '角色', `${name}.md`)

    try {
      const content = await fs.readFile(filePath, 'utf8')
      const parsed = parseFrontMatter(content)
      if (!parsed.ok) {
        return { ok: false, frontMatter: null, body: '', error: `解析失败：${parsed.error}` }
      }
      return { ok: true, frontMatter: parsed.data, body: parsed.body, error: '' }
    } catch (err) {
      return { ok: false, frontMatter: null, body: '', error: `角色 ${name} 不存在` }
    }
  }

  /**
   * 解析别名，返回正名。
   * @param {string} alias - 别名
   * @returns {Promise<{ok: boolean, canonicalName: string|null, error: string}>}
   */
  async resolveAlias(alias) {
    // 优先查缓存 entity_aliases 表
    if (this.cache) {
      try {
        const rows = await this.cache.query(
          'SELECT entity_id FROM entity_aliases WHERE alias = ?',
          [alias]
        )
        if (rows.length > 0) {
          return { ok: true, canonicalName: rows[0].entity_id, error: '' }
        }
      } catch (err) {
        // 降级到文件读取
      }
    }

    // 降级：解析名册文件
    const rosterPath = path.join(this.repoPath, '定稿', '设定', '名册.md')
    try {
      const content = await fs.readFile(rosterPath, 'utf8')
      const table = parseMarkdownTable(content)
      if (!table.ok) {
        return { ok: false, canonicalName: null, error: '名册解析失败' }
      }

      // 查找别名
      for (const row of table.rows) {
        const aliases = row.别名.split(',').map((a) => a.trim())
        if (aliases.includes(alias)) {
          return { ok: true, canonicalName: row.正名, error: '' }
        }
      }

      return { ok: false, canonicalName: null, error: `未找到别名「${alias}」` }
    } catch (err) {
      return { ok: false, canonicalName: null, error: err.message }
    }
  }

  /**
   * 列出所有角色（按筛选条件）。
   * @param {object} filter - 筛选条件（如 { status: "在世" }）
   * @returns {Promise<object[]>}
   */
  async listCharacters(filter = {}) {
    if (this.cache) {
      try {
        let query = "SELECT * FROM entities WHERE type = 'character'"
        const params = []

        if (filter.status) {
          query += ' AND status = ?'
          params.push(filter.status)
        }

        const rows = await this.cache.query(query, params)
        return rows
      } catch (err) {
        return []
      }
    }

    // 降级：扫描角色目录
    const charDir = path.join(this.repoPath, '定稿', '设定', '角色')
    try {
      const files = await fs.readdir(charDir)
      const characters = []

      for (const file of files) {
        if (!file.endsWith('.md')) continue
        const name = file.replace('.md', '')
        const result = await this.readCharacterFrontMatter(name)
        if (result.ok) {
          if (!filter.status || result.data.状态 === filter.status) {
            characters.push({ 正名: name, ...result.data })
          }
        }
      }

      return characters
    } catch (err) {
      return []
    }
  }
}
