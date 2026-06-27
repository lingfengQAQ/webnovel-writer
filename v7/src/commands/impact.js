import { analyzeImpact } from '../state-machine/flows/impact.js'

/**
 * impact <关键词> → 影响分析（哪些章/条目/时间线建立在这个事实上，分已发布/未发布）
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const r = await analyzeImpact(ctx, { 关键词: args[0] })
  return r.ok ? { ok: true, output: JSON.stringify(r, null, 2) } : { ok: false, error: r.error }
}
