import { SecretReader } from '../storage/adapters/SecretReader.js'

/**
 * read-secret <ID> [--基本信息|--内容]（默认基本信息）
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const id = args[0]
  if (!id) {
    return { ok: false, error: '请指定信息差 ID（如 信息差-001）' }
  }

  const reader = new SecretReader(ctx.repoPath, ctx.cache)

  if (options['内容']) {
    const r = await reader.readContent(id)
    return r.ok ? { ok: true, output: r.content } : { ok: false, error: r.error }
  }

  // 默认 / --基本信息
  const r = await reader.readBasicInfo(id)
  return r.ok ? { ok: true, output: JSON.stringify(r.data, null, 2) } : { ok: false, error: r.error }
}
