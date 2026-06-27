import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * OutlineReader：读取总纲/卷纲。
 */
export class OutlineReader {
  constructor(repoPath, cache = null) {
    this.repoPath = repoPath
    this.cache = cache
  }

  /**
   * 读取总纲指定小节。
   * @param {string} sectionTitle - 小节标题（如 "结局"）
   * @returns {Promise<{ok: boolean, content: string, error: string}>}
   */
  async readOutlineSection(sectionTitle) {
    const outlinePath = path.join(this.repoPath, '大纲', '总纲.md')

    try {
      const content = await fs.readFile(outlinePath, 'utf8')
      const section = this._extractSection(content, sectionTitle)
      return { ok: true, content: section, error: '' }
    } catch (err) {
      return { ok: false, content: '', error: '总纲文件不存在' }
    }
  }

  /**
   * 读取卷纲全文。
   * @param {number} volumeNum
   * @returns {Promise<{ok: boolean, content: string, error: string}>}
   */
  async readVolumeOutline(volumeNum) {
    const volStr = String(volumeNum).padStart(2, '0')
    const volumePath = path.join(this.repoPath, '大纲', `第${volStr}卷.md`)

    try {
      const content = await fs.readFile(volumePath, 'utf8')
      return { ok: true, content, error: '' }
    } catch (err) {
      return { ok: false, content: '', error: `第${volumeNum}卷卷纲不存在` }
    }
  }

  /**
   * 列出所有卷纲。
   * @returns {Promise<number[]>}
   */
  async listVolumes() {
    const outlineDir = path.join(this.repoPath, '大纲')

    try {
      const files = await fs.readdir(outlineDir)
      const volumes = files
        .filter((file) => file.match(/^第\d+卷\.md$/))
        .map((file) => {
          const match = file.match(/第(\d+)卷/)
          return match ? parseInt(match[1], 10) : 0
        })
        .filter((v) => v > 0)
        .sort((a, b) => a - b)

      return volumes
    } catch (err) {
      return []
    }
  }

  _extractSection(content, sectionTitle) {
    const lines = content.split('\n')
    let inSection = false
    const sectionLines = []

    for (const line of lines) {
      if (line.startsWith('#')) {
        if (inSection) break
        if (line.includes(sectionTitle)) {
          inSection = true
          continue
        }
      }
      if (inSection) sectionLines.push(line)
    }

    return sectionLines.join('\n').trim()
  }
}
