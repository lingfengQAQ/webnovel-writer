import { SecretReader } from '../storage/adapters/SecretReader.js'

/**
 * list-secrets [--reader-knows=false] → 未揭晓信息差（含查询时算的蓄积章数）
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const reader = new SecretReader(ctx.repoPath, ctx.cache)
  const rows = await reader.listUnrevealed()

  // 蓄积章数 = 当前最大章号 − 登记章（派生值，不物化，查询时算）
  const maxRows = await ctx.cache.query('SELECT MAX(chapter_num) AS m FROM chapters')
  const max = maxRows[0]?.m || 0

  const out = rows.map((s) => ({
    id: s.id,
    short_title: s.short_title,
    蓄积章数: max - s.registered_chapter,
  }))
  return { ok: true, output: JSON.stringify(out, null, 2) }
}
