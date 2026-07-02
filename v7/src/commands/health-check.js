import { runHealthCheck } from '../health-check/index.js'

/**
 * health-check：最小体检（零 token）。报告落 工作区/体检报告.md 并记录体检章号（序 5 判定依据）。
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const r = await runHealthCheck(ctx)
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, output: `体检完成（第 ${r.maxChapter} 章），报告见 工作区/体检报告.md` }
}
