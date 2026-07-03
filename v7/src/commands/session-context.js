import { assembleSessionContext, touchLastOpened } from '../session/index.js'

/**
 * session-context：输出 SessionStart 注入文本（当前在写哪本/共几本/入口）。
 * Claude Code SessionStart hook 与无 hook 宿主状态机入口都调这里 → 注入逐字一致。
 * 契约：纯返回 {ok, output?, error?}。
 */
export const scope = 'workdir'

export async function run(args, options, ctx) {
  const r = await assembleSessionContext(ctx.workdir)
  if (r.current) await touchLastOpened(ctx.workdir, r.current.目录)
  return { ok: true, output: r.text }
}
