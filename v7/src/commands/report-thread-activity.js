/**
 * report-thread-activity --卷=N → 本卷开 / 本卷推进 / 本卷收尾 条目清单
 * 卷 → 章号范围（查 chapters），再按 opened/last_advanced 落在范围内归类。
 * 注：threads 无 closed_chapter，"本卷收尾"以"已收尾且最后推进落在本卷"近似（M2 增量更新后可精确）。
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const vol = options['卷'] && options['卷'] !== true ? parseInt(options['卷'], 10) : null
  if (!vol) {
    return { ok: false, error: '请用 --卷=N 指定卷号' }
  }

  const range = await ctx.cache.query(
    'SELECT MIN(chapter_num) AS s, MAX(chapter_num) AS e FROM chapters WHERE volume_num = ?',
    [vol]
  )
  const s = range[0]?.s
  const e = range[0]?.e
  if (s == null) {
    return {
      ok: true,
      output: JSON.stringify({ 卷: vol, 本卷开: [], 本卷推进: [], 本卷收尾: [] }, null, 2),
    }
  }

  const opened = await ctx.cache.query(
    'SELECT id, type, short_title FROM threads WHERE opened_chapter BETWEEN ? AND ? ORDER BY id',
    [s, e]
  )
  const advanced = await ctx.cache.query(
    'SELECT id, type, short_title FROM threads WHERE last_advanced_chapter BETWEEN ? AND ? ORDER BY id',
    [s, e]
  )
  const closed = await ctx.cache.query(
    "SELECT id, type, short_title FROM threads WHERE status = '已收尾' AND last_advanced_chapter BETWEEN ? AND ? ORDER BY id",
    [s, e]
  )

  return {
    ok: true,
    output: JSON.stringify({ 卷: vol, 本卷开: opened, 本卷推进: advanced, 本卷收尾: closed }, null, 2),
  }
}
