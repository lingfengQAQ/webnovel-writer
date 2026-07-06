import { finalizeChapter } from '../finalize/index.js'
import { readBatch } from '../staging/index.js'
import { readJsonInput } from '../util/json-input.js'

/**
 * finalize <章号> --payload=<定稿包json路径>：原子 commit（正文入定稿、条目/设定/时间线更新、
 * 章摘要入档、工作区清理）+ 缓存刷新。payload 字段见 finalizeChapter（workspaceFiles
 * 的前缀归一与 `..` 防护在本体统一做，壳不再重复）。
 * 有进行中的待定稿批次时拒绝手动定稿（R2）：批次与手动定稿互斥，否则章号双计、
 * finalize-batch 会撞「条目已存在」整批卡死。
 * 契约：纯返回 {ok, output?, error?}。
 */
export async function run(args, options, ctx) {
  const chapterNum = parseInt(args[0], 10)
  if (isNaN(chapterNum)) return { ok: false, error: '章号必须是数字' }

  const batch = await readBatch(ctx.repoPath)
  if (batch.exists) {
    const 尾 = batch.章列表[batch.章列表.length - 1].章号
    const inBatch = batch.章列表.some((r) => r.章号 === chapterNum)
    return {
      ok: false,
      error: inBatch
        ? `第 ${chapterNum} 章已在待定稿批次中（批内第 ${batch.起章}-${尾} 章）。批内章请用 finalize-batch 批量转正；整批不要就用 batch-discard 丢弃。`
        : `有进行中的待定稿批次（第 ${batch.起章}-${尾} 章），手动定稿会造成章号错位。请先用 finalize-batch 转正批次，或 batch-discard 丢弃批次，再手动定稿。`,
    }
  }

  const spec = await readJsonInput(ctx, options.payload ?? options.file, 'payload')
  if (!spec.ok) return { ok: false, error: spec.error }
  const payload = spec.data
  if (payload.chapterNum !== undefined && payload.chapterNum !== chapterNum) {
    return { ok: false, error: `章号不一致：命令行是 ${chapterNum}，payload 里是 ${payload.chapterNum}` }
  }

  const r = await finalizeChapter(ctx, { ...payload, chapterNum })
  if (!r.ok) return { ok: false, error: r.error }

  const lines = [`第 ${chapterNum} 章已定稿（commit ${String(r.commitHash || '').slice(0, 8)}）。`]
  if (r.cacheRefresh && r.cacheRefresh.ok === false) {
    lines.push(`缓存刷新失败（下次命令会自动重建）：${(r.cacheRefresh.errors || []).join('；')}`)
  }
  for (const w of r.warnings || []) lines.push(w)
  lines.push('继续运行 next 判定下一步。')
  return { ok: true, output: lines.join('\n') }
}
