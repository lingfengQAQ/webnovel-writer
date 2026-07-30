import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assembleReviewInput } from '../../src/review/index.js'
import { makeGitBook } from '../state-machine/_helper.js'
import { createDegradationCollector } from '../../src/util/degradation.js'
import { ChapterReader } from '../../src/storage/adapters/ChapterReader.js'

/**
 * P1-F6 审稿输入链：故障注入——cache.query 对 secrets/entities/threads 恒抛。
 * 期望：ReviewInput 带 degraded（bind 前注入、令牌覆盖）；角色卡读失败的单卡跳员也定位到具体角色。
 * 良性降级（缓存坏、文件在）不产生事件（狼来了防护）。
 */

const charCard = (name, 境界) => `---\n姓名: ${name}\n状态: 在世\n位置: 青云宗\n境界: ${境界}\n---\n## 设定\n。`

async function makeReviewBook(files = {}) {
  return makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n卷规模: 40\n',
    '定稿/正文/0001-起.md': '---\n章号: 1\n标题: 起\n卷: 1\n---\n过去的事。',
    '定稿/设定/角色/林晚.md': charCard('林晚', '练气三层'),
    '定稿/设定/时间线/第01卷.md': '| 章 | 一句话事件 |\n| --- | --- |\n| 1 | 林晚得玉佩 |\n',
    '工作区/细纲.md': '## 本章要写到的事\n林晚突破练气四层。\n',
    '工作区/草稿.md': '林晚运转功法，突破到练气四层。她握紧青霜剑。',
    ...files,
  })
}

function breakQueries(cache, pattern) {
  const orig = cache.query.bind(cache)
  cache.query = async (sql, params) => {
    if (String(sql).includes(pattern)) {
      const err = new Error('注入：SQLITE_CORRUPT 模拟缓存损坏')
      err.code = 'SQLITE_CORRUPT'
      throw err
    }
    return orig(sql, params)
  }
}

test('审稿输入链：secrets/entities/threads 缓存损坏 → ReviewInput 带 degraded 且令牌覆盖', async () => {
  const { ctx, cleanup } = await makeReviewBook()
  try {
    ctx.degradation = createDegradationCollector()
    breakQueries(ctx.cache, 'FROM secrets')
    const origEntities = ctx.cache.query.bind(ctx.cache)
    const breaker = ctx.cache.query
    ctx.cache.query = async (sql, params) => {
      if (String(sql).includes('FROM entities') || String(sql).includes('FROM threads')) {
        const err = new Error('注入：SQLITE_CORRUPT 模拟缓存损坏')
        err.code = 'SQLITE_CORRUPT'
        throw err
      }
      return breaker(sql, params)
    }

    const r = await assembleReviewInput(ctx, { chapterNum: 2, draftPath: '工作区/草稿.md' })
    assert.equal(r.ok, true, r.error)
    const events = r.input.degraded || []
    assert.ok(events.length >= 3, `至少三处降级事件，实得 ${events.length}`)
    const sites = events.map((e) => e.site)
    assert.ok(sites.includes('SecretReader.listUnrevealed'), '信息差点位在')
    assert.ok(sites.includes('assembleReviewInput.名册'), '名册点位在')
    assert.ok(sites.includes('assembleReviewInput.相关条目'), '相关条目点位在')
    assert.match(r.input.审稿输入令牌, /^sha256:[0-9a-f]{64}$/, '令牌照常签发')
  } finally {
    await cleanup()
  }
})

test('审稿输入链：角色卡读失败 → degraded 定位到具体角色名', async () => {
  const { ctx, cleanup } = await makeReviewBook({
    '定稿/设定/角色/残卡.md': '---\n坏: yaml: :\n---\n无法解析的卡。',
  })
  try {
    ctx.degradation = createDegradationCollector()
    const r = await assembleReviewInput(ctx, { chapterNum: 2, draftPath: '工作区/草稿.md' })
    assert.equal(r.ok, true, r.error)
    const cardEvent = (r.input.degraded || []).find(
      (e) => e.site === 'assembleReviewInput.相关角色(单卡)'
    )
    assert.ok(cardEvent, '单卡读失败必须有 degraded 事件')
    assert.match(cardEvent.reason, /残卡/, '原因定位到具体角色文件名')
  } finally {
    await cleanup()
  }
})

test('审稿输入链：无故障 → degraded 键不出现（旧断言零改动）', async () => {
  const { ctx, cleanup } = await makeReviewBook()
  try {
    ctx.degradation = createDegradationCollector()
    const r = await assembleReviewInput(ctx, { chapterNum: 2, draftPath: '工作区/草稿.md' })
    assert.equal(r.ok, true, r.error)
    assert.equal('degraded' in r.input, false, '无事件时 ReviewInput 不得有 degraded 键')
  } finally {
    await cleanup()
  }
})

test('良性降级：ChapterReader 缓存坏、文件在 → 数据不缺，不产生事件（狼来了防护）', async () => {
  const { ctx, cleanup } = await makeReviewBook()
  try {
    const degradation = createDegradationCollector()
    breakQueries(ctx.cache, 'FROM chapters')
    const reader = new ChapterReader(ctx.repoPath, ctx.cache, degradation)
    const fm = await reader.readFrontMatter(1)
    assert.equal(fm.ok, true, '缓存坏时文件兜底必须成功')
    assert.equal(fm.data.标题, '起', '文件读到的数据与真源等价')
    assert.equal(degradation.size, 0, '良性降级不得产生 degraded 事件')
  } finally {
    await cleanup()
  }
})
