import { promises as fs } from 'node:fs'
import path from 'node:path'
import { serializeFrontMatter } from '../serializers/front-matter.js'

/**
 * ChapterWriter：写新章到定稿（M2 定稿流程调用）。
 */

/** 文件名净化：Windows 非法字符 <>:"/\|?* 与控制字符替成 _（标题本体不改,只净化文件名）。 */
function sanitizeFileName(title) {
  const s = String(title).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim()
  return s || '未命名'
}

/** 删除同章旧文件（标题可能不同），避免 scanChapters 撞 PRIMARY KEY（P0-3a）。 */
async function removeOldChapterFiles(dir, chapterNum, safeTitle) {
  const prefix = `${String(chapterNum).padStart(4, '0')}-`
  const target = `${prefix}${safeTitle}.md`
  let files = []
  try {
    files = await fs.readdir(dir)
  } catch {
    return
  }
  for (const f of files) {
    if (!f.startsWith(prefix) || !f.endsWith('.md')) continue
    if (f === target) continue
    await fs.rm(path.join(dir, f), { force: true })
  }
}

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
      const safeTitle = sanitizeFileName(title)
      const dir = path.join(this.repoPath, '定稿', '正文')
      await fs.mkdir(dir, { recursive: true })
      await removeOldChapterFiles(dir, chapterNum, safeTitle)
      const fileName = `${String(chapterNum).padStart(4, '0')}-${safeTitle}.md`
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
