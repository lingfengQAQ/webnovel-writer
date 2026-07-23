import { restageReview } from '../staging/index.js'

/**
 * batch-restage <章号>：受影响章重审完成后收回「待审收」——把 工作区/审稿.md 的新审稿单
 * 搬进批次目录并更新状态。打回章不适用（要重写后 stage-chapter 重新暂存）。
 * 契约：纯返回 {ok, output?, error?}。
 */
export async function run(args, options, ctx) {
  const chapterNum = parseInt(args[0], 10)
  if (isNaN(chapterNum)) return { ok: false, error: '章号必须是数字' }

  const r = await restageReview(ctx.repoPath, chapterNum)
  if (!r.ok) return { ok: false, error: r.error }
  const lines = [`第 ${chapterNum} 章重审完成，已收回「待审收」。批内全部待审收后即可 finalize-batch。`]
  if (r.warnings?.length) lines.push(...r.warnings)
  return { ok: true, output: lines.join('\n') }
}
