import { rejectFrom } from '../staging/index.js'
import { parsePositiveInt } from '../util/positive-int.js'

/**
 * batch-reject <章号>：打回批内第 K 章（工件清空待重写），K 之后的章全部标记「受影响」
 * （工件保留，需重审）。重写走写章流程后 stage-chapter 覆盖；受影响章重审后 batch-restage。
 * 契约：纯返回 {ok, output?, error?}。
 */
export async function run(args, options, ctx) {
  const chapterNum = parsePositiveInt(args[0])
  if (chapterNum === null) return { ok: false, error: '章号必须是数字（正整数）' }

  const r = await rejectFrom(ctx.repoPath, chapterNum)
  if (!r.ok) return { ok: false, error: r.error }

  const lines = [`第 ${chapterNum} 章已打回（批内工件清空，重写后用 stage-chapter 重新暂存）。`]
  if (r.受影响.length) {
    lines.push(
      `第 ${r.受影响.join('、')} 章标记为「受影响」：先运行 batch-status --json 读取对应章的「草稿路径」，再依次运行 review-input <章号> --draft=<草稿路径>、save-review <章号> --file=<json路径> --draft=<草稿路径>，最后运行 batch-restage <章号> 收回「待审收」；两条审稿命令都不能默认使用草稿-A.md。`
    )
  }
  return { ok: true, output: lines.join('\n') }
}
