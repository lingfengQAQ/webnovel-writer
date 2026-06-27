import { determineNextState } from '../state-machine/index.js'

/**
 * next（「继续」单入口）：跑状态机判定下一步，打印中文摘要。
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const r = await determineNextState(ctx)
  const lines = []
  if (r.gitHealth.fixed.length) {
    lines.push('【git 已自动处理】', ...r.gitHealth.fixed.map((s) => '  · ' + s))
  }
  if (r.gitHealth.guidance.length) {
    lines.push('【需你留意】', ...r.gitHealth.guidance.map((s) => '  · ' + s))
  }
  lines.push(`【当前状态】序${r.序} ${r.state}${r.needsAI ? '（需 AI）' : ''}`)
  lines.push(r.message)
  return { ok: true, output: lines.join('\n') }
}
