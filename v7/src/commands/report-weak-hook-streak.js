import { isWeakHook } from '../util/hooks.js'

/**
 * report-weak-hook-streak → 末尾连续弱钩章数（全书近况 / 机检"连续弱钩上限"用）
 * 弱钩判据单源 isWeakHook（E8）。
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const rows = await ctx.cache.query(
    'SELECT chapter_num, hook_type FROM chapters ORDER BY chapter_num DESC LIMIT 20'
  )

  let streak = 0
  for (const ch of rows) {
    if (isWeakHook(ch.hook_type)) {
      streak++
    } else {
      break
    }
  }
  return { ok: true, output: JSON.stringify({ streak }, null, 2) }
}
