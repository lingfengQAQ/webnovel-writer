import path from 'node:path'
import { assembleReviewInput } from '../review/index.js'
import { writeAtomicBatch } from '../storage/atomic.js'
import { reviewInputFile } from '../review/input-binding.js'
import { acquireContractMutationLock } from '../staging/contract-invalidation.js'

/**
 * review-input <章号> [--draft=<repo相对路径>]：组装两审共用的 ReviewInput 并落
 * 工作区/审稿输入.json（含草稿全文、作品契约版本和完整输入的确定性令牌）。
 * 缺省草稿 工作区/草稿-A.md（与 mechanical-check 一致）。
 * 契约：纯返回 {ok, output?, error?}。
 */
export async function run(args, options, ctx) {
  const chapterNum = parseInt(args[0], 10)
  if (isNaN(chapterNum)) return { ok: false, error: '章号必须是数字' }
  const draftPath =
    options.draft && options.draft !== true ? options.draft : path.join('工作区', '草稿-A.md')

  const lock = await acquireContractMutationLock(ctx.repoPath, '组装审稿输入')
  if (!lock.ok) return { ok: false, error: lock.error }
  try {
    const r = await assembleReviewInput(ctx, { chapterNum, draftPath })
    if (!r.ok) return { ok: false, error: r.error }

    const file = reviewInputFile(r.input)
    await writeAtomicBatch(ctx.repoPath, [file])
    return {
      ok: true,
      output: `已写出 ${file.path}（两审共用同一份输入；含 拟条目变动 ${r.input.拟条目变动.length} 项、相关角色 ${r.input.相关角色.length} 个）`,
    }
  } finally {
    await lock.release()
  }
}
