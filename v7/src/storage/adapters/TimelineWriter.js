import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseMarkdownTable } from '../parsers/markdown-table.js'
import { serializeMarkdownTable } from '../serializers/markdown-table.js'
import { parsePositiveInt } from '../../util/positive-int.js'

const TIMELINE_HEADERS = ['章', '书内时间', '一句话事件', '在场']

/**
 * TimelineWriter：向卷时间线表格追加行（M2 定稿流程调用）。
 */
export class TimelineWriter {
  constructor(repoPath, cache = null) {
    this.repoPath = repoPath
    this.cache = cache
  }

  /**
   * 向 定稿/设定/时间线/第NN卷.md 追加一行（文件不存在则建表头）。
   * @param {number} volumeNum
   * @param {object} row { 章, 书内时间, 一句话事件, 在场 }
   * @returns {Promise<{ok: boolean, filePath: string, error: string}>}
   */
  async appendRow(volumeNum, row) {
    // P0-F2 写入器自卫（不信任调用方）：volumeNum 是 AI 可控字段，必须在 mkdir 之前拒绝。
    const vol = parsePositiveInt(volumeNum)
    if (vol === null) {
      return {
        ok: false,
        filePath: '',
        error: `时间线卷号必须是正整数，收到「${String(volumeNum ?? '（空）')}」`,
      }
    }
    try {
      const dir = path.join(this.repoPath, '定稿', '设定', '时间线')
      await fs.mkdir(dir, { recursive: true })
      const filePath = path.join(dir, `第${String(vol).padStart(2, '0')}卷.md`)

      let headers = TIMELINE_HEADERS
      let rows = []
      try {
        const parsed = parseMarkdownTable(await fs.readFile(filePath, 'utf8'))
        if (parsed.ok && parsed.headers.length) {
          headers = parsed.headers
          rows = parsed.rows
        }
      } catch {
        // 文件不存在，用默认表头
      }

      // 同章已有行则替换（A12：定稿失败重试/goto 后重定稿同章，时间线不得叠重复行）
      const idx = rows.findIndex((r) => String(r.章) === String(row.章))
      if (idx >= 0) rows[idx] = { ...rows[idx], ...row }
      else rows.push(row)
      await fs.writeFile(filePath, serializeMarkdownTable(headers, rows), 'utf8')
      return { ok: true, filePath, error: '' }
    } catch (err) {
      return { ok: false, filePath: '', error: `写时间线第${volumeNum}卷失败：${err.message}` }
    }
  }
}
