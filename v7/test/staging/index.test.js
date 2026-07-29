import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import {
  readBatch,
  stagedFacts,
  stageChapter,
  judgeStop,
  judgeBatchQuality,
  rejectFrom,
  restageReview,
  discardBatch,
  章状态,
} from '../../src/staging/index.js'
import { repoCtx } from '../commands/_helper.js'
import { writeReviewArtifacts } from './_helper.js'

// —— fixture：已有 2 章定稿的书，批次从第 3 章起 ——

const 定稿章 = (num) =>
  [
    '---',
    `章号: ${num}`,
    `标题: 第${num}章`,
    '卷: 1',
    `书内时间: 1023春月初${num}`,
    '字数: 100',
    '章定位: 推进',
    '钩子: 危机钩-强',
    '情绪定位: 铺垫',
    '---',
    '',
    `第${num}章正文。`,
  ].join('\n')

function bookFiles({ 批次大小 = 3, 卷纲 = true } = {}) {
  const files = {
    'book.yaml': `spec_version: "7.0"\n书名: 连写测试\n类型: 玄幻\n每章目标字数: 3000\n卷规模: 40\n文体基线起: 1\n文体基线止: 30\n连写批次大小: ${批次大小}\n`,
    '定稿/正文/0001-第1章.md': 定稿章(1),
    '定稿/正文/0002-第2章.md': 定稿章(2),
  }
  if (卷纲) files['大纲/卷纲/第01卷.md'] = '# 第01卷\n第三章到第五章：追查黑影。\n'
  return files
}

function mkPayload(num, { 标题 = `第${num}章`, 钩子 = '危机钩-强', 书内时间 = `1023夏月初${num}`, 伏笔 = null, 收卷 = null, body = null } = {}) {
  const frontMatter = {
    章号: num,
    标题,
    卷: 1,
    视角: '林晚',
    字数: 100,
    章定位: '推进',
    钩子,
    情绪定位: '铺垫',
  }
  if (书内时间) frontMatter.书内时间 = 书内时间
  if (伏笔) frontMatter.伏笔 = 伏笔
  if (收卷) frontMatter.收卷 = 收卷
  return {
    frontMatter,
    body: body ?? `林晚在第${num}章继续追查，线索一路指向后山。夜色渐深，她的脚步没有停。`,
    summary: `第${num}章摘要。`,
    commitLines: {},
    workspaceFiles: [],
  }
}

async function stage(ctx, num, opts) {
  const { 审稿问题 = [], ...payloadOptions } = opts || {}
  const payload = mkPayload(num, payloadOptions)
  await writeReviewArtifacts(ctx.repoPath, num, 审稿问题, [], payload)
  return stageChapter(ctx, { chapterNum: num, payload })
}

test('stage 首章：三件套落位、meta 记录、工作区清、停止未命中', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles())
  try {
    const r = await stage(ctx, 3, { 伏笔: ['推进 伏笔-001'] })
    assert.equal(r.ok, true, r.error)
    assert.equal(r.停止.stop, false, JSON.stringify(r.停止))

    const dir = path.join(ctx.repoPath, '工作区', '待定稿', '0003-第3章')
    for (const f of ['草稿.md', '定稿包.json', '审稿单.md']) {
      await fs.access(path.join(dir, f))
    }
    const batch = await readBatch(ctx.repoPath)
    assert.equal(batch.exists, true)
    assert.deepEqual(
      batch.章列表.map((x) => [x.章号, x.状态]),
      [[3, 章状态.待审收]]
    )
    // 本章工作区文件已清（审稿单搬进批次目录）
    await assert.rejects(() => fs.access(path.join(ctx.repoPath, '工作区', '审稿.md')))
  } finally {
    await cleanup()
  }
})

test('stage 跳章拒绝、重章覆盖（改标题清旧目录）', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles())
  try {
    const skip = await stage(ctx, 5)
    assert.equal(skip.ok, false)
    assert.match(skip.error, /连续.*第 3 章/)

    assert.equal((await stage(ctx, 3)).ok, true)
    const again = await stage(ctx, 3, { 标题: '改名章' })
    assert.equal(again.ok, true, again.error)
    const batch = await readBatch(ctx.repoPath)
    assert.equal(batch.章列表.length, 1)
    assert.equal(batch.章列表[0].标题, '改名章')
    await assert.rejects(() => fs.access(path.join(ctx.repoPath, '工作区', '待定稿', '0003-第3章')))
  } finally {
    await cleanup()
  }
})

