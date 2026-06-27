/**
 * ChapterWriter：写新章到定稿（M2 落地，本任务只定接口占位）。
 */
export class ChapterWriter {
  constructor(repoPath, cache = null) {
    this.repoPath = repoPath
    this.cache = cache
  }

  /**
   * 写新章到定稿目录。
   * @param {number} chapterNum
   * @param {object} frontMatter
   * @param {string} body
   * @returns {Promise<{ok: boolean, error: string}>}
   */
  async writeChapter(chapterNum, frontMatter, body) {
    throw new Error('ChapterWriter.writeChapter() 将在 M2 定稿流程中实现')
  }

  /**
   * 更新章节 front matter。
   * @param {number} chapterNum
   * @param {object} updates
   * @returns {Promise<{ok: boolean, error: string}>}
   */
  async updateFrontMatter(chapterNum, updates) {
    throw new Error('ChapterWriter.updateFrontMatter() 将在 M2 定稿流程中实现')
  }
}
