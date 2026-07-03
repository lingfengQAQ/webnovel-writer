import { persistVolumeReview } from '../state-machine/persist.js'
import { readJsonInput } from '../util/json-input.js'

/**
 * persist-volume-review --file=<json>：序4 卷复盘产物回流
 * （{卷号, 卷摘要, 下卷卷纲?, 伏笔条目?} → 卷摘要/下卷卷纲/伏笔条目落盘）。
 * 契约：纯返回 {ok, output?, error?}。
 */
export async function run(args, options, ctx) {
  const spec = await readJsonInput(ctx, options.file, 'file')
  if (!spec.ok) return { ok: false, error: spec.error }
  const { 卷号, 卷摘要, 下卷卷纲, 伏笔条目 } = spec.data
  if (!Number.isInteger(卷号) || 卷号 < 1) return { ok: false, error: 'JSON 需含正整数字段「卷号」' }
  if (typeof 卷摘要 !== 'string' || !卷摘要.trim()) {
    return { ok: false, error: 'JSON 需含非空字符串字段「卷摘要」' }
  }
  if (伏笔条目 !== undefined && !Array.isArray(伏笔条目)) {
    return { ok: false, error: '「伏笔条目」需是数组（每项 {id, frontMatter, body}）' }
  }
  const r = await persistVolumeReview(ctx, { 卷号, 卷摘要, 下卷卷纲, 伏笔条目: 伏笔条目 || [] })
  return r.ok ? { ok: true, output: `已写出 ${r.written.join('、')}` } : { ok: false, error: r.error }
}
