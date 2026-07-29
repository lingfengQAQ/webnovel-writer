import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { assembleReviewInput, mergeReviews, runReviews, saveReviews } from '../../src/review/index.js'
import { makeGitBook, chapter } from '../state-machine/_helper.js'

const charCard = (name, 境界) => `---\n姓名: ${name}\n状态: 在世\n位置: 青云宗\n境界: ${境界}\n---\n## 设定\n。`

async function makeReviewBook() {
  return makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n卷规模: 40\n',
    '定稿/正文/0001-起.md': chapter(1, '过去的事。'),
    '定稿/设定/角色/林晚.md': charCard('林晚', '练气三层'),
    '定稿/设定/时间线/第01卷.md': '| 章 | 一句话事件 |\n| --- | --- |\n| 1 | 林晚得玉佩 |\n',
    '工作区/细纲.md': '## 本章要写到的事\n林晚突破练气四层。\n',
    '工作区/草稿.md': '林晚运转功法，突破到练气四层。她握紧青霜剑。',
  })
}

const fcIssue = (over = {}) => ({
  severity: 'high', category: 'setting', location: '第1段',
  description: '境界矛盾', evidence: '正文 vs 角色卡', fix_hint: '改回', blocking: false, ...over,
})
const edIssue = (over = {}) => ({
  severity: 'low', category: 'pacing', location: '全章',
  description: '节奏平', evidence: '无爽点', fix_hint: '加钩子', blocking: false, ...over,
})
const reviewedReport = (input, report) => ({
  审稿输入令牌: input.审稿输入令牌,
  ...report,
})

test('assembleReviewInput：DTO 含草稿+要写到的事+相关角色,不泄漏路径', async () => {
  const { ctx, cleanup } = await makeReviewBook()
  try {
    const r = await assembleReviewInput(ctx, { chapterNum: 2, draftPath: '工作区/草稿.md' })
    assert.equal(r.ok, true)
    assert.match(r.input.草稿全文, /突破到练气四层/)
    assert.match(r.input.本章要写到的事, /练气四层/)
    assert.equal(r.input.作品契约版本, 1)
    assert.match(r.input.审稿输入令牌, /^sha256:[0-9a-f]{64}$/)
    assert.ok(r.input.相关角色.some((c) => c.正名 === '林晚'))
    const json = JSON.stringify(r.input)
    assert.ok(!json.includes(ctx.repoPath), '不泄漏仓库绝对路径')
    assert.ok(!json.includes('定稿/设定'), '不泄漏内部目录路径')
  } finally { await cleanup() }
})

test('mergeReviews：降级模式含兼容声明', () => {
  const m = mergeReviews(
    { factCheck: { issues: [] }, editorial: { issues: [] } },
    { mode: 'degraded', chapterNum: 2, reviewInputToken: 'sha256:test' }
  )
  assert.match(m.模式声明, /兼容模式/)
  assert.match(m.模式声明, /隔离度/)
})

test('mergeReviews：完整模式 + 合并计数', () => {
  const m = mergeReviews(
    {
      factCheck: { issues: [fcIssue({ severity: 'critical', blocking: true })] },
      editorial: { issues: [edIssue()] },
    },
    { mode: 'complete', chapterNum: 2, reviewInputToken: 'sha256:test' }
  )
  assert.equal(m.issues_count, 2)
  assert.equal(m.blocking_count, 1)
  assert.equal(m.has_blocking, true)
  assert.match(m.模式声明, /完整/)
})

test('runReviews：DI 注入两审 → 校验+合并+落盘审稿单与评审报告', async () => {
  const { ctx, cleanup, root } = await makeReviewBook()
  try {
    const reviewers = {
      factCheck: async (input) => reviewedReport(input, { chapter: input.章号, issues: [fcIssue()] }),
      editorial: async (input) => reviewedReport(input, { chapter: input.章号, issues: [edIssue()] }),
    }
    const r = await runReviews(ctx, { chapterNum: 2, draftPath: '工作区/草稿.md', mode: 'complete', reviewers })
    assert.equal(r.ok, true)
    const 审稿 = await fs.readFile(path.join(root, '工作区', '审稿.md'), 'utf8')
    assert.match(审稿, /突破到练气四层/, '审稿单含草稿')
    assert.match(审稿, /setting/)
    const factJson = await fs.readFile(path.join(root, '工作区', '评审报告', '事实审查.json'), 'utf8')
    assert.match(factJson, /setting/)
  } finally { await cleanup() }
})