// P0-R6：staging 链与手动 finalize 走同一套 payload 校验，不开第二条口径。
test('stage 拒绝路径穿越 secretWrites.id（与 finalize 同一校验函数）', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles())
  try {
    const payload = mkPayload(3)
    payload.secretWrites = [{ id: '../../x', frontMatter: { 强度: '高' }, content: '## 内容\nx' }]
    await writeReviewArtifacts(ctx.repoPath, 3, [], [], payload)
    const r = await stageChapter(ctx, { chapterNum: 3, payload })
    assert.equal(r.ok, false)
    assert.match(r.error, /secretWrites\[0\]\.id/)
    await assert.rejects(() =>
      fs.access(path.join(ctx.repoPath, '工作区', '待定稿')), '非法 payload 不得建批次目录'
    )
    await assert.rejects(() => fs.access(path.join(ctx.repoPath, '..', 'x.md')))
  } finally {
    await cleanup()
  }
})

test('stage 拒绝非正整数 timelineRows.volumeNum（与 finalize 同一校验函数）', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles())
  try {
    const payload = mkPayload(3)
    payload.timelineRows = [
      { volumeNum: '../../x', row: { 章: 3, 书内时间: 't', 一句话事件: 'e', 在场: 'x' } },
    ]
    await writeReviewArtifacts(ctx.repoPath, 3, [], [], payload)
    const r = await stageChapter(ctx, { chapterNum: 3, payload })
    assert.equal(r.ok, false)
    assert.match(r.error, /timelineRows\[0\]\.volumeNum/)
    await assert.rejects(() => fs.access(path.join(ctx.repoPath, '..', 'x.md')))
  } finally {
    await cleanup()
  }
})

test('stage 无审稿单拒绝，零写入', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles())
  try {
    const r = await stageChapter(ctx, { chapterNum: 3, payload: mkPayload(3) })
    assert.equal(r.ok, false)
    assert.match(r.error, /审稿/)
    await assert.rejects(() => fs.access(path.join(ctx.repoPath, '工作区', '待定稿')))
  } finally {
    await cleanup()
  }
})

test('停止条件：批次写满', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles({ 批次大小: 3 }))
  try {
    assert.equal((await stage(ctx, 3, { 伏笔: ['推进 伏笔-001'] })).停止.stop, false)
    assert.equal((await stage(ctx, 4, { 伏笔: ['推进 伏笔-001'] })).停止.stop, false)
    const r = await stage(ctx, 5, { 伏笔: ['推进 伏笔-001'] })
    assert.equal(r.停止.stop, true)
    assert.ok(r.停止.reasons.some((x) => x.includes('写满')), JSON.stringify(r.停止))
  } finally {
    await cleanup()
  }
})

test('停止条件：收卷声明终止批次', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles({ 批次大小: 8 }))
  try {
    const r = await stage(ctx, 3, { 收卷: '是', 伏笔: ['推进 伏笔-001'] })
    assert.equal(r.停止.stop, true)
    assert.ok(r.停止.reasons.some((x) => x.includes('收卷')), JSON.stringify(r.停止))
  } finally {
    await cleanup()
  }
})

test('停止条件：卷纲耗尽（当前卷无卷纲文件）', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles({ 批次大小: 8, 卷纲: false }))
  try {
    const r = await stage(ctx, 3, { 伏笔: ['推进 伏笔-001'] })
    assert.equal(r.停止.stop, true)
    assert.ok(r.停止.reasons.some((x) => x.includes('卷纲')), JSON.stringify(r.停止))
  } finally {
    await cleanup()
  }
})

test('停止条件：连续 3 章无条目变动（默认上限），有变动章重置计数', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles({ 批次大小: 8 }))
  try {
    assert.equal((await stage(ctx, 3)).停止.stop, false)
    assert.equal((await stage(ctx, 4)).停止.stop, false)
    const r5 = await stage(ctx, 5)
    assert.equal(r5.停止.stop, true)
    assert.ok(r5.停止.reasons.some((x) => x.includes('无条目变动')), JSON.stringify(r5.停止))
    // 第 5 章重暂存并带条目变动 → 尾部计数归零，不再停
    const r5b = await stage(ctx, 5, { 伏笔: ['推进 伏笔-001'] })
    assert.equal(r5b.停止.stop, false, JSON.stringify(r5b.停止))
  } finally {
    await cleanup()
  }
})

