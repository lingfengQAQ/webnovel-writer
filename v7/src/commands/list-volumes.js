import { OutlineReader } from '../storage/adapters/OutlineReader.js'

/**
 * list-volumes → JSON 数组（卷号、章数范围）
 * 卷号来自 大纲/第NN卷.md，章数范围查询时从 chapters 表算（派生值不物化）。
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const reader = new OutlineReader(ctx.repoPath, ctx.cache)
  const volumes = await reader.listVolumes()

  const out = []
  for (const v of volumes) {
    const range = await ctx.cache.query(
      'SELECT MIN(chapter_num) AS s, MAX(chapter_num) AS e FROM chapters WHERE volume_num = ?',
      [v]
    )
    out.push({ 卷号: v, 起始章: range[0]?.s ?? null, 结束章: range[0]?.e ?? null })
  }
  return { ok: true, output: JSON.stringify(out, null, 2) }
}
