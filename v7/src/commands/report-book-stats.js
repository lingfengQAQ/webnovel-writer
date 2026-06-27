/**
 * report-book-stats → 总章数 / 总字数 / 条目数 / 角色数
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const ch = await ctx.cache.query(
    'SELECT COUNT(*) AS c, COALESCE(SUM(word_count), 0) AS w FROM chapters'
  )
  const th = await ctx.cache.query('SELECT COUNT(*) AS c FROM threads')
  const en = await ctx.cache.query("SELECT COUNT(*) AS c FROM entities WHERE type = 'character'")

  const stats = {
    总章数: ch[0].c,
    总字数: ch[0].w,
    条目数: th[0].c,
    角色数: en[0].c,
  }
  return { ok: true, output: JSON.stringify(stats, null, 2) }
}
