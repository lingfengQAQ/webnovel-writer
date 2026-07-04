import { stageChapter } from '../staging/index.js'
import { readJsonInput } from '../util/json-input.js'

/**
 * stage-chapter <章号> --payload=<定稿包json路径>：自动模式暂存一章到 工作区/待定稿/
 * （不定稿不 commit）。前置：本章两审已完成（工作区/审稿.md 在）。payload 同 finalize。
 * 返回携带停止条件判定，宿主按「继续/停」走批次循环。
 * 契约：纯返回 {ok, output?, error?}。
 */
export async function run(args, options, ctx) {
  const chapterNum = parseInt(args[0], 10)
  if (isNaN(chapterNum)) return { ok: false, error: '章号必须是数字' }

  const spec = await readJsonInput(ctx, options.payload ?? options.file, 'payload')
  if (!spec.ok) return { ok: false, error: spec.error }
  const payload = spec.data
  if (Array.isArray(payload.workspaceFiles)) {
    payload.workspaceFiles = payload.workspaceFiles.map((f) =>
      String(f).replace(/^工作区[\\/]/, '')
    )
  }

  const r = await stageChapter(ctx, { chapterNum, payload })
  if (!r.ok) return { ok: false, error: r.error }

  const lines = [`第 ${chapterNum} 章已暂存（批内 ${r.staged} 章，未入档——批量定稿时才 commit）。`]
  if (r.停止.stop) {
    lines.push('批次到此为止，转人工：')
    for (const reason of r.停止.reasons) lines.push(`- ${reason}`)
    lines.push('运行 batch-status 看批次全貌，交作者批量过稿。')
  } else {
    lines.push('停止条件未命中，可继续写批内下一章（运行 next 判定）。')
  }
  return { ok: true, output: lines.join('\n') }
}