test('作品契约问题连续两章后才在批次作者确认点呈报', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles({ 批次大小: 8 }))
  const contractIssue = {
    severity: 'medium',
    category: 'pacing',
    location: '结尾',
    description: '本章没有兑现约定推进',
    evidence: '正文与作品契约',
    fix_hint: '核对兑现方式',
    blocking: false,
    contract_clause: '节奏与兑现参数',
  }
  try {
    const first = await stage(ctx, 3, {
      伏笔: ['推进 伏笔-001'],
      审稿问题: [contractIssue],
    })
    assert.equal(first.停止.stop, false, JSON.stringify(first.停止))
    const second = await stage(ctx, 4, {
      伏笔: ['推进 伏笔-001'],
      审稿问题: [contractIssue],
    })
    assert.equal(second.停止.stop, true)
    assert.ok(second.停止.reasons.some((reason) => reason.includes('作品契约') && reason.includes('连续')))
    const payload = JSON.parse(
      await fs.readFile(
        path.join(ctx.repoPath, '工作区', '待定稿', '0004-第4章', '定稿包.json'),
        'utf8'
      )
    )
    assert.deepEqual(payload.frontMatter.契约问题, ['节奏与兑现参数｜中｜本章没有兑现约定推进'])
  } finally {
    await cleanup()
  }
})

// —— 批次质检（纯函数）——

const 质检章 = (num, { 钩子 = '危机钩-强', 书内时间 = 'x', body = '正文。' } = {}) => ({
  章号: num,
  frontMatter: { 钩子, 书内时间 },
  body,
})

test('批次质检：弱钩尾达上限', async () => {
  const staged = [1, 2, 3].map((n) => 质检章(n, { 钩子: '悬念钩-弱' }))
  const q = judgeBatchQuality(staged, null, { 连续弱钩上限: 3 })
  assert.equal(q.过线, false)
  assert.ok(q.原因.some((x) => x.includes('弱钩')), JSON.stringify(q))
  // 尾部只有 2 章弱钩 → 过线
  const staged2 = [质检章(1), 质检章(2, { 钩子: '悬念钩-弱' }), 质检章(3, { 钩子: '悬念钩-弱' })]
  assert.equal(judgeBatchQuality(staged2, null, { 连续弱钩上限: 3 }).过线, true)
})

test('批次质检：缺书内时间列出章号', async () => {
  const q = judgeBatchQuality([质检章(3), 质检章(4, { 书内时间: '' })], null, {})
  assert.equal(q.过线, false)
  assert.ok(q.原因.some((x) => x.includes('第 4 章') && x.includes('书内时间')), JSON.stringify(q))
})

test('批次质检：句式 vs 基线 29% 不停 31% 停；无基线跳过', async () => {
  const 字池 =
    '天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏闰余成岁律吕调阳云腾致雨露结为霜金生丽水玉出昆冈剑号巨阙珠称夜光果珍李柰菜重芥姜海咸河淡鳞潜羽翔龙师火帝鸟官人皇始制文字乃服衣裳推位让国有虞陶唐吊民伐罪周发殷汤坐朝问道垂拱平章爱育黎首臣伏戎羌遐迩一体率宾归王鸣凤在竹白驹食场'
  const bodyOf = (lengths) => {
    let pos = 0
    const parts = []
    for (const n of lengths) {
      parts.push(字池.slice(pos, pos + n))
      pos += n
    }
    return parts.join('。') + '。'
  }
  const base = { avg_sentence_length: 10, sentence_length_variance: 0 }
  const at29 = [质检章(3, { body: bodyOf([12, 13, 13, 13, 13, 13, 13, 13, 13, 13]) })]
  assert.equal(judgeBatchQuality(at29, base, {}).过线, true, '偏 29% 不停')
  const at31 = [质检章(3, { body: bodyOf([13, 13, 13, 13, 13, 13, 13, 13, 13, 14]) })]
  const q = judgeBatchQuality(at31, base, {})
  assert.equal(q.过线, false, '偏 31% 停')
  assert.ok(q.原因.some((x) => x.includes('平均句长')), JSON.stringify(q))
  assert.equal(judgeBatchQuality(at31, null, {}).过线, true, '无基线句式判据跳过')
})

