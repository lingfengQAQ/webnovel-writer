import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/report-style-drift.js'
import { fixtureCtx } from './_helper.js'

test('report-style-drift 无指纹数据 → 友好错误（M1 边界，不做特征提取）', async () => {
  const { ctx, cleanup } = await fixtureCtx()
  try {
    const r = await run([], {}, ctx)
    assert.equal(r.ok, false)
    assert.match(r.error, /指纹|体检/)
  } finally {
    await cleanup()
  }
})

test('report-style-drift 有基线+最近指纹 → 返回差异（测对比逻辑）', async () => {
  const { ctx, cleanup } = await fixtureCtx()
  try {
    // M1 不做特征提取，手工插入基线 + 最近指纹，验证对比逻辑
    await ctx.cache.query(
      "INSERT INTO fingerprints (chapter_range_start, chapter_range_end, is_baseline, avg_sentence_length, vocabulary_richness, fingerprint_data) VALUES (1, 30, 1, 20.0, 0.5, '{}')"
    )
    await ctx.cache.query(
      "INSERT INTO fingerprints (chapter_range_start, chapter_range_end, is_baseline, avg_sentence_length, vocabulary_richness, fingerprint_data) VALUES (31, 40, 0, 25.0, 0.6, '{}')"
    )
    const r = await run([], {}, ctx)
    assert.equal(r.ok, true)
    const drift = JSON.parse(r.output)
    assert.ok(Math.abs(drift.avg_sentence_length_delta - 5.0) < 1e-9)
  } finally {
    await cleanup()
  }
})
