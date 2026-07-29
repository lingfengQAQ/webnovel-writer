import path from 'node:path'
import { saveReviews } from '../review/index.js'
import { readJsonInput } from '../util/json-input.js'
import { formatFactChangeDecisionRequests } from '../knowledge/fact-changes.js'
import { parsePositiveInt } from '../util/positive-int.js'

/**
 * save-review <章号> --file=<两审json> [--draft=<repo相对路径>]：两审产物入库。
 * JSON：{审稿输入令牌, factCheck|事实审查, editorial|编辑审, mode?, 待确认新专名?, 章摘要?}；
 * 外层与两份报告必须原样回传 ReviewInput.审稿输入令牌，禁止重算。
 * 事实审查可带顶层 factChanges，schema 归一化与正式报告必须原样保留。
 * schema 校验 → 合并 → 落 工作区/审稿.md + 评审报告/（原始输出与归一化分存）。
 * 契约：纯返回 {ok, output?, error?}。
 */
export async function run(args, options, ctx) {
  const chapterNum = parsePositiveInt(args[0])
  if (chapterNum === null) return { ok: false, error: '章号必须是数字（正整数）' }

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
  const r = await saveReviews(ctx, {
    chapterNum,
    rawFact,
    rawEdit,
    reviewInputToken: d.审稿输入令牌,
    mode,
    待确认新专名: Array.isArray(d.待确认新专名) ? d.待确认新专名 : [],
    章摘要: typeof d.章摘要 === 'string' ? d.章摘要 : '',
    draftPath: draftRel,
  })
  if (!r.ok) return { ok: false, error: `两审报告未保存：\n- ${r.errors.join('\n- ')}` }
  const lines = [
    `审稿单已落 ${path.join('工作区', '审稿.md')}：共 ${r.merged.issues_count} 个问题，${r.merged.blocking_count} 个阻断${r.merged.has_blocking ? '（有阻断，需处理后再定稿）' : ''}`,
  ]
  if (Array.isArray(r.warnings)) lines.push(...r.warnings.map((w) => `提醒：${w}`))
  const factDecisionRequest = formatFactChangeDecisionRequests(
    r.merged.事实审查?.factChanges
  )
  if (factDecisionRequest) lines.push(factDecisionRequest)
  return {
    ok: true,
    output: lines.join('\n'),
  }
}
