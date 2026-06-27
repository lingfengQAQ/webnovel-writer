import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseBookConfig } from '../parsers/book-config.js'

/**
 * BookConfigReader：读取 book.yaml。
 */
export class BookConfigReader {
  constructor(repoPath) {
    this.repoPath = repoPath
  }

  /**
   * 读取 book.yaml 配置。
   * @returns {Promise<{ok: boolean, data: object|null, error: string}>}
   */
  async read() {
    const configPath = path.join(this.repoPath, 'book.yaml')

    try {
      const content = await fs.readFile(configPath, 'utf8')
      const result = parseBookConfig(content)
      return result
    } catch (err) {
      return { ok: false, data: null, error: 'book.yaml 不存在' }
    }
  }
}
