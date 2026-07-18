import { promises as fs } from 'node:fs'
import path from 'node:path'
import { saveReviews } from '../review/index.js'
import { readJsonInput } from '../util/json-input.js'

/**
 * save-review <章号> --file=<两审json> [--draft=<repo相对路径>]：两审产物入库。
 * JSON：{factCheck|事实审查, editorial|编辑审, mode?, 待确认新专名?, 章摘要?}；
 * 事实审查可带顶层 factChanges，schema 归一化与正式报告必须原样保留。
 * schema 校验 → 合并 → 落 工作区/审稿.md + 评审报告/（原始输出与归一化分存）。
 * 契约：纯返回 {ok, output?, error?}。
 */
export async function run(args, options, ctx) {
  const chapterNum = parseInt(args[0], 10)
  if (isNaN(chapterNum)) return { ok: false, error: '章号必须是数字' }

  const spec = await readJsonInput(ctx, options.file, 'file')
  if (!spec.ok) return { ok: false, error: spec.error }
  const d = spec.data
  const rawFact = d.factCheck ?? d.事实审查
  const rawEdit = d.editorial ?? d.编辑审
  if (!rawFact || !rawEdit) {
    return { ok: false, error: 'JSON 需含「factCheck/事实审查」与「editorial/编辑审」两份审稿报告' }
  }
  const mode = d.mode === 'degraded' ? 'degraded' : 'complete'

  const draftRel =
    options.draft && options.draft !== true ? options.draft : path.join('工作区', '草稿-A.md')
  let draft
  try {
    // resolve 而非 join：--draft 传绝对路径时 join 会拼出坏路径
    draft = await fs.readFile(path.resolve(ctx.repoPath, draftRel), 'utf8')
  } catch (err) {
    return { ok: false, error: `读不到草稿 ${draftRel}：${err.message}（审稿单要附草稿原文）` }
  }

  const r = await saveReviews(ctx, {
    chapterNum,
    rawFact,
    rawEdit,
    mode,
    待确认新专名: Array.isArray(d.待确认新专名) ? d.待确认新专名 : [],
    章摘要: typeof d.章摘要 === 'string' ? d.章摘要 : '',
    draft,
  })
  if (!r.ok) return { ok: false, error: `两审报告未过 schema 校验：\n- ${r.errors.join('\n- ')}` }
  return {
    ok: true,
    output: `审稿单已落 ${path.join('工作区', '审稿.md')}：共 ${r.merged.issues_count} 个问题，${r.merged.blocking_count} 个阻断${r.merged.has_blocking ? '（有阻断，需处理后再定稿）' : ''}`,
  }
}
