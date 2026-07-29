import { discardBatch } from '../staging/index.js'

/**
 * batch-discard：整批丢弃待定稿批次（批次未入 git，定稿零变化）。
 * 破坏性操作——宿主必须先向作者确认「整批不要」再运行。
 * 契约：纯返回 {ok, output?, error?}。
 */
export async function run(args, options, ctx) {
  const r = await discardBatch(ctx.repoPath)
  if (!r.ok) return { ok: false, error: r.error }
  const lines = [`已丢弃整批 ${r.章数} 章（未定稿，定稿区零变化）。运行 next 从起草细纲重新开始。`]
  if (Array.isArray(r.warnings)) lines.push(...r.warnings.map((w) => `提醒：${w}`))
  return {
    ok: true,
    output: lines.join('\n'),
  }
}
