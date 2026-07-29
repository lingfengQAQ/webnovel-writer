import { promises as fs } from 'node:fs'
import path from 'node:path'
import { serializeFrontMatter } from '../serializers/front-matter.js'
import { isSafeFileStem } from '../../util/filename.js'

/**
 * SecretWriter：写/更新信息差文件（M2 定稿流程调用）。
 */
export class SecretWriter {
  constructor(repoPath, cache = null) {
    this.repoPath = repoPath
    this.cache = cache
  }

  /**
   * 写信息差到 定稿/设定/信息差/<id>.md（front matter 走防呆序列化）。
   * @param {string} id - 文件名干（如 "信息差-021-血书真相"）
   * @param {object} frontMatter - 强度/知情人[]/读者已知/登记章/关键词[]
   * @param {string} content - 正文（## 描述 / ## 内容 段）
   * @returns {Promise<{ok: boolean, filePath: string, error: string}>}
   */
  async write(id, frontMatter, content) {
    // P0-F1 写入器自卫（不信任调用方）：id 是 AI 可控字段，必须在 mkdir 之前拒绝。
    if (!isSafeFileStem(id)) {
      return {
        ok: false,
        filePath: '',
        error: `信息差编号「${String(id ?? '（空）')}」含非法字符，不能用作文件名`,
      }
    }
    try {
      const dir = path.join(this.repoPath, '定稿', '设定', '信息差')
      await fs.mkdir(dir, { recursive: true })
      const filePath = path.join(dir, `${id}.md`)
      await fs.writeFile(filePath, serializeFrontMatter(frontMatter, content), 'utf8')
      return { ok: true, filePath, error: '' }
    } catch (err) {
      return { ok: false, filePath: '', error: `写信息差 ${id} 失败：${err.message}` }
    }
  }
}
