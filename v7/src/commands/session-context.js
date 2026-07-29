import { assembleSessionContext, touchLastOpened } from '../session/index.js'

/**
 * session-context：输出会话上下文（当前在写哪本/共几本/入口）。
 * Claude Code SessionStart 与无 hook 宿主生成壳显式调用这里；next 的序 2 是另一条
 * 事后手改自愈路径，不冒充写前 hook。
 * 契约：纯返回 {ok, output?, error?}。
 */
export const scope = 'workdir'

export async function run(args, options, ctx) {
  const r = await assembleSessionContext(ctx.workdir)
  if (r.current) await touchLastOpened(ctx.workdir, r.current.目录)
  return { ok: true, output: r.text }
}
