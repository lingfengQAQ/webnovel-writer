import { persistDraftOutline } from '../state-machine/persist.js'
import { readJsonInput } from '../util/json-input.js'

/**
 * persist-outline --file=<json>：序6 细纲产物回流（{细纲} → 工作区/细纲.md）。
 * 契约：纯返回 {ok, output?, error?}。
 */
export async function run(args, options, ctx) {
  const spec = await readJsonInput(ctx, options.file, 'file')
  if (!spec.ok) return { ok: false, error: spec.error }
  const { 细纲 } = spec.data
  if (typeof 细纲 !== 'string' || !细纲.trim()) {
    return { ok: false, error: 'JSON 需含非空字符串字段「细纲」' }
  }
  const r = await persistDraftOutline(ctx, { 细纲 })
  return r.ok ? { ok: true, output: `已写出 ${r.written.join('、')}` } : { ok: false, error: r.error }
}
