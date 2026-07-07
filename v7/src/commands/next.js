import { determineNextState } from '../state-machine/index.js'

/**
 * next（「继续」单入口）：跑状态机判定下一步。缺省打印中文摘要；--json 输出完整 DTO（F1）。
 * 空工作目录（无当前书）也可跑 → 状态机报序1 建书引导。
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export const allowNoBook = true

export async function run(args, options, ctx) {
  const r = await determineNextState(ctx)
  if (options.json) {
    return { ok: true, output: JSON.stringify(r, null, 2) }
  }
  if (!r.ok) return { ok: false, error: r.message }
  const lines = []
  // gitHealth 防御（G-7）：序1 等无仓库路径的返回不一定带完整 gitHealth
  if (r.gitHealth?.fixed?.length) {
    lines.push('【git 已自动处理】', ...r.gitHealth.fixed.map((s) => '  · ' + s))
  }
  if (r.gitHealth?.guidance?.length) {
    lines.push('【需你留意】', ...r.gitHealth.guidance.map((s) => '  · ' + s))
  }
  lines.push(`【当前状态】序${r.序} ${r.state}${r.needsAI ? '（需 AI）' : ''}`)
  lines.push(r.message)
  return { ok: true, output: lines.join('\n') }
}
