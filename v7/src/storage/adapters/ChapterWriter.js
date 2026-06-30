import { promises as fs } from 'node:fs'
import path from 'node:path'
import { serializeFrontMatter } from '../serializers/front-matter.js'

/**
 * ChapterWriter：写新章到定稿（M2 定稿流程调用）。
 */

let backupCounter = 0

/** 文件名净化：Windows 非法字符 <>:"/\|?* 与控制字符替成 _（标题本体不改,只净化文件名）。 */
function sanitizeFileName(title) {
  const s = String(title).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim()
  return s || '未命名'
}

/** 临时挪走同章旧文件（标题可能不同），避免 scanChapters 撞 PRIMARY KEY（P0-3a）。 */
async function backupOldChapterFiles(dir, chapterNum, safeTitle) {
  const prefix = `${String(chapterNum).padStart(4, '0')}-`
  const target = `${prefix}${safeTitle}.md`
  let files = []
  try {
    files = await fs.readdir(dir)
  } catch {
    return
  }
  const backups = []
  for (const f of files) {
    if (!f.startsWith(prefix) || !f.endsWith('.md')) continue
    if (f === target) continue
    const original = path.join(dir, f)
    const backup = path.join(dir, `${f}.wnwbackup.${process.pid}.${backupCounter++}`)
    await fs.rename(original, backup)
    backups.push({ original, backup })
  }
  return backups
}

async function restoreBackups(backups) {
  for (const b of backups.toReversed()) {
    try {
      await fs.rm(b.original, { force: true })
      await fs.rename(b.backup, b.original)
    } catch {
      // 尽力恢复；调用方会拿到原始错误
    }
  }
}

async function discardBackups(backups) {
  for (const b of backups) {
    await fs.rm(b.backup, { force: true })
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
   * @param {{preserveBackups?: boolean}} [opts] finalize 需要保留备份到 commit 成功后，供失败回滚
   * @returns {Promise<{ok: boolean, filePath: string, error: string}>}
   */
  async writeChapter(chapterNum, frontMatter, body, opts = {}) {
    const backups = []
    try {
      const title = frontMatter.标题 || '未命名'
      const safeTitle = sanitizeFileName(title)
      const dir = path.join(this.repoPath, '定稿', '正文')
      await fs.mkdir(dir, { recursive: true })
      backups.push(...(await backupOldChapterFiles(dir, chapterNum, safeTitle)))
      const fileName = `${String(chapterNum).padStart(4, '0')}-${safeTitle}.md`
      const filePath = path.join(dir, fileName)
      await fs.writeFile(filePath, serializeFrontMatter(frontMatter, body), 'utf8')
      if (!opts.preserveBackups) await discardBackups(backups)
      return {
        ok: true,
        filePath,
        removedPaths: backups.map((b) => b.original),
        backups,
        error: '',
      }
    } catch (err) {
      await restoreBackups(backups)
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
