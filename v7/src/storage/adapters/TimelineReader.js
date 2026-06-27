import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseMarkdownTable } from '../parsers/markdown-table.js'

/**
 * TimelineReader：读取时间线。
 */
export class TimelineReader {
  constructor(repoPath, cache = null) {
    this.repoPath = repoPath
    this.cache = cache
  }

  /**
   * 读取当前卷时间线。
   * @param {number} volumeNum - 卷号
   * @returns {Promise<{ok: boolean, timeline: object[], error: string}>}
   */
  async readCurrentVolume(volumeNum) {
    return this.readVolumeRange(volumeNum, volumeNum)
  }

  /**
   * 读取卷范围时间线。
   * @param {number} startVolume
   * @param {number} endVolume
   * @returns {Promise<{ok: boolean, timeline: object[], error: string}>}
   */
  async readVolumeRange(startVolume, endVolume) {
    const allTimeline = []

    for (let vol = startVolume; vol <= endVolume; vol++) {
      const volStr = String(vol).padStart(2, '0')
      const filePath = path.join(
        this.repoPath,
        '定稿',
        '设定',
        '时间线',
        `第${volStr}卷.md`
      )

      try {
        const content = await fs.readFile(filePath, 'utf8')
        const table = parseMarkdownTable(content)
        if (table.ok) {
          allTimeline.push(...table.rows)
        }
      } catch (err) {
        // 文件不存在，跳过
      }
    }

    return { ok: true, timeline: allTimeline, error: '' }
  }

  /**
   * 按在场角色筛选时间线。
   * @param {number} volumeNum
   * @param {string} name - 角色正名
   * @returns {Promise<object[]>}
   */
  async readByParticipant(volumeNum, name) {
    const result = await this.readCurrentVolume(volumeNum)
    if (!result.ok) return []

    return result.timeline.filter((entry) => entry.在场 && entry.在场.includes(name))
  }
}
