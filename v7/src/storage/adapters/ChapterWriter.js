import { promises as fs } from 'node:fs'
import path from 'node:path'
import { serializeFrontMatter } from '../serializers/front-matter.js'

/**
 * ChapterWriter：写新章到定稿（M2 定稿流程调用）。
 */
export class ChapterWriter {
  constructor(repoPath, cache = null) {
    this.repoPath = repoPath
    this.cache = cache
  }

  /**
   * 写新章到 定稿/正文/NNNN-标题.md（front matter 走防呆序列化）。
   * @param {number} chapterNum
   * @param {object} frontMatter - 章档案（章号/标题/卷/视角/字数/章定位/钩子/情绪定位/伏笔[]/...）
   * @param {string} body - 正文（不含 front matter）
   * @returns {Promise<{ok: boolean, filePath: string, error: string}>}
   */
  async writeChapter(chapterNum, frontMatter, body) {
    try {
      const title = frontMatter.标题 || '未命名'
      const fileName = `${String(chapterNum).padStart(4, '0')}-${title}.md`
      const dir = path.join(this.repoPath, '定稿', '正文')
      await fs.mkdir(dir, { recursive: true })
      const filePath = path.join(dir, fileName)
      await fs.writeFile(filePath, serializeFrontMatter(frontMatter, body), 'utf8')
      return { ok: true, filePath, error: '' }
    } catch (err) {
      return { ok: false, filePath: '', error: `写章节 ${chapterNum} 失败：${err.message}` }
    }
  }

  /**
   * 更新已有章节 front matter（M2 写新章流程不需要，按需补）。
   */
  async updateFrontMatter(chapterNum, updates) {
    throw new Error('ChapterWriter.updateFrontMatter() 暂未实现（M2 写新章不依赖；按需补）')
  }
}
