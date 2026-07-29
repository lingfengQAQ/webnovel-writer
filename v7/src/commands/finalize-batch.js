import { finalizeBatch } from '../staging/index.js'
import { parsePositiveInt } from '../util/positive-int.js'

/**
 * finalize-batch [--until=<章号>]：作者敲定后按章号升序逐章原子定稿（每章独立 commit，
 * 中途失败停在该章、已入档保留）。批内全部章须为「待审收」。全批转正后随批跑一次体检。
 * 契约：纯返回 {ok, output?, error?}。
 */
export async function run(args, options, ctx) {
  let until
  if (options.until !== undefined) {
    until = parsePositiveInt(options.until)
    if (until === null) return { ok: false, error: '--until 需要章号数字（正整数）' }
  }

  const r = await finalizeBatch(ctx, { until })
  if (!r.ok) {
    const head = r.已入档?.length
      ? `已入档 ${r.已入档.length} 章（${r.已入档.map((x) => `第 ${x.章号} 章`).join('、')}）。`
      : ''
    return { ok: false, error: `${head}${r.error}` }
  }

  const lines = [
    `批量定稿完成：${r.已入档.map((x) => `第 ${x.章号} 章（${String(x.commit || '').slice(0, 8)}）`).join('、')}。`,
  ]
  if (r.剩余 > 0) lines.push(`批内还剩 ${r.剩余} 章未转正（--until 截断），随时可继续 finalize-batch。`)
  if (r.体检) lines.push(r.体检)
  lines.push('继续运行 next 判定下一步。')
  return { ok: true, output: lines.join('\n') }
}
