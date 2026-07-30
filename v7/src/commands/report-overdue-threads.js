import { ThreadLedgerReader } from '../storage/adapters/ThreadLedgerReader.js'
import { BookConfigReader } from '../storage/adapters/BookConfigReader.js'

/**
 * report-overdue-threads → 按类型分组的悬了太久条目清单（查询时计算，见 design §6.3）
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const threadReader = new ThreadLedgerReader(ctx.repoPath, ctx.cache, ctx.degradation)
  const configReader = new BookConfigReader(ctx.repoPath)

  const configResult = await configReader.read()
  if (!configResult.ok) {
    return { ok: false, error: '无法读取 book.yaml' }
  }

  const overdueThreads = await threadReader.listOverdue(configResult.data)

  // 按类型分组
  const grouped = {}
  for (const t of overdueThreads) {
    if (!grouped[t.type]) grouped[t.type] = []
    grouped[t.type].push(t)
  }

  return { ok: true, output: JSON.stringify(grouped, null, 2) }
}
