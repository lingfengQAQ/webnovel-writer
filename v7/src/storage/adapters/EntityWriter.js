import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../parsers/front-matter.js'
import { serializeFrontMatter } from '../serializers/front-matter.js'
import { parseMarkdownTable } from '../parsers/markdown-table.js'
import { serializeMarkdownTable } from '../serializers/markdown-table.js'

const ROSTER_HEADERS = ['正名', '别名', '类型', '首现章']

/**
 * EntityWriter：更新角色卡 front matter、upsert 名册行（M2 定稿流程调用）。
 */
export class EntityWriter {
  constructor(repoPath, cache = null) {
    this.repoPath = repoPath
    this.cache = cache
  }

  /**
   * 更新角色卡 front matter（合并 updates，保留正文）。
   * @param {string} name 正名
   * @param {object} updates 位置/状态/境界/持有/最后变更章 等
   * @returns {Promise<{ok: boolean, error: string}>}
   */
  async updateCharacter(name, updates) {
    const filePath = path.join(this.repoPath, '定稿', '设定', '角色', `${name}.md`)
    try {
      const parsed = parseFrontMatter(await fs.readFile(filePath, 'utf8'))
      if (!parsed.ok) return { ok: false, error: `角色 ${name} 解析失败：${parsed.error}` }
      const merged = { ...parsed.data, ...updates }
      await fs.writeFile(filePath, serializeFrontMatter(merged, parsed.body), 'utf8')
      return { ok: true, error: '' }
    } catch (err) {
      return { ok: false, error: `角色 ${name} 不存在或写入失败：${err.message}` }
    }
  }

  /**
   * upsert 名册行（按正名查重；不存在则追加，存在则替换）。
   * @param {object} row { 正名, 别名, 类型, 首现章 }
   * @returns {Promise<{ok: boolean, error: string}>}
   */
  async upsertRosterRow(row) {
    try {
      const filePath = path.join(this.repoPath, '定稿', '设定', '名册.md')
      let headers = ROSTER_HEADERS
      let rows = []
      try {
        const parsed = parseMarkdownTable(await fs.readFile(filePath, 'utf8'))
        if (parsed.ok && parsed.headers.length) {
          headers = parsed.headers
          rows = parsed.rows
        }
      } catch {
        // 文件不存在，用默认表头
      }

      const idx = rows.findIndex((r) => r.正名 === row.正名)
      if (idx >= 0) rows[idx] = row
      else rows.push(row)

      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, serializeMarkdownTable(headers, rows), 'utf8')
      return { ok: true, error: '' }
    } catch (err) {
      return { ok: false, error: `upsert 名册行失败：${err.message}` }
    }
  }
}