test('事实审查顶层 factChanges 穿过 schema 归一化并写入正式报告', async () => {
  const { ctx, cleanup, root } = await makeReviewBook()
  try {
    const factChanges = [{
      planPath: '大纲/创作设计/设定/ITEM-002-玄阶令牌.md',
      factPath: '定稿/设定/物品/玄阶令牌.md',
      content: '---\n名称: 玄阶令牌\n---\n正文已建立的事实。\n',
      decision: '无冲突',
      removePlan: true,
    }]
    const reviewers = {
      factCheck: async (input) => reviewedReport(input, { chapter: input.章号, issues: [], factChanges }),
      editorial: async (input) => reviewedReport(input, { chapter: input.章号, issues: [] }),
    }
    const result = await runReviews(ctx, {
      chapterNum: 2,
      draftPath: '工作区/草稿.md',
      mode: 'complete',
      reviewers,
    })
    assert.equal(result.ok, true)
    assert.deepEqual(result.merged.事实审查.factChanges, factChanges, 'schema 归一化不得丢顶层事实差异')
    const saved = JSON.parse(
      await fs.readFile(path.join(root, '工作区', '评审报告', '事实审查.json'), 'utf8')
    )
    assert.deepEqual(saved.factChanges, factChanges, '正式事实审查报告必须保留 factChanges')
  } finally { await cleanup() }
})

test('runReviews：降级模式 → 审稿单含兼容声明', async () => {
  const { ctx, cleanup, root } = await makeReviewBook()
  try {
    let calls = 0
    const reviewers = {
      degraded: async (input) => {
        calls++
        return {
          审稿输入令牌: input.审稿输入令牌,
          factCheck: reviewedReport(input, { issues: [] }),
          editorial: reviewedReport(input, { issues: [] }),
        }
      },
      factCheck: async () => {
        throw new Error('降级模式不应单独调用事实审查')
      },
      editorial: async () => {
        throw new Error('降级模式不应单独调用编辑审')
      },
    }
    const r = await runReviews(ctx, { chapterNum: 2, draftPath: '工作区/草稿.md', mode: 'degraded', reviewers })
    assert.equal(r.ok, true)
    assert.equal(calls, 1, '降级模式预算应为单次 AI 调用')
    const 审稿 = await fs.readFile(path.join(root, '工作区', '审稿.md'), 'utf8')
    assert.match(审稿, /兼容模式/)
  } finally { await cleanup() }
})

