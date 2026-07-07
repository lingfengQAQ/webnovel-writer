import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../parsers/front-matter.js'

// 缓存行（英文 snake_case 列）→ 作者域中文键（A6：接口形状不得随缓存冷热漂移）。
// file_path/is_key_chapter 是机器域内部列，不出作者域。
const CHAPTER_ROW_TO_FM = {
  chapter_num: '章号',
  title: '标题',
  volume_num: '卷',
  perspective: '视角',
  story_time: '书内时间',
  word_count: '字数',
  chapter_position: '章定位',
  hook_type: '钩子',
  mood_position: '情绪定位',
}

function chapterRowToFrontMatter(row) {
  const fm = {}
  for (const [col, key] of Object.entries(CHAPTER_ROW_TO_FM)) {
    if (row[col] !== null && row[col] !== undefined) fm[key] = row[col]
  }
  if (row.is_volume_end) fm.收卷 = '是'
  return fm
}

/**
 * ChapterReader：读取章节 front matter、正文、范围。
 */
export class ChapterReader {
  constructor(repoPath, cache = null) {
    this.repoPath = repoPath
    this.cache = cache // CacheManager 实例（可选）
  }

  /**
   * 读取章节 front matter（缓存命中与文件降级输出同一形状：中文键）。
   * @param {number} chapterNum - 章号
   * @returns {Promise<{ok: boolean, data: object|null, error: string}>}
   */
  async readFrontMatter(chapterNum) {
    // 策略：优先查缓存 chapters 表，缺失时读文件
    if (this.cache) {
      try {
        const rows = await this.cache.query(
          'SELECT * FROM chapters WHERE chapter_num = ?',
          [chapterNum]
        )
        if (rows.length > 0) {
          return { ok: true, data: chapterRowToFrontMatter(rows[0]), error: '' }
        }
      } catch (err) {
        // 缓存失败，降级到文件读取
      }
    }

    // 降级：直接读文件
    const filePath = await this._findChapterFile(chapterNum)
    if (!filePath) {
      return {
        ok: false,
        data: null,
        error: `章节 ${chapterNum} 不存在（未找到对应文件）`,
      }
    }

    try {
      const content = await fs.readFile(filePath, 'utf8')
      const parsed = parseFrontMatter(content)
      if (!parsed.ok) {
        return {
          ok: false,
          data: null,
          error: `章节 ${chapterNum} 解析失败：${parsed.error}`,
        }
      }
      return { ok: true, data: parsed.data, error: '' }
    } catch (err) {
      return {
        ok: false,
        data: null,
        error: `读取章节 ${chapterNum} 失败：${err.message}`,
      }
    }
  }

  /**
   * 读取章节正文（不含 front matter）。
   * @param {number} chapterNum
   * @returns {Promise<{ok: boolean, body: string, error: string}>}
   */
  async readBody(chapterNum) {
    const filePath = await this._findChapterFile(chapterNum)
    if (!filePath) {
      return { ok: false, body: '', error: `章节 ${chapterNum} 不存在` }
    }

    try {
      const content = await fs.readFile(filePath, 'utf8')
      const parsed = parseFrontMatter(content)
      if (!parsed.ok) {
        return { ok: false, body: '', error: `解析失败：${parsed.error}` }
      }
      return { ok: true, body: parsed.body, error: '' }
    } catch (err) {
      return { ok: false, body: '', error: err.message }
    }
  }

  /**
   * 读取章节正文末尾 N 字。
   * @param {number} chapterNum
   * @param {number} wordCount
   * @returns {Promise<{ok: boolean, text: string, error: string}>}
   */
  async readTail(chapterNum, wordCount) {
    const bodyResult = await this.readBody(chapterNum)
    if (!bodyResult.ok) {
      return { ok: false, text: '', error: bodyResult.error }
    }

    const tail = bodyResult.body.slice(-wordCount)
    return { ok: true, text: tail, error: '' }
  }

  /**
   * 读取章节正文开头 N 字。
   * @param {number} chapterNum
   * @param {number} wordCount
   * @returns {Promise<{ok: boolean, text: string, error: string}>}
   */
  async readHead(chapterNum, wordCount) {
    const bodyResult = await this.readBody(chapterNum)
    if (!bodyResult.ok) {
      return { ok: false, text: '', error: bodyResult.error }
    }

    const head = bodyResult.body.slice(0, wordCount)
    return { ok: true, text: head, error: '' }
  }

  /**
   * 查找章节文件路径（零填充前缀匹配）。
   * @param {number} chapterNum
   * @returns {Promise<string|null>}
   */
  async _findChapterFile(chapterNum) {
    const chapterDir = path.join(this.repoPath, '定稿', '正文')
    try {
      const files = await fs.readdir(chapterDir)
      const prefix = String(chapterNum).padStart(4, '0') // 0001-
      const found = files.find((file) => file.startsWith(prefix + '-'))
      return found ? path.join(chapterDir, found) : null
    } catch (err) {
      return null
    }
  }
}
