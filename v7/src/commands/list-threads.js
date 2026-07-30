import { ThreadLedgerReader } from '../storage/adapters/ThreadLedgerReader.js'
import { BookConfigReader } from '../storage/adapters/BookConfigReader.js'

/**
 * list-threads [--悬了太久 | --type=<t> [--status=<s>] | --strength=<强>]
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const reader = new ThreadLedgerReader(ctx.repoPath, ctx.cache, ctx.degradation)

  if (options['悬了太久']) {
    const config = await new BookConfigReader(ctx.repoPath).read()
    const overdue = await reader.listOverdue(config.ok ? config.data : {})
    return { ok: true, output: JSON.stringify(overdue, null, 2) }
  }

  if (options.type && options.type !== true) {
    const status = options.status && options.status !== true ? options.status : null
    const rows = await reader.listByType(options.type, status)
    return { ok: true, output: JSON.stringify(rows, null, 2) }
  }

  if (options.strength && options.strength !== true) {
    const rows = await ctx.cache.query(
      'SELECT id, type, short_title, strength, status FROM threads WHERE strength = ? ORDER BY id',
      [options.strength]
    )
    return { ok: true, output: JSON.stringify(rows, null, 2) }
  }

  return {
    ok: false,
    error: '请指定筛选（--悬了太久 | --type=<t> [--status=<s>] | --strength=<强>）',
  }
}
