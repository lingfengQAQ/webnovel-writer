import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../parsers/front-matter.js'

/**
 * ThreadLedgerReader：读取三类条目（伏笔/悬念/感情线）。
 */
export class ThreadLedgerReader {
  constructor(repoPath, cache = null) {
    this.repoPath = repoPath
    this.cache = cache
  }

  /**
   * 读取条目基本信息。
   * @param {string} threadId - 条目 ID（如 "伏笔-001"）
   * @returns {Promise<{ok: boolean, data: object|null, error: string}>}
   */
  async readBasicInfo(threadId) {
    // 优先查缓存
    if (this.cache) {
      try {
        const rows = await this.cache.query(
          'SELECT * FROM threads WHERE id = ?',
          [threadId]
        )
        if (rows.length > 0) {
          return { ok: true, data: rows[0], error: '' }
        }
      } catch (err) {
        // 降级到文件读取
      }
    }

    // 降级：读文件
    const filePath = await this._findThreadFile(threadId)
    if (!filePath) {
      return { ok: false, data: null, error: `条目 ${threadId} 不存在` }
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

  /**
   * 读取条目履历。
   * @param {string} threadId
   * @returns {Promise<{ok: boolean, history: object[], error: string}>}
   */
  async readHistory(threadId) {
    const filePath = await this._findThreadFile(threadId)
    if (!filePath) {
      return { ok: false, history: [], error: `条目 ${threadId} 不存在` }
    }

    try {
      const content = await fs.readFile(filePath, 'utf8')
      const parsed = parseFrontMatter(content)
      if (!parsed.ok) {
        return { ok: false, history: [], error: `解析失败：${parsed.error}` }
      }

      // 从正文提取 "## 履历" 段落
      const historySection = this._extractSection(parsed.body, '履历')
      if (!historySection) {
        return { ok: true, history: [], error: '' }
      }

      // 解析履历行（- 第N章：动作——描述（见...））
      const history = this._parseHistoryLines(historySection)
      return { ok: true, history, error: '' }
    } catch (err) {
      return { ok: false, history: [], error: err.message }
    }
  }

  /**
   * 读取条目收尾计划。
   * @param {string} threadId
   * @returns {Promise<{ok: boolean, plan: string, error: string}>}
   */
  async readClosurePlan(threadId) {
    const filePath = await this._findThreadFile(threadId)
    if (!filePath) {
      return { ok: false, plan: '', error: `条目 ${threadId} 不存在` }
    }

    try {
      const content = await fs.readFile(filePath, 'utf8')
      const parsed = parseFrontMatter(content)
      if (!parsed.ok) {
        return { ok: false, plan: '', error: `解析失败：${parsed.error}` }
      }

      const plan = this._extractSection(parsed.body, '收尾计划')
      return { ok: true, plan: plan || '', error: '' }
    } catch (err) {
      return { ok: false, plan: '', error: err.message }
    }
  }

  /**
   * 读取条目描述。
   * @param {string} threadId
   * @returns {Promise<{ok: boolean, description: string, error: string}>}
   */
  async readDescription(threadId) {
    const filePath = await this._findThreadFile(threadId)
    if (!filePath) {
      return { ok: false, description: '', error: `条目 ${threadId} 不存在` }
    }

    try {
      const content = await fs.readFile(filePath, 'utf8')
      const parsed = parseFrontMatter(content)
      if (!parsed.ok) {
        return { ok: false, description: '', error: `解析失败：${parsed.error}` }
      }

      const description = this._extractSection(parsed.body, '描述')
      return { ok: true, description: description || '', error: '' }
    } catch (err) {
      return { ok: false, description: '', error: err.message }
    }
  }

  /**
   * 列出悬了太久的条目。
   * @param {object} bookConfig - book.yaml 配置
   * @returns {Promise<object[]>}
   */
  async listOverdue(bookConfig) {
    // 需要缓存或扫描文件计算最大章号
    // 简化实现：假设从缓存读取
    if (!this.cache) {
      return []
    }

    try {
      const maxChapterRows = await this.cache.query(
        'SELECT MAX(chapter_num) as max FROM chapters'
      )
      const maxChapter = maxChapterRows[0]?.max || 0

      const overdueThreads = await this.cache.query(
        `SELECT id, type, short_title, last_advanced_chapter,
                (? - last_advanced_chapter) as overdue_count
         FROM threads
         WHERE status = '进行'`,
        [maxChapter]
      )

      // 按 book.yaml 阈值过滤
      const filtered = overdueThreads.filter((t) => {
        const typeKey = `${this._typeNameMap(t.type)}悬了太久章数`
        const threshold = bookConfig[typeKey] || 10
        return t.overdue_count > threshold
      })

      return filtered
    } catch (err) {
      return []
    }
  }

  /**
   * 按类型列出条目。
   * @param {string} type - "foreshadow" / "suspense" / "romance"
   * @param {string|null} status - "进行" / "已收尾" / "已放弃"
   * @returns {Promise<object[]>}
   */
  async listByType(type, status = null) {
    if (!this.cache) {
      return []
    }

    try {
      let query = 'SELECT id, short_title, strength, status FROM threads WHERE type = ?'
      const params = [type]

      if (status) {
        query += ' AND status = ?'
        params.push(status)
      }

      const rows = await this.cache.query(query, params)
      return rows
    } catch (err) {
      return []
    }
  }

  /**
   * 查找条目文件路径。
   * @param {string} threadId
   * @returns {Promise<string|null>}
   */
  async _findThreadFile(threadId) {
    // 解析 ID（伏笔-001 → 伏笔）
    const type = threadId.split('-')[0]
    const threadDir = path.join(this.repoPath, '大纲', type)

    try {
      const files = await fs.readdir(threadDir)
      const found = files.find((file) => file.startsWith(threadId))
      return found ? path.join(threadDir, found) : null
    } catch (err) {
      return null
    }
  }

  /**
   * 从正文提取指定 ## 段落内容。
   * @param {string} body
   * @param {string} sectionTitle
   * @returns {string}
   */
  _extractSection(body, sectionTitle) {
    const lines = body.split('\n')
    let inSection = false
    const sectionLines = []

    for (const line of lines) {
      if (line.startsWith('## ')) {
        if (inSection) {
          break // 遇到下一个 ## 停止
        }
        if (line.includes(sectionTitle)) {
          inSection = true
          continue
        }
      }

      if (inSection) {
        sectionLines.push(line)
      }
    }

    return sectionLines.join('\n').trim()
  }

  /**
   * 解析履历行（- 第N章：动作——描述（见...））。
   * @param {string} historyText
   * @returns {object[]}
   */
  _parseHistoryLines(historyText) {
    const lines = historyText.split('\n')
    const history = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('-')) continue

      const content = trimmed.slice(1).trim()
      // 简化解析：提取章号
      const match = content.match(/第(\d+)章/)
      if (match) {
        history.push({
          章号: parseInt(match[1], 10),
          原文: content,
        })
      }
    }

    return history
  }

  /**
   * 类型名称映射（type → 中文）。
   * @param {string} type
   * @returns {string}
   */
  _typeNameMap(type) {
    const map = {
      foreshadow: '伏笔',
      suspense: '悬念',
      romance: '感情线',
    }
    return map[type] || type
  }
}
