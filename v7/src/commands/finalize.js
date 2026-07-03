import { finalizeChapter } from '../finalize/index.js'
import { readJsonInput } from '../util/json-input.js'

/**
 * finalize <章号> --payload=<定稿包json路径>：原子 commit（正文入定稿、条目/设定/时间线更新、
 * 章摘要入档、工作区清理）+ 缓存刷新。payload 字段见 finalizeChapter。
 * workspaceFiles 是工作区内文件名;宿主写成「工作区/xx」也接受（此处归一,防静默漏清）。
 * 契约：纯返回 {ok, output?, error?}。
 */
export async function run(args, options, ctx) {
  const chapterNum = parseInt(args[0], 10)
  if (isNaN(chapterNum)) return { ok: false, error: '章号必须是数字' }

  const spec = await readJsonInput(ctx, options.payload ?? options.file, 'payload')
  if (!spec.ok) return { ok: false, error: spec.error }
  const payload = spec.data
  if (payload.chapterNum !== undefined && payload.chapterNum !== chapterNum) {
    return { ok: false, error: `章号不一致：命令行是 ${chapterNum}，payload 里是 ${payload.chapterNum}` }
  }
  if (Array.isArray(payload.workspaceFiles)) {
    payload.workspaceFiles = payload.workspaceFiles.map((f) =>
      String(f).replace(/^工作区[\\/]/, '')
    )
  }

  const r = await finalizeChapter(ctx, { ...payload, chapterNum })
  if (!r.ok) return { ok: false, error: r.error }

  const lines = [`第 ${chapterNum} 章已定稿（commit ${String(r.commitHash || '').slice(0, 8)}）。`]
  if (r.cacheRefresh && r.cacheRefresh.ok === false) {
    lines.push(`缓存刷新失败（下次命令会自动重建）：${(r.cacheRefresh.errors || []).join('；')}`)
  }
  lines.push('继续运行 next 判定下一步。')
  return { ok: true, output: lines.join('\n') }
}