test('停止条件：只读取当前配置的精确基线，忽略更晚的陈旧 active 行', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles())
  try {
    await ctx.cache.run(
      "INSERT INTO fingerprints (chapter_range_start, chapter_range_end, is_baseline, avg_sentence_length, sentence_length_variance, avg_paragraph_length, common_phrase_frequency, vocabulary_richness, fingerprint_data) VALUES (1, 30, 1, 1, 0, 20, '{}', 0.5, '{}')"
    )
    await ctx.cache.run(
      "INSERT INTO fingerprints (chapter_range_start, chapter_range_end, is_baseline, avg_sentence_length, sentence_length_variance, avg_paragraph_length, common_phrase_frequency, vocabulary_richness, fingerprint_data) VALUES (31, 40, 1, 100, 0, 20, '{}', 0.5, '{}')"
    )
    const r = await stage(ctx, 3, { 伏笔: ['推进 伏笔-001'] })
    assert.equal(r.ok, true, r.error)
    assert.ok(r.停止.reasons.some((reason) => reason.includes('批内平均句长')), JSON.stringify(r.停止))
  } finally {
    await cleanup()
  }
})

// —— 打回 / 重审 / 丢弃 / 对账 ——

test('rejectFrom：K 打回清工件，K+1..N 受影响；restageReview 回待审收', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles({ 批次大小: 8 }))
  try {
    for (const n of [3, 4, 5]) await stage(ctx, n, { 伏笔: ['推进 伏笔-001'] })
    const r = await rejectFrom(ctx.repoPath, 4)
    assert.equal(r.ok, true, r.error)
    assert.deepEqual(r.受影响, [5])
    const batch = await readBatch(ctx.repoPath)
    assert.deepEqual(
      batch.章列表.map((x) => [x.章号, x.状态]),
      [
        [3, 章状态.待审收],
        [4, 章状态.打回],
        [5, 章状态.受影响],
      ]
    )
    // 打回章工件已清
    await assert.rejects(() =>
      fs.access(path.join(ctx.repoPath, '工作区', '待定稿', '0004-第4章', '草稿.md'))
    )
    // 打回章不能只重审
    const bad = await restageReview(ctx.repoPath, 4)
    assert.equal(bad.ok, false)
    assert.match(bad.error, /重写/)
    // 受影响章重审：新审稿单 → 待审收
    const staged5 = JSON.parse(await fs.readFile(
      path.join(ctx.repoPath, '工作区', '待定稿', '0005-第5章', '定稿包.json'),
      'utf8'
    ))
    await writeReviewArtifacts(ctx.repoPath, 5, [], [], staged5)
    const ok5 = await restageReview(ctx.repoPath, 5)
    assert.equal(ok5.ok, true, ok5.error)
    assert.equal((await readBatch(ctx.repoPath)).章列表.find((x) => x.章号 === 5).状态, 章状态.待审收)
    await assert.rejects(() => fs.access(path.join(ctx.repoPath, '工作区', '审稿输入.json')))
    await assert.rejects(() => fs.access(path.join(ctx.repoPath, '工作区', '审稿.md')))
    await assert.rejects(() => fs.access(path.join(ctx.repoPath, '工作区', '评审报告')))
  } finally {
    await cleanup()
  }
})

test('批次.json 损坏 → 按目录重建，保守标记受影响', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles())
  try {
    await stage(ctx, 3, { 伏笔: ['推进 伏笔-001'] })
    await fs.writeFile(path.join(ctx.repoPath, '工作区', '待定稿', '批次.json'), '{{{', 'utf8')
    const batch = await readBatch(ctx.repoPath)
    assert.equal(batch.exists, true)
    assert.equal(batch.章列表[0].状态, 章状态.受影响)
    assert.ok(batch.warnings.some((w) => w.includes('批次.json')), JSON.stringify(batch.warnings))
  } finally {
    await cleanup()
  }
})

test('discardBatch：整批丢弃，工作区批次消失', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles())
  try {
    await stage(ctx, 3)
    await fs.writeFile(
      path.join(ctx.repoPath, '工作区', '重试预算.json'),
      JSON.stringify({
        schemaVersion: 1,
        chapters: {
          3: { mechanical: { attempts: [{ draftHash: `sha256:${'a'.repeat(64)}`, route: 'initial', result: 'fail' }] }, review: { attempts: [] } },
          99: { mechanical: { attempts: [{ draftHash: `sha256:${'b'.repeat(64)}`, route: 'initial', result: 'fail' }] }, review: { attempts: [] } },
        },
      }),
      'utf8'
    )
    const r = await discardBatch(ctx.repoPath)
    assert.equal(r.ok, true)
    assert.equal(r.章数, 1)
    assert.equal((await readBatch(ctx.repoPath)).exists, false)
    await assert.rejects(() => fs.access(path.join(ctx.repoPath, '工作区', '待定稿')))
    const budget = JSON.parse(
      await fs.readFile(path.join(ctx.repoPath, '工作区', '重试预算.json'), 'utf8')
    )
    assert.equal(budget.chapters['3'], undefined, '丢批清该批章的重试预算')
    assert.ok(budget.chapters['99'], '批外章的重试预算保留')
  } finally {
    await cleanup()
  }
})