test('runReviews：签发即预约两审轮次，第三轮在调用模型前拒绝，作者批准单独记账', async () => {
  const { ctx, cleanup, root } = await makeReviewBook()
  try {
    let calls = 0
    let seenToken = ''
    const reviewers = {
      factCheck: async (input) => {
        calls++
        seenToken = input.审稿输入令牌
        return reviewedReport(input, { issues: [] })
      },
      editorial: async (input) => reviewedReport(input, { issues: [] }),
    }
    const budgetPath = path.join(root, '工作区', '重试预算.json')

    const r1 = await runReviews(ctx, { chapterNum: 2, draftPath: '工作区/草稿.md', mode: 'complete', reviewers })
    assert.equal(r1.ok, true)
    const afterFirst = JSON.parse(await fs.readFile(budgetPath, 'utf8'))
    assert.equal(afterFirst.chapters['2'].review.attempts.length, 1)
    assert.equal(afterFirst.chapters['2'].review.attempts[0].status, 'saved', '保存成功后轮次记为 saved')

    // 作者裁决重提：同一令牌重新 save-review，不计新轮
    const resaved = await saveReviews(ctx, {
      chapterNum: 2,
      rawFact: { 审稿输入令牌: seenToken, issues: [] },
      rawEdit: { 审稿输入令牌: seenToken, issues: [] },
      reviewInputToken: seenToken,
      mode: 'complete',
      draftPath: '工作区/草稿.md',
    })
    assert.equal(resaved.ok, true)
    assert.ok(
      (resaved.warnings || []).some((w) => w.includes('不计新轮')),
      '覆盖保存已 saved 轮次必须给可见提醒'
    )
    const afterResave = JSON.parse(await fs.readFile(budgetPath, 'utf8'))
    assert.equal(afterResave.chapters['2'].review.attempts.length, 1, '裁决重提不消耗新轮次')

    const r2 = await runReviews(ctx, { chapterNum: 2, draftPath: '工作区/草稿.md', mode: 'complete', reviewers })
    assert.equal(r2.ok, true)

    const callsBeforeThird = calls
    const r3 = await runReviews(ctx, { chapterNum: 2, draftPath: '工作区/草稿.md', mode: 'complete', reviewers })
    assert.equal(r3.ok, false)
    assert.match(r3.errors[0], /自动轮次已用完/)
    assert.equal(calls, callsBeforeThird, '第三轮必须在调用模型前拒绝')

    const r4 = await runReviews(ctx, {
      chapterNum: 2,
      draftPath: '工作区/草稿.md',
      mode: 'complete',
      reviewers,
      authorApproved: true,
    })
    assert.equal(r4.ok, true)
    const afterAuthor = JSON.parse(await fs.readFile(budgetPath, 'utf8'))
    const attempts = afterAuthor.chapters['2'].review.attempts
    assert.equal(attempts.length, 3)
    assert.equal(attempts[2].route, 'author', '作者批准的轮次单独记账')
    assert.equal(attempts.filter((a) => a.route === 'automatic').length, 2, '自动额度不被作者轮次恢复')
  } finally { await cleanup() }
})

test('runReviews：审稿单越界 category → ok=false 带错', async () => {
  const { ctx, cleanup } = await makeReviewBook()
  try {
    const reviewers = {
      factCheck: async () => ({ issues: [fcIssue({ category: 'pacing' })] }), // pacing 不属事实审查
      editorial: async () => ({ issues: [] }),
    }
    const r = await runReviews(ctx, { chapterNum: 2, draftPath: '工作区/草稿.md', mode: 'complete', reviewers })
    assert.equal(r.ok, false)
    assert.ok(r.errors.length > 0)
  } finally { await cleanup() }
})

test('P1-1：草稿用别名命中角色 + 名册/相关条目进 DTO', async () => {
  // 名册有 林晚(正名)/晚晚(别名);草稿只用别名「晚晚」→ 旧逻辑漏,新逻辑应纳入
  const { ctx, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n卷规模: 40\n',
    '定稿/正文/0001-起.md': chapter(1, '过去的事。'),
    '定稿/设定/名册.md': '| 正名 | 别名 | 类型 | 首现章 |\n|------|------|------|--------|\n| 林晚 | 晚晚 | character | 1 |\n',
    '定稿/设定/角色/林晚.md': charCard('林晚', '练气三层'),
    '大纲/伏笔/伏笔-001-x.md': '---\n强度: 高\n状态: 进行\n开启章: 1\n---\n## 履历\n- 第1章：推进\n',
    '工作区/细纲.md': '## 本章要写到的事\n晚晚突破。\n',
    '工作区/草稿.md': '晚晚运转功法，突破到练气四层。她握紧青霜剑。',
  })
  try {
    const r = await assembleReviewInput(ctx, { chapterNum: 2, draftPath: '工作区/草稿.md' })
    assert.equal(r.ok, true, r.error)
    // 草稿只用别名「晚晚」,正名「林晚」没出现 → 必须靠别名命中
    assert.ok(!r.input.草稿全文.includes('林晚'), '前置:草稿确实不含正名')
    assert.ok(r.input.相关角色.some((c) => c.正名 === '林晚'), '别名命中应纳入林晚')
    assert.ok(r.input.名册.some((m) => m.正名 === '林晚' && m.别名.includes('晚晚')), '名册带别名')
    assert.ok(r.input.相关条目.some((t) => t.id?.startsWith('伏笔-001')), '相关条目带进行中的伏笔')
    // 不泄漏路径
    const json = JSON.stringify(r.input)
    assert.ok(!json.includes(ctx.repoPath) && !json.includes('定稿/设定'))
  } finally { await cleanup() }
})

