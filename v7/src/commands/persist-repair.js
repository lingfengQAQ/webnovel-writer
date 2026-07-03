import { persistRepair } from '../state-machine/persist.js'
import { detectParseFailures } from '../state-machine/detectors.js'
import { readJsonInput } from '../util/json-input.js'

/**
 * persist-repair --file=<json>：序0 修复方案回流（{repairs:[{file,content}]}）。
 * 安全网在用例层：只写当前检测失败清单内的文件,内容必须能解析。
 * 契约：纯返回 {ok, output?, error?}。
 */
export async function run(args, options, ctx) {
  const spec = await readJsonInput(ctx, options.file, 'file')
  if (!spec.ok) return { ok: false, error: spec.error }
  const { repairs } = spec.data
  if (!Array.isArray(repairs) || !repairs.length) {
    return { ok: false, error: 'JSON 需含非空数组字段「repairs」（每项 {file, content}）' }
  }
  for (const r of repairs) {
    if (!r || typeof r.file !== 'string' || typeof r.content !== 'string') {
      return { ok: false, error: 'repairs 每项需含字符串字段 file 与 content' }
    }
  }
  const failures = await detectParseFailures(ctx.repoPath)
  const allowedFiles = failures.map((f) => f.file)
  const r = await persistRepair(ctx, { repairs }, { allowedFiles })
  return r.ok ? { ok: true, output: `已修复 ${r.written.join('、')}` } : { ok: false, error: r.error }
}
