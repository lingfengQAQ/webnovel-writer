/**
 * report-style-drift → 当前指纹 vs 基线的差异
 * M1 边界：能读 fingerprints 表并对比基线，但不实现特征提取（表由 M3+ 体检填充）。
 * 表为空 → 返回友好中文错误。契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const baseline = await ctx.cache.query(
    'SELECT * FROM fingerprints WHERE is_baseline = 1 ORDER BY chapter_range_end DESC LIMIT 1'
  )
  const recent = await ctx.cache.query(
    'SELECT * FROM fingerprints WHERE is_baseline = 0 ORDER BY chapter_range_end DESC LIMIT 1'
  )

  if (baseline.length === 0 || recent.length === 0) {
    return {
      ok: false,
      error: '缺少指纹数据：fingerprints 表为空或不全，请先运行体检以提取文体特征（M1 不实现特征提取）。',
    }
  }

  const b = baseline[0]
  const r = recent[0]
  const drift = {
    基线章段: [b.chapter_range_start, b.chapter_range_end],
    最近章段: [r.chapter_range_start, r.chapter_range_end],
    avg_sentence_length_delta: (r.avg_sentence_length ?? 0) - (b.avg_sentence_length ?? 0),
    avg_paragraph_length_delta: (r.avg_paragraph_length ?? 0) - (b.avg_paragraph_length ?? 0),
    vocabulary_richness_delta: (r.vocabulary_richness ?? 0) - (b.vocabulary_richness ?? 0),
  }
  return { ok: true, output: JSON.stringify(drift, null, 2) }
}
