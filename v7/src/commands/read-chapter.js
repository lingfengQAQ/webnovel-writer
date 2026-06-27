import { ChapterReader } from '../storage/adapters/ChapterReader.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * read-chapter <章号> [--front-matter|--tail=N|--head=N|--摘要]
 * 契约：纯返回 {ok, output?, error?}，不碰 console/process/cache 生命周期（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const chapterNum = parseInt(args[0], 10)
  if (isNaN(chapterNum)) {
    return { ok: false, error: '章号必须是数字' }
  }

  const reader = new ChapterReader(ctx.repoPath, ctx.cache)

  if (options['front-matter']) {
    const r = await reader.readFrontMatter(chapterNum)
    return r.ok ? { ok: true, output: JSON.stringify(r.data, null, 2) } : { ok: false, error: r.error }
  }

  if (options.tail) {
    const r = await reader.readTail(chapterNum, parseInt(options.tail, 10))
    return r.ok ? { ok: true, output: r.text } : { ok: false, error: r.error }
  }

  if (options.head) {
    const r = await reader.readHead(chapterNum, parseInt(options.head, 10))
    return r.ok ? { ok: true, output: r.text } : { ok: false, error: r.error }
  }

  if (options['摘要']) {
    const summaryPath = path.join(
      ctx.repoPath,
      '定稿',
      '摘要',
      '章摘要',
      `${String(chapterNum).padStart(4, '0')}.md`
    )
    try {
      const summary = await fs.readFile(summaryPath, 'utf8')
      return { ok: true, output: summary.trim() }
    } catch {
      return { ok: false, error: `章节 ${chapterNum} 摘要不存在` }
    }
  }

  // 默认：读正文
  const r = await reader.readBody(chapterNum)
  return r.ok ? { ok: true, output: r.body } : { ok: false, error: r.error }
}
