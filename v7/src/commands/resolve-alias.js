import { EntityReader } from '../storage/adapters/EntityReader.js'

/**
 * resolve-alias <别名> → 正名
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const alias = args[0]
  if (!alias) {
    return { ok: false, error: '请指定别名' }
  }

  const reader = new EntityReader(ctx.repoPath, ctx.cache)
  const r = await reader.resolveAlias(alias)
  return r.ok ? { ok: true, output: r.canonicalName } : { ok: false, error: r.error }
}
