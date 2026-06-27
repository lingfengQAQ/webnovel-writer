/**
 * report-weak-hook-streak → 末尾连续弱钩章数（全书近况 / 机检"连续弱钩上限"用）
 * 钩子值形如"危机钩-强"、"情绪钩-弱"，弱钩判定：含"弱钩"或以"-弱"结尾（design §6.3）。
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const rows = await ctx.cache.query(
    'SELECT chapter_num, hook_type FROM chapters ORDER BY chapter_num DESC LIMIT 20'
  )

  let streak = 0
  for (const ch of rows) {
    const h = ch.hook_type || ''
    if (h.includes('弱钩') || h.endsWith('-弱')) {
      streak++
    } else {
      break
    }
  }
  return { ok: true, output: JSON.stringify({ streak }, null, 2) }
}
