import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * SummaryWriter：写章摘要（M2 定稿流程调用，审稿单定稿版落盘）。
 */
export class SummaryWriter {
  constructor(repoPath, cache = null) {
    this.repoPath = repoPath
    this.cache = cache
  }

  /**
   * 写章摘要到 定稿/摘要/章摘要/NNNN.md。
   * @param {number} chapterNum
   * @param {string} text - 摘要文本（≤200 字，纯文本无 front matter）
   * @returns {Promise<{ok: boolean, filePath: string, error: string}>}
   */
  async writeChapterSummary(chapterNum, text) {
    try {
      const dir = path.join(this.repoPath, '定稿', '摘要', '章摘要')
      await fs.mkdir(dir, { recursive: true })
      const filePath = path.join(dir, `${String(chapterNum).padStart(4, '0')}.md`)
      await fs.writeFile(filePath, `${String(text).trim()}\n`, 'utf8')
      return { ok: true, filePath, error: '' }
    } catch (err) {
      return { ok: false, filePath: '', error: `写章摘要 ${chapterNum} 失败：${err.message}` }
    }
  }
}
