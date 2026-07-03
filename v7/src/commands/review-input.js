import path from 'node:path'
import { assembleReviewInput } from '../review/index.js'
import { writeAtomicBatch } from '../storage/atomic.js'

/**
 * review-input <章号> [--draft=<repo相对路径>]：组装两审共用的 ReviewInput 并落
 * 工作区/审稿输入.json（含草稿全文,大 JSON 走文件,宿主用读文件工具吃）。
 * 缺省草稿 工作区/草稿-A.md（与 mechanical-check 一致）。
 * 契约：纯返回 {ok, output?, error?}。
 */
export async function run(args, options, ctx) {
  const chapterNum = parseInt(args[0], 10)
  if (isNaN(chapterNum)) return { ok: false, error: '章号必须是数字' }
  const draftPath =
    options.draft && options.draft !== true ? options.draft : path.join('工作区', '草稿-A.md')

  const r = await assembleReviewInput(ctx, { chapterNum, draftPath })
  if (!r.ok) return { ok: false, error: r.error }

  const rel = path.join('工作区', '审稿输入.json')
  await writeAtomicBatch(ctx.repoPath, [{ path: rel, content: JSON.stringify(r.input, null, 2) }])
  return {
    ok: true,
    output: `已写出 ${rel}（两审共用同一份输入；含 拟条目变动 ${r.input.拟条目变动.length} 项、相关角色 ${r.input.相关角色.length} 个）`,
  }
}
