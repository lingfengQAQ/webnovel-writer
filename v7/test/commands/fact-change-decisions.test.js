import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { run as reviewInput } from '../../src/commands/review-input.js'
import { run as saveReview } from '../../src/commands/save-review.js'
import { run as finalize } from '../../src/commands/finalize.js'
import { makeGitBook } from '../state-machine/_helper.js'
import { designFixture } from '../knowledge/_design-fixture.js'
import { FACT_PATH, PLAN_PATH, factFixture } from '../knowledge/_fact-fixture.js'

const decisionDetails = {
  difference: '计划对象把林晚定在练气三层，草稿明确写她突破到练气四层。',
  impact: '接受突破会改变角色卡境界、后续战力基线和下一章对手安排。',
  options: [
    {
      optionId: 'keep-plan',
      label: '保留练气三层',
      description: '修改草稿，不写入突破事实。',
      applyChange: false,
    },
    {
      optionId: 'accept-change',
      label: '接受练气四层',
      description: '转正突破并按新境界续写。',
      applyChange: true,
    },
  ],
}

function factChange(decision = '冲突') {
  return {
    planPath: PLAN_PATH,
    factPath: FACT_PATH,
    content: factFixture('练气四层'),
    decision,
    ...decisionDetails,
    removePlan: true,
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8')
}

async function reviewToken(root, ctx) {
  const prepared = await reviewInput(['1'], {}, ctx)
  assert.equal(prepared.ok, true, prepared.error)
  return JSON.parse(
    await fs.readFile(path.join(root, '工作区', '审稿输入.json'), 'utf8')
  ).审稿输入令牌
}

function reviewEnvelope(token, factChanges = undefined) {
  return {
    审稿输入令牌: token,
    事实审查: {
      审稿输入令牌: token,
      chapter: 1,
      issues: [],
      ...(factChanges === undefined ? {} : { factChanges }),
    },
    编辑审: { 审稿输入令牌: token, chapter: 1, issues: [] },
  }
}

test('save-review：普通无冲突报告不增加待裁决占位', async () => {
  const { root, ctx, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n',
    '工作区/草稿-A.md': '林晚沿原计划出场。',
  })
  try {
    const reviewFile = path.join(root, '工作区', '两审.json')
    const token = await reviewToken(root, ctx)
    await writeJson(reviewFile, reviewEnvelope(token))
    const result = await saveReview(['1'], { file: reviewFile }, ctx)
    assert.equal(result.ok, true, result.error)
    assert.doesNotMatch(result.output, /待裁决事实/)
    assert.doesNotMatch(
      await fs.readFile(path.join(root, '工作区', '审稿.md'), 'utf8'),
      /待裁决事实/
    )
  } finally {
    await cleanup()
  }
})

