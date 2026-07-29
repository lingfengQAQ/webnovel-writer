import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { runHealthCheck } from '../../src/health-check/index.js'
import { repoCtx } from '../commands/_helper.js'

// 专用小书 fixture：5 章定稿，「空气仿佛凝固」全书 12 次跨 5 章；基线 1-2 / 周期 3 → 近段 3-5
function chapterFile(num, { 时间 = `1023春月初${num}`, imagery = 0 } = {}) {
  const fm = [
    `章号: ${num}`,
    `标题: 第${num}章`,
    '卷: 1',
    '视角: 林晚',
    ...(时间 ? [`书内时间: ${时间}`] : []),
    '字数: 100',
    '章定位: 推进',
    '钩子: 危机钩-强',
    '情绪定位: 铺垫',
  ]
  const 意象 = '空气仿佛凝固，'.repeat(imagery)
  const body = [
    `林晚在旧案卷宗里翻到了第${num}条线索。`,
    `${意象}殿内落针可闻。`,
    '线索到这里又断了，她收起卷宗望向窗外。',
  ].join('\n')
  return `---\n${fm.join('\n')}\n---\n\n${body}\n`
}

const timeline = (nums) =>
  [
    '| 章 | 书内时间 | 一句话事件 | 在场 |',
    '|----|----------|------------|------|',
    ...nums.map((n) => `| ${n} | 1023春月初${n} | 第${n}章事件 | 林晚 |`),
  ].join('\n') + '\n'

function fixtureFiles({ bookYaml, chapters = {}, timelineChapters = [1, 2, 3, 4, 5] } = {}) {
  const imageryPlan = { 1: 3, 2: 3, 3: 2, 4: 2, 5: 2 }
  const files = {
    'book.yaml':
      bookYaml ??
      'spec_version: "7.0"\n书名: 体检测试书\n类型: 玄幻\n每章目标字数: 3000\n卷规模: 40\n文体基线起: 1\n文体基线止: 2\n体检周期: 3\n',
    '定稿/设定/名册.md':
      '| 正名 | 别名 | 类型 | 首现章 |\n|--|--|--|--|\n| 林晚 | 晚晚 | character | 1 |\n',
    '定稿/设定/时间线/第01卷.md': timeline(timelineChapters),
  }
  for (let n = 1; n <= 5; n++) {
    files[`定稿/正文/000${n}-第${n}章.md`] = chapterFile(n, {
      imagery: imageryPlan[n],
      ...(chapters[n] || {}),
    })
  }
  return files
}

