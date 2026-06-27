/**
 * list-chapters --章定位=<推进|过渡|日常> [--卷=N] → JSON 数组（章号、标题）
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const position = options['章定位']
  if (!position) {
    return { ok: false, error: '请用 --章定位=<推进|过渡|日常> 指定筛选' }
  }

  let sql = 'SELECT chapter_num, title, volume_num FROM chapters WHERE chapter_position = ?'
  const params = [position]
  if (options['卷'] !== undefined && options['卷'] !== true) {
    sql += ' AND volume_num = ?'
    params.push(parseInt(options['卷'], 10))
  }
  sql += ' ORDER BY chapter_num'

  const rows = await ctx.cache.query(sql, params)
  return { ok: true, output: JSON.stringify(rows, null, 2) }
}
