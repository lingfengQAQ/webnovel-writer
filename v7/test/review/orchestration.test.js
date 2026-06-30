import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { assembleReviewInput, mergeReviews, runReviews } from '../../src/review/index.js'
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

test('assembleReviewInput：DTO 含草稿+要写到的事+相关角色,不泄漏路径', async () => {
  const { ctx, cleanup } = await makeReviewBook()
  try {
    const r = await assembleReviewInput(ctx, { chapterNum: 2, draftPath: '工作区/草稿.md' })
    assert.equal(r.ok, true)
    assert.match(r.input.草稿全文, /突破到练气四层/)
    assert.match(r.input.本章要写到的事, /练气四层/)
    assert.ok(r.input.相关角色.some((c) => c.正名 === '林晚'))
    const json = JSON.stringify(r.input)
    assert.ok(!json.includes(ctx.repoPath), '不泄漏仓库绝对路径')
    assert.ok(!json.includes('定稿/设定'), '不泄漏内部目录路径')
  } finally { await cleanup() }
})

test('mergeReviews：降级模式含兼容声明', () => {
  const m = mergeReviews(
    { factCheck: { issues: [] }, editorial: { issues: [] } },
    { mode: 'degraded', chapterNum: 2 }
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
    { mode: 'complete', chapterNum: 2 }
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
      factCheck: async (input) => ({ chapter: input.章号, issues: [fcIssue()] }),
      editorial: async (input) => ({ chapter: input.章号, issues: [edIssue()] }),
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

test('runReviews：降级模式 → 审稿单含兼容声明', async () => {
  const { ctx, cleanup, root } = await makeReviewBook()
  try {
    const reviewers = { factCheck: async () => ({ issues: [] }), editorial: async () => ({ issues: [] }) }
    const r = await runReviews(ctx, { chapterNum: 2, draftPath: '工作区/草稿.md', mode: 'degraded', reviewers })
    assert.equal(r.ok, true)
    const 审稿 = await fs.readFile(path.join(root, '工作区', '审稿.md'), 'utf8')
    assert.match(审稿, /兼容模式/)
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
        chapter: input.章号,
        ai_meta: 'raw-marker',
        issues: [fcIssue({ severity: 'critical', blocking: false })],
      }),
      editorial: async () => ({ issues: [] }),
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
