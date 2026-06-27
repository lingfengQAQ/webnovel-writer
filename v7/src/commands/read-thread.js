import { ThreadLedgerReader } from '../storage/adapters/ThreadLedgerReader.js'

/**
 * read-thread <条目ID> [--履历|--收尾计划|--描述]（默认基本信息）
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const threadId = args[0]
  if (!threadId) {
    return { ok: false, error: '请指定条目 ID（如 伏笔-001）' }
  }

  const reader = new ThreadLedgerReader(ctx.repoPath, ctx.cache)

  if (options['履历']) {
    const r = await reader.readHistory(threadId)
    return r.ok ? { ok: true, output: JSON.stringify(r.history, null, 2) } : { ok: false, error: r.error }
  }

  if (options['收尾计划']) {
    const r = await reader.readClosurePlan(threadId)
    return r.ok ? { ok: true, output: r.plan } : { ok: false, error: r.error }
  }

  if (options['描述']) {
    const r = await reader.readDescription(threadId)
    return r.ok ? { ok: true, output: r.description } : { ok: false, error: r.error }
  }

  // 默认：基本信息
  const r = await reader.readBasicInfo(threadId)
  return r.ok ? { ok: true, output: JSON.stringify(r.data, null, 2) } : { ok: false, error: r.error }
}