test('stagedFacts：声明与定稿包合并出条目/名册/时间线/信息差事实', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles({ 批次大小: 8 }))
  try {
    const p = mkPayload(3, { 伏笔: ['埋下 伏笔-009'] })
    await writeReviewArtifacts(ctx.repoPath, 3, [], [], p)
    p.threadCreates = [
      { id: '伏笔-009', 短题: '古钟', frontMatter: { 强度: '中', 状态: '进行', 开启章: 3 }, body: '## 描述\n古钟。\n' },
    ]
    p.rosterUpserts = [{ 正名: '古钟长老', 别名: '钟叟, 老钟', 类型: 'character', 首现章: 3 }]
    p.characterUpdates = [{ name: '林晚', updates: { 最后变更章: 3 } }]
    p.timelineRows = [{ volumeNum: 1, row: { 章: 3, 书内时间: '夏月初三', 一句话事件: '闻古钟', 在场: '林晚' } }]
    p.secretWrites = [{ id: '信息差-002-钟声', frontMatter: { 读者已知: false, 登记章: 3, 关键词: ['古钟'] }, content: '## 内容\n钟声有古怪。\n' }]
    const r = await stageChapter(ctx, { chapterNum: 3, payload: p })
    assert.equal(r.ok, true, r.error)

    const facts = await stagedFacts(ctx.repoPath)
    assert.equal(facts.exists, true)
    assert.equal(facts.chapters.length, 1)
    const t = facts.threads.get('伏笔-009')
    assert.ok(t, '声明+定稿包都指向的新条目必须在')
    assert.equal(t.新开, true)
    assert.equal(t.状态, '进行')
    assert.ok(facts.newEntities.has('古钟长老'))
    assert.ok(facts.newAliases.has('钟叟') && facts.newAliases.has('老钟'))
    assert.deepEqual(facts.characterUpdates.get('林晚'), { 最后变更章: 3 })
    assert.equal(facts.timelineRows.length, 1)
    assert.equal(facts.secretWrites.length, 1)
    assert.equal(facts.总字数, 100)
  } finally {
    await cleanup()
  }
})

// E6：批次.json 损坏重建时，三件套全缺的目录是 rejectFrom 清空后的打回章——
// 标「打回」保住 stage-chapter 覆盖通道，标「受影响」会成不可操作的死行
test('批次.json 损坏重建：三件套全缺的目录标「打回」，有工件的标「受影响」', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles({ 批次大小: 8 }))
  try {
    assert.equal((await stage(ctx, 3)).ok, true)
    assert.equal((await stage(ctx, 4)).ok, true)
    const rej = await rejectFrom(ctx.repoPath, 3)
    assert.equal(rej.ok, true, rej.error)

    await fs.rm(path.join(ctx.repoPath, '工作区', '待定稿', '批次.json'), { force: true })
    const batch = await readBatch(ctx.repoPath)
    assert.equal(batch.exists, true)
    const 三 = batch.章列表.find((r) => r.章号 === 3)
    const 四 = batch.章列表.find((r) => r.章号 === 4)
    assert.equal(三.状态, 章状态.打回, '空目录须可被 stage-chapter 覆盖恢复')
    assert.equal(四.状态, 章状态.受影响)
  } finally {
    await cleanup()
  }
})

// D5：名义只读路径传 heal:false——批次.json 缺失只重建内存视图，不落盘
test('readBatch heal=false：批次.json 缺失时不落盘自愈，默认路径才写', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles({ 批次大小: 8 }))
  try {
    assert.equal((await stage(ctx, 3)).ok, true)
    const metaPath = path.join(ctx.repoPath, '工作区', '待定稿', '批次.json')
    await fs.rm(metaPath, { force: true })

    const cold = await readBatch(ctx.repoPath, { heal: false })
    assert.equal(cold.exists, true)
    await assert.rejects(() => fs.access(metaPath), 'heal=false 不得写盘')

    const healed = await readBatch(ctx.repoPath)
    assert.equal(healed.exists, true)
    await fs.access(metaPath)
  } finally {
    await cleanup()
  }
})
