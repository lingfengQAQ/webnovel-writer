import { EntityReader } from '../storage/adapters/EntityReader.js'

/**
 * list-characters [--status=<状态>] → JSON 数组（正名、状态、位置）
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const reader = new EntityReader(ctx.repoPath, ctx.cache)
  const filter = {}
  if (options.status && options.status !== true) filter.status = options.status
  const rows = await reader.listCharacters(filter)
  return { ok: true, output: JSON.stringify(rows, null, 2) }
}
