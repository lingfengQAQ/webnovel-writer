import { exportChapters } from '../export/index.js'

/**
 * export <章号> | export --range=a-b | export --all
 * 干净导出：去 front matter 纯正文 → 工作区/导出/（spec §4.7）。
 */
export async function run(args, options, ctx) {
  if (options.all) {
    return exportChapters(ctx, { mode: 'all' })
  }
  if (options.range) {
    const m = String(options.range).match(/^(\d+)-(\d+)$/)
    if (!m) {
      return { ok: false, error: '范围格式应为 --range=起章-止章，例如 --range=6-12。' }
    }
    return exportChapters(ctx, { mode: 'range', start: Number(m[1]), end: Number(m[2]) })
  }
  const chapterNum = parseInt(args[0], 10)
  if (Number.isNaN(chapterNum)) {
    return { ok: false, error: '用法：export <章号>，或 export --range=起章-止章，或 export --all。' }
  }
  return exportChapters(ctx, { mode: 'single', chapterNum })
}
