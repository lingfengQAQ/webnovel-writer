import { TimelineReader } from '../storage/adapters/TimelineReader.js'

// M1 无状态机：当前卷 = chapters 表里最大的卷号（无章则默认第 1 卷）
async function currentVolume(ctx) {
  try {
    const rows = await ctx.cache.query('SELECT MAX(volume_num) AS v FROM chapters')
    return rows[0]?.v || 1
  } catch {
    return 1
  }
}

/**
 * read-timeline [--current-and-prev|--current-volume|--卷=N|--在场=名]
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const reader = new TimelineReader(ctx.repoPath, ctx.cache)

  if (options['current-and-prev']) {
    const cur = await currentVolume(ctx)
    const r = await reader.readVolumeRange(Math.max(1, cur - 1), cur)
    return r.ok ? { ok: true, output: JSON.stringify(r.timeline, null, 2) } : { ok: false, error: r.error }
  }

  if (options['current-volume']) {
    const cur = await currentVolume(ctx)
    const r = await reader.readCurrentVolume(cur)
    return r.ok ? { ok: true, output: JSON.stringify(r.timeline, null, 2) } : { ok: false, error: r.error }
  }

  if (options['卷'] !== undefined && options['卷'] !== true) {
    const vol = parseInt(options['卷'], 10)
    const r = await reader.readVolumeRange(vol, vol)
    return r.ok ? { ok: true, output: JSON.stringify(r.timeline, null, 2) } : { ok: false, error: r.error }
  }

  if (options['在场'] && options['在场'] !== true) {
    const cur = await currentVolume(ctx)
    const rows = await reader.readByParticipant(cur, options['在场'])
    return { ok: true, output: JSON.stringify(rows, null, 2) }
  }

  return {
    ok: false,
    error: '请指定选项（如 --current-and-prev、--current-volume、--卷=N、--在场=名）',
  }
}
