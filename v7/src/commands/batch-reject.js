import { rejectFrom } from '../staging/index.js'

/**
 * batch-reject <章号>：打回批内第 K 章（工件清空待重写），K 之后的章全部标记「受影响」
 * （工件保留，需重审）。重写走写章流程后 stage-chapter 覆盖；受影响章重审后 batch-restage。
 * 契约：纯返回 {ok, output?, error?}。
 */
export async function run(args, options, ctx) {
  const chapterNum = parseInt(args[0], 10)
  if (isNaN(chapterNum)) return { ok: false, error: '章号必须是数字' }

  const r = await rejectFrom(ctx.repoPath, chapterNum)
  if (!r.ok) return { ok: false, error: r.error }

  const lines = [`第 ${chapterNum} 章已打回（批内工件清空，重写后用 stage-chapter 重新暂存）。`]
  if (r.受影响.length) {
    lines.push(
      `第 ${r.受影响.join('、')} 章标记为「受影响」：前章重写会改变它们依赖的事实，重跑两审并 save-review 后运行 batch-restage <章号> 收回「待审收」。`
    )
  }
  return { ok: true, output: lines.join('\n') }
}
