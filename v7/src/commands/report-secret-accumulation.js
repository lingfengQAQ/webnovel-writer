/**
 * report-secret-accumulation → 未揭晓信息差 + 蓄积章数（按蓄积降序）
 * 蓄积章数 = 当前最大章号 − 登记章（派生值不物化，查询时算）。
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const rows = await ctx.cache.query(
    'SELECT id, short_title, registered_chapter FROM secrets WHERE reader_knows = 0'
  )
  const maxRows = await ctx.cache.query('SELECT MAX(chapter_num) AS m FROM chapters')
  const max = maxRows[0]?.m || 0

  const out = rows
    .map((s) => ({ id: s.id, short_title: s.short_title, 蓄积章数: max - s.registered_chapter }))
    .sort((a, b) => b.蓄积章数 - a.蓄积章数)
  return { ok: true, output: JSON.stringify(out, null, 2) }
}