test('P1-3：原始输出与归一化结果分存（.raw.json 保留模型原话）', async () => {
  const { ctx, cleanup, root } = await makeReviewBook()
  try {
    // stub 返回 critical+blocking:false;归一化会把 blocking 改 true,raw 保留 false
    const reviewers = {
      factCheck: async (input) => ({
        审稿输入令牌: input.审稿输入令牌,
        chapter: input.章号,
        ai_meta: 'raw-marker',
        issues: [fcIssue({ severity: 'critical', blocking: false })],
      }),
      editorial: async (input) => reviewedReport(input, { issues: [] }),
    }
    const r = await runReviews(ctx, { chapterNum: 2, draftPath: '工作区/草稿.md', mode: 'complete', reviewers })
    assert.equal(r.ok, true)
    const raw = JSON.parse(await fs.readFile(path.join(root, '工作区', '评审报告', '事实审查.raw.json'), 'utf8'))
    const norm = JSON.parse(await fs.readFile(path.join(root, '工作区', '评审报告', '事实审查.json'), 'utf8'))
    assert.equal(raw.issues[0].blocking, false, 'raw 保留 AI 原话 blocking:false')
    assert.equal(norm.issues[0].blocking, true, '归一化把 critical 改 blocking:true')
    assert.equal(raw.ai_meta, 'raw-marker', 'raw 保留 AI 额外字段')
  } finally { await cleanup() }
})

test('拟条目变动进 DTO + 声明条目附履历尾部（未声明者不附）', async () => {
  const { ctx, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n卷规模: 40\n',
    '定稿/正文/0001-起.md': chapter(1, '过去的事。'),
    '大纲/伏笔/伏笔-001-旧案.md':
      '---\n强度: 高\n状态: 进行\n开启章: 1\n---\n## 履历\n- 第1章：埋下——旧案线索（见结尾黑影段）\n- 第2章：推进——查到卷宗\n- 第3章：推进——找到人证\n- 第4章：推进——人证翻供\n',
    '大纲/悬念/悬念-001-身世.md': '---\n强度: 中\n状态: 进行\n开启章: 1\n---\n## 履历\n- 第1章：设下\n',
    '工作区/草稿.md':
      '---\n章号: 5\n标题: 对质\n卷: 1\n字数: 20\n章定位: 推进\n钩子: 危机钩-强\n情绪定位: 铺垫\n伏笔:\n  - 推进 伏笔-001\n  - 埋下 伏笔-002\n---\n林晚当堂对质，人证再度翻供。',
  })
  try {
    const r = await assembleReviewInput(ctx, { chapterNum: 5, draftPath: '工作区/草稿.md' })
    assert.equal(r.ok, true, r.error)
    assert.deepEqual(r.input.拟条目变动, [
      { type: '伏笔', verb: '推进', id: '伏笔-001' },
      { type: '伏笔', verb: '埋下', id: '伏笔-002' },
    ])
    const declared = r.input.相关条目.find((t) => t.id === '伏笔-001')
    assert.ok(declared, JSON.stringify(r.input.相关条目))
    assert.equal(declared.履历尾部.length, 3, '履历只取末 3 行')
    assert.ok(!declared.履历尾部.some((l) => l.includes('第1章')), '开头行不进尾部')
    assert.match(declared.履历尾部[2], /人证翻供/)
    const undeclared = r.input.相关条目.find((t) => t.id === '悬念-001')
    assert.equal(undeclared.履历尾部, undefined, '未声明条目维持纯元数据（控 token）')
  } finally { await cleanup() }
})

test('草稿无 front matter → 拟条目变动为空数组（不崩）', async () => {
  const { ctx, cleanup } = await makeReviewBook()
  try {
    const r = await assembleReviewInput(ctx, { chapterNum: 2, draftPath: '工作区/草稿.md' })
    assert.equal(r.ok, true, r.error)
    assert.deepEqual(r.input.拟条目变动, [])
  } finally { await cleanup() }
})
