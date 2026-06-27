import { ChapterReader } from '../storage/adapters/ChapterReader.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * read-chapters [--range=a-b --摘要 | --recent=N --tail=M] → 批量读取
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  // --range=a-b --摘要：范围内各章摘要（摘要在 定稿/摘要/章摘要/NNNN.md，不在 front matter）
  if (options.range && options.range !== true) {
    const m = String(options.range).match(/^(\d+)-(\d+)$/)
    if (!m) return { ok: false, error: '--range 格式应为 起-止，如 --range=1-20' }
    const start = parseInt(m[1], 10)
    const end = parseInt(m[2], 10)
    const out = []
    for (let n = start; n <= end; n++) {
      const sp = path.join(ctx.repoPath, '定稿', '摘要', '章摘要', `${String(n).padStart(4, '0')}.md`)
      let summary = ''
      try {
        summary = (await fs.readFile(sp, 'utf8')).trim()
      } catch {
        summary = ''
      }
      out.push({ 章号: n, 摘要: summary })
    }
    return { ok: true, output: JSON.stringify(out, null, 2) }
  }

  // --recent=N --tail=M：近 N 章的结尾 M 字
  if (options.recent && options.recent !== true) {
    const n = parseInt(options.recent, 10)
    const tailLen = options.tail && options.tail !== true ? parseInt(options.tail, 10) : 200
    const rows = await ctx.cache.query(
      'SELECT chapter_num FROM chapters ORDER BY chapter_num DESC LIMIT ?',
      [n]
    )
    const reader = new ChapterReader(ctx.repoPath, ctx.cache)
    const out = []
    for (const row of rows) {
      const r = await reader.readTail(row.chapter_num, tailLen)
      out.push({ 章号: row.chapter_num, 结尾: r.ok ? r.text : '' })
    }
    out.sort((a, b) => a.章号 - b.章号)
    return { ok: true, output: JSON.stringify(out, null, 2) }
  }

  return { ok: false, error: '请指定 --range=起-止 --摘要 或 --recent=N --tail=M' }
}
