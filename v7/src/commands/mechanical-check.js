import path from 'node:path'
import { mechanicalCheck } from '../mechanical-check/index.js'

/**
 * mechanical-check <章号> [--draft=<path>] → JSON {pass, issues, candidates}（机检，零 token）
 * 默认草稿 工作区/草稿-A.md。契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const chapterNum = parseInt(args[0], 10)
  if (isNaN(chapterNum)) {
    return { ok: false, error: '章号必须是数字' }
  }
  const draftPath =
    options.draft && options.draft !== true
      ? path.resolve(ctx.repoPath, options.draft)
      : path.join(ctx.repoPath, '工作区', '草稿-A.md')

  const r = await mechanicalCheck(ctx, { chapterNum, draftPath })
  if (!r.ok) return { ok: false, error: r.error }
  return {
    ok: true,
    output: JSON.stringify({ pass: r.pass, issues: r.issues, candidates: r.candidates }, null, 2),
  }
}
