import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../parsers/front-matter.js'
import { serializeFrontMatter } from '../serializers/front-matter.js'
import { appendUnderSection } from '../../util/markdown.js'
import { THREAD_TYPES } from '../../util/thread-declarations.js'
import { sanitizeFileName } from '../../util/filename.js'

/**
 * ThreadLedgerWriter：新开条目、更新三类条目 front matter、追加履历（定稿流程调用）。
 */
export class ThreadLedgerWriter {
  constructor(repoPath, cache = null) {
    this.repoPath = repoPath
    this.cache = cache
  }

  /**
   * 新开条目（开启类声明的入档执行体，spec §5/§8 第 8 步"条目文件由定稿创建"）。
   * @param {{id: string, frontMatter?: object, body?: string, 短题?: string}} spec
   * @returns {Promise<{ok: boolean, filePath: string, error: string}>}
   */
  async createThread({ id, frontMatter = {}, body = '', 短题 = '' } = {}) {
    const idStr = String(id || '')
    const type = idStr.split('-')[0]
    if (!THREAD_TYPES.includes(type) || !/^\S+-\d+$/.test(idStr)) {
      return {
        ok: false,
        filePath: '',
        error: `新条目编号「${idStr || '（空）'}」不合法，应为 伏笔-NNN / 悬念-NNN / 感情线-NNN`,
      }
    }
    try {
      const dir = path.join(this.repoPath, '大纲', type)
      let existing = []
      try {
        existing = await fs.readdir(dir)
      } catch {
        // 目录不存在，首个条目
      }
      if (existing.some((f) => f === `${idStr}.md` || f.startsWith(`${idStr}-`))) {
        return { ok: false, filePath: '', error: `条目 ${idStr} 已存在，开新条目须用新编号` }
      }
      await fs.mkdir(dir, { recursive: true })
      const fileName = 短题 ? `${idStr}-${sanitizeFileName(短题)}.md` : `${idStr}.md`
      const filePath = path.join(dir, fileName)
      await fs.writeFile(filePath, serializeFrontMatter(frontMatter, body), 'utf8')
      return { ok: true, filePath, error: '' }
    } catch (err) {
      return { ok: false, filePath: '', error: `新开条目 ${idStr} 失败：${err.message}` }
    }
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
      // 有界匹配（A9）：与 createThread 查重同口径，伏笔-1 不得改到 伏笔-10 的文件
      const found = files.find((f) => f === `${threadId}.md` || f.startsWith(`${threadId}-`))
      return found ? path.join(dir, found) : null
    } catch {
      return null
    }
  }
}