test('save-review → finalize：真实命令链呈报差异/影响/选项，裁决前整章零写入', async () => {
  const frontMatter = { 章号: 1, 标题: '突破', 卷: 1, 字数: 100, 章定位: '推进' }
  const { root, ctx, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n',
    '工作区/草稿-A.md': '---\n章号: 1\n标题: 突破\n卷: 1\n字数: 100\n章定位: 推进\n---\n林晚当场突破到练气四层。',
    [PLAN_PATH]: designFixture(),
  })
  try {
    const reviewFile = path.join(root, '工作区', '两审.json')
    const token = await reviewToken(root, ctx)
    await writeJson(reviewFile, reviewEnvelope(token, [factChange()]))
    const reviewed = await saveReview(['1'], { file: reviewFile }, ctx)
    assert.equal(reviewed.ok, true, reviewed.error)
    for (const expected of [
      decisionDetails.difference,
      decisionDetails.impact,
      'keep-plan：保留练气三层',
      'accept-change：接受练气四层',
    ]) {
      assert.match(reviewed.output, new RegExp(expected))
    }
    const reviewMarkdown = await fs.readFile(path.join(root, '工作区', '审稿.md'), 'utf8')
    assert.match(reviewMarkdown, /## 待裁决事实/)
    assert.match(reviewMarkdown, /accept-change：接受练气四层/)

    const beforeIncomplete = reviewMarkdown
    const incomplete = factChange()
    delete incomplete.impact
    await writeJson(reviewFile, reviewEnvelope(token, [incomplete]))
    const rejectedReview = await saveReview(['1'], { file: reviewFile }, ctx)
    assert.equal(rejectedReview.ok, false)
    assert.match(rejectedReview.error, /factChanges\[0\]\.impact/)
    assert.equal(
      await fs.readFile(path.join(root, '工作区', '审稿.md'), 'utf8'),
      beforeIncomplete,
      '不完整冲突不得覆盖上一份完整审稿单'
    )

    const malformed = {
      ...factChange(),
      options: decisionDetails.options.map((option) => ({ ...option })),
    }
    delete malformed.options[0].applyChange
    await writeJson(reviewFile, reviewEnvelope(token, [malformed]))
    const rejectedSemantics = await saveReview(['1'], { file: reviewFile }, ctx)
    assert.equal(rejectedSemantics.ok, false)
    assert.match(rejectedSemantics.error, /options\[0\]\.applyChange/)

    const finalizeFile = path.join(root, '工作区', '定稿包.json')
    const payload = {
      frontMatter,
      body: '林晚当场突破到练气四层。',
      workspaceFiles: [],
    }
    await writeJson(finalizeFile, payload)
    const blocked = await finalize(['1'], { payload: finalizeFile }, ctx)
    assert.equal(blocked.ok, false)
    assert.match(blocked.error, /计划对象把林晚定在练气三层/)
    assert.match(blocked.error, /后续战力基线和下一章对手安排/)
    assert.match(blocked.error, /keep-plan：保留练气三层/)
    await fs.access(path.join(root, ...PLAN_PATH.split('/')))
    await assert.rejects(() => fs.access(path.join(root, ...FACT_PATH.split('/'))))
    await assert.rejects(() => fs.access(path.join(root, '定稿', '正文', '0001-突破.md')))

    payload.factChanges = [{
      ...factChange(),
      decision: '作者已裁决',
      resolution: '作者接受本章突破，后续按练气四层安排。',
      optionId: 'accept-change',
    }]
    payload.factChanges[0].options = payload.factChanges[0].options.map((option) => ({ ...option }))
    payload.factChanges[0].options[0].applyChange = true
    await writeJson(finalizeFile, payload)
    const tampered = await finalize(['1'], { payload: finalizeFile }, ctx)
    assert.equal(tampered.ok, false)
    assert.match(tampered.error, /事实审查结果不一致/)
    await fs.access(path.join(root, ...PLAN_PATH.split('/')))
    await assert.rejects(() => fs.access(path.join(root, ...FACT_PATH.split('/'))))
    await assert.rejects(() => fs.access(path.join(root, '定稿', '正文', '0001-突破.md')))

    payload.factChanges[0] = {
      ...factChange(),
      decision: '作者已裁决',
      resolution: '作者接受本章突破，后续按练气四层安排。',
      optionId: 'accept-change',
    }
    await writeJson(finalizeFile, payload)
    const accepted = await finalize(['1'], { payload: finalizeFile }, ctx)
    assert.equal(accepted.ok, true, accepted.error)
    await fs.access(path.join(root, ...FACT_PATH.split('/')))
    await fs.access(path.join(root, '定稿', '正文', '0001-突破.md'))
    await assert.rejects(() => fs.access(path.join(root, ...PLAN_PATH.split('/'))))
  } finally {
    await cleanup()
  }
})

test('save-review → finalize：keep-plan 裁决保留计划且不写入事实', async () => {
  const frontMatter = { 章号: 1, 标题: '守住计划', 卷: 1, 字数: 100, 章定位: '推进' }
  const { root, ctx, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n',
    '工作区/草稿-A.md': '---\n章号: 1\n标题: 守住计划\n卷: 1\n字数: 100\n章定位: 推进\n---\n林晚仍按计划保持练气三层。',
    [PLAN_PATH]: designFixture(),
  })
  try {
    const reviewFile = path.join(root, '工作区', '两审.json')
    const token = await reviewToken(root, ctx)
    await writeJson(reviewFile, reviewEnvelope(token, [factChange()]))
    const reviewed = await saveReview(['1'], { file: reviewFile }, ctx)
    assert.equal(reviewed.ok, true, reviewed.error)

    const finalizeFile = path.join(root, '工作区', '定稿包.json')
    await writeJson(finalizeFile, {
      frontMatter,
      body: '林晚仍按计划保持练气三层。',
      factChanges: [{
        ...factChange(),
        decision: '作者已裁决',
        resolution: '作者决定保留原计划，本章不转正突破事实。',
        optionId: 'keep-plan',
      }],
      workspaceFiles: [],
    })
    const finalized = await finalize(['1'], { payload: finalizeFile }, ctx)
    assert.equal(finalized.ok, true, finalized.error)
    await fs.access(path.join(root, ...PLAN_PATH.split('/')))
    await fs.access(path.join(root, '定稿', '正文', '0001-守住计划.md'))
    await assert.rejects(() => fs.access(path.join(root, ...FACT_PATH.split('/'))))
  } finally {
    await cleanup()
  }
})
