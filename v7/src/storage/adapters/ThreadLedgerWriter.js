import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../parsers/front-matter.js'
import { serializeFrontMatter } from '../serializers/front-matter.js'
import { appendUnderSection } from '../../util/markdown.js'

/**
 * ThreadLedgerWriter：更新三类条目 front matter、追加履历（M2 定稿流程调用）。
 */
export class ThreadLedgerWriter {
  constructor(repoPath, cache = null) {
    this.repoPath = repoPath
    this.cache = cache
  }

  /**
   * 更新条目 front matter（合并 updates，保留正文与未在 updates 中的字段）。
   * @param {string} threadId 如 "伏笔-001"
   * @param {object} updates 要改的 front matter 字段
   * @returns {Promise<{ok: boolean, error: string}>}
   */
  async updateThread(threadId, updates) {
    const filePath = await this._findThreadFile(threadId)
    if (!filePath) return { ok: false, error: `条目 ${threadId} 不存在` }
    try {
      const parsed = parseFrontMatter(await fs.readFile(filePath, 'utf8'))
      if (!parsed.ok) return { ok: false, error: `条目 ${threadId} 解析失败：${parsed.error}` }
      const merged = { ...parsed.data, ...updates }
      await fs.writeFile(filePath, serializeFrontMatter(merged, parsed.body), 'utf8')
      return { ok: true, error: '' }
    } catch (err) {
      return { ok: false, error: `更新条目 ${threadId} 失败：${err.message}` }
    }
  }

  /**
   * 在条目 `## 履历` 段尾追加一行。
   * @param {string} threadId
   * @param {string} entryLine 履历正文（不含前导 "- "）
   * @returns {Promise<{ok: boolean, error: string}>}
   */
  async appendHistory(threadId, entryLine) {
    const filePath = await this._findThreadFile(threadId)
    if (!filePath) return { ok: false, error: `条目 ${threadId} 不存在` }
    try {
      const parsed = parseFrontMatter(await fs.readFile(filePath, 'utf8'))
      if (!parsed.ok) return { ok: false, error: `条目 ${threadId} 解析失败：${parsed.error}` }
      const newBody = appendUnderSection(parsed.body, '履历', `- ${entryLine}`)
      await fs.writeFile(filePath, serializeFrontMatter(parsed.data, newBody), 'utf8')
      return { ok: true, error: '' }
    } catch (err) {
      return { ok: false, error: `追加履历 ${threadId} 失败：${err.message}` }
    }
  }

  async _findThreadFile(threadId) {
    const type = threadId.split('-')[0]
    const dir = path.join(this.repoPath, '大纲', type)
    try {
      const files = await fs.readdir(dir)
      const found = files.find((f) => f.startsWith(threadId))
      return found ? path.join(dir, found) : null
    } catch {
      return null
    }
  }
}