test('体检 报告四节：高频意象/句式/指纹漂移/缺时间锚点（AC1 后半 + AC2 前半）', async () => {
  const { ctx, cleanup } = await repoCtx(null, fixtureFiles())
  try {
    const r = await runHealthCheck(ctx)
    assert.equal(r.ok, true, r.error)
    assert.equal(r.maxChapter, 5)
    const report = await fs.readFile(r.filePath, 'utf8')
    assert.match(report, /## 高频意象（跨章）/)
    assert.match(report, /「空气仿佛凝固」：全书 12 次，5 章出现/)
    assert.match(report, /## 句式体检（第 3-5 章）/)
    assert.match(report, /句长方差/)
    assert.match(report, /段落长度分布/)
    assert.match(report, /高频句式开头/)
    assert.match(report, /## 文体指纹漂移/)
    assert.match(report, /基线（第 1-2 章）/)
    assert.match(report, /近段（第 3-5 章）/)
    assert.match(report, /漂移：平均句长/)
    assert.match(report, /## 缺时间锚点/)
    assert.match(report, /无（每章都有书内时间/)
    // meta：意象清单入缓存、体检章号照记
    const imagery = JSON.parse(
      (await ctx.cache.query("SELECT value FROM meta WHERE key = 'imagery_top'"))[0].value
    )
    assert.equal(imagery[0].phrase, '空气仿佛凝固')
    assert.equal(imagery[0].count, 12)
    const last = await ctx.cache.query(
      "SELECT value FROM meta WHERE key = 'last_health_check_chapter'"
    )
    assert.equal(last[0].value, '5')
  } finally {
    await cleanup()
  }
})

test('体检 指纹两行入表；删缓存全量重建后再体检逐字段一致（AC3）', async () => {
  const { ctx, cleanup } = await repoCtx(null, fixtureFiles())
  try {
    const r1 = await runHealthCheck(ctx)
    assert.equal(r1.ok, true, r1.error)
    const q =
      'SELECT * FROM fingerprints ORDER BY is_baseline DESC, chapter_range_start, chapter_range_end'
    const rows1 = await ctx.cache.query(q)
    assert.deepEqual(
      rows1.map((x) => [x.chapter_range_start, x.chapter_range_end, x.is_baseline]),
      [
        [1, 2, 1],
        [3, 5, 0],
      ]
    )
    // 全量重建：指纹表清空（重建器不填），meta 跨重建保留
    const rb = await ctx.cache.rebuildFromSource(ctx.repoPath)
    assert.equal(rb.ok, true, rb.errors?.join('；'))
    assert.equal((await ctx.cache.query('SELECT COUNT(*) AS c FROM fingerprints'))[0].c, 0)
    const r2 = await runHealthCheck(ctx)
    assert.equal(r2.ok, true, r2.error)
    const rows2 = await ctx.cache.query(q)
    assert.deepStrictEqual(rows2, rows1)
  } finally {
    await cleanup()
  }
})

test('体检 缺时间锚点：缺「书内时间」与时间线漏行各列出章号（AC5）', async () => {
  const files = fixtureFiles({
    chapters: { 3: { 时间: null, imagery: 2 } },
    timelineChapters: [1, 2, 3, 5],
  })
  const { ctx, cleanup } = await repoCtx(null, files)
  try {
    const r = await runHealthCheck(ctx)
    assert.equal(r.ok, true, r.error)
    const report = await fs.readFile(r.filePath, 'utf8')
    assert.match(report, /- 第 3 章：front matter 无「书内时间」/)
    assert.match(report, /- 第 4 章：时间线没有这章的行/)
    assert.deepEqual(r.data.缺时间锚点, [
      { 章: 3, 缺: ['front matter 无「书内时间」'] },
      { 章: 4, 缺: ['时间线没有这章的行'] },
    ])
  } finally {
    await cleanup()
  }
})

test('体检 返回结构化 data，形状稳定（AC7，M6 对接面）', async () => {
  const { ctx, cleanup } = await repoCtx(null, fixtureFiles())
  try {
    const { data: d, ok, error } = await runHealthCheck(ctx)
    assert.equal(ok, true, error)
    assert.ok(Array.isArray(d.高频意象) && d.高频意象.length > 0)
    for (const k of ['phrase', 'count', 'chapterCount', 'firstChapter', 'lastChapter']) {
      assert.ok(k in d.高频意象[0], `高频意象缺 ${k}`)
    }
    assert.deepEqual(d.句式.窗口, [3, 5])
    assert.equal(typeof d.句式.平均句长, 'number')
    assert.equal(typeof d.句式.句长方差, 'number')
    assert.ok(d.句式.段落分布)
    assert.ok(Array.isArray(d.句式.高频开头))
    assert.deepEqual(d.指纹.基线.范围, [1, 2])
    assert.deepEqual(d.指纹.近段.范围, [3, 5])
    for (const k of ['平均句长', '句长方差', '平均段长', '词汇丰富度']) {
      assert.equal(typeof d.指纹.delta[k], 'number', `delta 缺 ${k}`)
    }
    assert.ok(Array.isArray(d.缺时间锚点))
    assert.ok(Array.isArray(d.悬了太久))
    assert.ok(Array.isArray(d.条目活跃率))
    assert.equal(typeof d.连续弱钩, 'number')
  } finally {
    await cleanup()
  }
})

test('体检 单项失败不炸整体：正文文件读不到 → 三统计节如实降级，报告照落、章号照记', async () => {
  const { ctx, cleanup } = await repoCtx(null, fixtureFiles())
  try {
    await fs.rm(path.join(ctx.repoPath, '定稿', '正文', '0005-第5章.md'))
    const r = await runHealthCheck(ctx)
    assert.equal(r.ok, true, r.error)
    const report = await fs.readFile(r.filePath, 'utf8')
    assert.match(report, /该项计算失败/)
    assert.match(report, /## 缺时间锚点/)
    assert.equal(r.data.高频意象, null)
    assert.equal(r.data.指纹, null)
    const last = await ctx.cache.query(
      "SELECT value FROM meta WHERE key = 'last_health_check_chapter'"
    )
    assert.equal(last[0].value, '5')
  } finally {
    await cleanup()
  }
})

test('体检 配置基线区间未齐 → 不写部分前缀基线，也不比较漂移', async () => {
  const files = fixtureFiles({
    bookYaml:
      'spec_version: "7.0"\n书名: 体检测试书\n类型: 玄幻\n每章目标字数: 3000\n卷规模: 40\n文体基线起: 1\n文体基线止: 30\n体检周期: 50\n',
  })
  const { ctx, cleanup } = await repoCtx(null, files)
  try {
    const r = await runHealthCheck(ctx)
    assert.equal(r.ok, true, r.error)
    const rows = await ctx.cache.query('SELECT * FROM fingerprints WHERE is_baseline = 1')
    assert.equal(rows.length, 0)
    const report = await fs.readFile(r.filePath, 'utf8')
    assert.match(report, /文体基线尚未建立.*第 1-30 章.*5\/30 章/)
    assert.equal(r.data.指纹, null)
  } finally {
    await cleanup()
  }
})

test('体检 完整基线恰与近段重合 → 只写配置区间的基线行', async () => {
  const files = fixtureFiles({
    bookYaml:
      'spec_version: "7.0"\n书名: 体检测试书\n类型: 玄幻\n文体基线起: 1\n文体基线止: 5\n体检周期: 50\n',
  })
  const { ctx, cleanup } = await repoCtx(null, files)
  try {
    const r = await runHealthCheck(ctx)
    assert.equal(r.ok, true, r.error)
    const rows = await ctx.cache.query('SELECT * FROM fingerprints')
    assert.equal(rows.length, 1)
    assert.deepEqual(
      [rows[0].chapter_range_start, rows[0].chapter_range_end, rows[0].is_baseline],
      [1, 5, 1]
    )
    const report = await fs.readFile(r.filePath, 'utf8')
    assert.match(report, /基线与近段重合，暂无漂移可比/)
    assert.equal(r.data.指纹.近段, null)
    assert.equal(r.data.指纹.delta, null)
  } finally {
    await cleanup()
  }
})

test('体检 配置切换到未齐区间 → 移除旧 active 基线，不回退历史范围', async () => {
  const { ctx, cleanup } = await repoCtx(null, fixtureFiles())
  try {
    const first = await runHealthCheck(ctx)
    assert.equal(first.ok, true, first.error)
    assert.deepEqual(
      (await ctx.cache.query('SELECT chapter_range_start, chapter_range_end FROM fingerprints WHERE is_baseline = 1'))
        .map((row) => [row.chapter_range_start, row.chapter_range_end]),
      [[1, 2]]
    )

    await fs.writeFile(
      path.join(ctx.repoPath, 'book.yaml'),
      'spec_version: "7.0"\n书名: 体检测试书\n类型: 玄幻\n文体基线起: 1\n文体基线止: 6\n体检周期: 3\n',
      'utf8'
    )
    const second = await runHealthCheck(ctx)
    assert.equal(second.ok, true, second.error)
    assert.equal(
      (await ctx.cache.query('SELECT COUNT(*) AS c FROM fingerprints WHERE is_baseline = 1'))[0].c,
      0
    )
    assert.equal(second.data.指纹, null)
  } finally {
    await cleanup()
  }
})

test('体检 配置区间中间缺章 → 即使止章已定稿也不建立基线', async () => {
  const files = fixtureFiles({
    bookYaml:
      'spec_version: "7.0"\n书名: 体检测试书\n类型: 玄幻\n文体基线起: 1\n文体基线止: 3\n体检周期: 3\n',
  })
  delete files['定稿/正文/0002-第2章.md']
  const { ctx, cleanup } = await repoCtx(null, files)
  try {
    const r = await runHealthCheck(ctx)
    assert.equal(r.ok, true, r.error)
    assert.equal(
      (await ctx.cache.query('SELECT COUNT(*) AS c FROM fingerprints WHERE is_baseline = 1'))[0].c,
      0
    )
    const report = await fs.readFile(r.filePath, 'utf8')
    assert.match(report, /文体基线尚未建立.*2\/3 章/)
    assert.equal(r.data.指纹, null)
  } finally {
    await cleanup()
  }
})

test('体检 正文读不到 → 保留已建立的基线，恢复后结果与首次逐字段一致', async () => {
  const { ctx, cleanup } = await repoCtx(null, fixtureFiles())
  try {
    const 首次 = await runHealthCheck(ctx)
    assert.equal(首次.ok, true, 首次.error)
    const q =
      'SELECT * FROM fingerprints ORDER BY is_baseline DESC, chapter_range_start, chapter_range_end'
    const rows1 = await ctx.cache.query(q)

    // 缓存里仍有第 5 章的行，文件没了 → 语料读取失败，三统计降级
    const 第5章 = path.join(ctx.repoPath, '定稿', '正文', '0005-第5章.md')
    const 原文 = await fs.readFile(第5章, 'utf8')
    await fs.rm(第5章)
    const 降级 = await runHealthCheck(ctx)
    assert.equal(降级.ok, true, 降级.error)
    assert.equal(降级.data.指纹, null)
    assert.deepEqual(
      (
        await ctx.cache.query(
          'SELECT chapter_range_start, chapter_range_end FROM fingerprints WHERE is_baseline = 1'
        )
      ).map((row) => [row.chapter_range_start, row.chapter_range_end]),
      [[1, 2]],
      '语料读取失败不该连带清掉基线'
    )

    await fs.writeFile(第5章, 原文, 'utf8')
    const 恢复 = await runHealthCheck(ctx)
    assert.equal(恢复.ok, true, 恢复.error)
    assert.deepStrictEqual(await ctx.cache.query(q), rows1)
  } finally {
    await cleanup()
  }
})

test('体检 配置切换到另一个齐全区间 → 旧基线行移除，新基线落新章段', async () => {
  const { ctx, cleanup } = await repoCtx(null, fixtureFiles())
  try {
    const 首次 = await runHealthCheck(ctx)
    assert.equal(首次.ok, true, 首次.error)
    assert.deepEqual(首次.data.指纹.基线.范围, [1, 2])

    await fs.writeFile(
      path.join(ctx.repoPath, 'book.yaml'),
      'spec_version: "7.0"\n书名: 体检测试书\n类型: 玄幻\n文体基线起: 2\n文体基线止: 4\n体检周期: 3\n',
      'utf8'
    )
    const 切换后 = await runHealthCheck(ctx)
    assert.equal(切换后.ok, true, 切换后.error)
    assert.deepEqual(
      (
        await ctx.cache.query(
          'SELECT chapter_range_start, chapter_range_end FROM fingerprints WHERE is_baseline = 1'
        )
      ).map((row) => [row.chapter_range_start, row.chapter_range_end]),
      [[2, 4]]
    )
    assert.deepEqual(切换后.data.指纹.基线.范围, [2, 4])
    assert.deepEqual(切换后.data.指纹.近段.范围, [3, 5])
    const report = await fs.readFile(切换后.filePath, 'utf8')
    assert.match(report, /基线（第 2-4 章）/)
  } finally {
    await cleanup()
  }
})
