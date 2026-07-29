import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/report-style-drift.js'
import { fixtureCtx, repoCtx } from './_helper.js'

// 基线区间已写满的小书：两章定稿，book.yaml 配置区间恰为 1-2
function 齐全区间书() {
  const chapter = (n) =>
    [
      '---',
      `章号: ${n}`,
      `标题: 第${n}章`,
      '卷: 1',
      '字数: 100',
      '章定位: 推进',
      '钩子: 危机钩-强',
      '情绪定位: 铺垫',
      '---',
      '',
      `第${n}章的正文。`,
      '',
    ].join('\n')
  return {
    'book.yaml':
      'spec_version: "7.0"\n书名: 漂移测试书\n类型: 玄幻\n文体基线起: 1\n文体基线止: 2\n',
    '定稿/正文/0001-第1章.md': chapter(1),
    '定稿/正文/0002-第2章.md': chapter(2),
  }
}

test('report-style-drift 基线区间还没写满 → 说明区间与进度，不指向再跑体检', async () => {
  const { ctx, cleanup } = await fixtureCtx()
  try {
    // sample-book 配置区间 1-30，只定稿到第 2 章：此时再跑体检也建不出基线
    const r = await run([], {}, ctx)
    assert.equal(r.ok, false)
    assert.match(r.error, /文体基线尚未建立：配置区间为第 1-30 章/)
    assert.match(r.error, /2\/30 章/)
    assert.match(r.error, /区间内每章都定稿后/)
  } finally {
    await cleanup()
  }
})

test('report-style-drift 区间已写满但没跑过体检 → 指向先跑体检', async () => {
  const { ctx, cleanup } = await repoCtx(null, 齐全区间书())
  try {
    const r = await run([], {}, ctx)
    assert.equal(r.ok, false)
    assert.match(r.error, /请先运行体检/)
    assert.doesNotMatch(r.error, /尚未建立/)
  } finally {
    await cleanup()
  }
})

test('report-style-drift 基线已建立但全书仍在区间内 → 说明暂无近段可比', async () => {
  const { ctx, cleanup } = await repoCtx(null, 齐全区间书())
  try {
    await ctx.cache.query(
      "INSERT INTO fingerprints (chapter_range_start, chapter_range_end, is_baseline, avg_sentence_length, sentence_length_variance, vocabulary_richness, fingerprint_data) VALUES (1, 2, 1, 20.0, 30.0, 0.5, '{}')"
    )
    const r = await run([], {}, ctx)
    assert.equal(r.ok, false)
    assert.match(r.error, /暂无可比的近段/)
    assert.match(r.error, /第 1-2 章/)
  } finally {
    await cleanup()
  }
})

test('report-style-drift 有基线+最近指纹 → 返回含句长方差在内的差异', async () => {
  const { ctx, cleanup } = await fixtureCtx()
  try {
    // 当前配置是 1-30；额外插入章号更晚的陈旧 active 行，确认命令不按“最大历史范围”取基线。
    await ctx.cache.query(
      "INSERT INTO fingerprints (chapter_range_start, chapter_range_end, is_baseline, avg_sentence_length, sentence_length_variance, vocabulary_richness, fingerprint_data) VALUES (1, 30, 1, 20.0, 30.0, 0.5, '{}')"
    )
    await ctx.cache.query(
      "INSERT INTO fingerprints (chapter_range_start, chapter_range_end, is_baseline, avg_sentence_length, sentence_length_variance, vocabulary_richness, fingerprint_data) VALUES (41, 50, 1, 100.0, 100.0, 0.9, '{}')"
    )
    await ctx.cache.query(
      "INSERT INTO fingerprints (chapter_range_start, chapter_range_end, is_baseline, avg_sentence_length, sentence_length_variance, vocabulary_richness, fingerprint_data) VALUES (31, 40, 0, 25.0, 42.5, 0.6, '{}')"
    )
    const r = await run([], {}, ctx)
    assert.equal(r.ok, true)
    const drift = JSON.parse(r.output)
    assert.deepEqual(drift.基线章段, [1, 30])
    assert.ok(Math.abs(drift.avg_sentence_length_delta - 5.0) < 1e-9)
    assert.ok(Math.abs(drift.sentence_length_variance_delta - 12.5) < 1e-9)
  } finally {
    await cleanup()
  }
})
