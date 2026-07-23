import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { applyReviewOutcome, reviewedDraftHash } from '../../src/review/outcome.js'
import { writeReviewArtifacts } from '../staging/_helper.js'

test('结构化审稿结果把实际契约问题写入章档案，普通问题不进入', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-review-outcome-'))
  try {
    const reviewedPayload = {
      frontMatter: { 章号: 3, 标题: '测试' },
      body: '正文。',
    }
    await writeReviewArtifacts(root, 3, [
      {
        severity: 'medium',
        category: 'pacing',
        description: '核心承诺连续两场没有推进',
        contract_clause: '核心读者承诺',
        blocking: false,
      },
      { severity: 'low', category: 'structure', description: '转场略硬', blocking: false },
    ], [], reviewedPayload)
    const result = await applyReviewOutcome(root, 3, reviewedPayload)
    assert.equal(result.ok, true, result.error)
    assert.deepEqual(result.payload.frontMatter.契约问题, [
      '核心读者承诺｜中｜核心承诺连续两场没有推进',
    ])

    for (const frontMatter of [
      { ...reviewedPayload.frontMatter, 标题: '审后改名' },
      { ...reviewedPayload.frontMatter, 收卷: '是' },
      { ...reviewedPayload.frontMatter, 伏笔: ['埋下 伏笔-099'] },
    ]) {
      const tampered = await applyReviewOutcome(root, 3, {
        frontMatter,
        body: reviewedPayload.body,
      })
      assert.equal(tampered.ok, false)
      assert.match(tampered.error, /章档案与被审草稿不一致/)
    }

    const wrongChapter = await applyReviewOutcome(root, 3, {
      frontMatter: { ...reviewedPayload.frontMatter, 章号: 4 },
      body: reviewedPayload.body,
    })
    assert.equal(wrongChapter.ok, false)
    assert.match(wrongChapter.error, /章档案与第 3 章不对应/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('阻断问题立即停止暂存或定稿；缺结构化结果也不能靠手写审稿单绕过', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-review-block-'))
  try {
    const reviewedPayload = {
      frontMatter: { 章号: 3, 标题: '测试' },
      body: '',
    }
    await writeReviewArtifacts(root, 3, [
      {
        severity: 'critical',
        category: 'setting',
        description: '作品契约与本章结局直接冲突',
        contract_clause: '骨架约定',
        blocking: false,
      },
    ], [], reviewedPayload)
    const blocked = await applyReviewOutcome(root, 3, reviewedPayload)
    assert.equal(blocked.ok, false)
    assert.match(blocked.error, /阻断问题/)

    await fs.rm(path.join(root, '工作区', '评审报告'), { recursive: true, force: true })
    const missing = await applyReviewOutcome(root, 3, reviewedPayload)
    assert.equal(missing.ok, false)
    assert.match(missing.error, /结构化审稿结果/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('事实变化绑定结构化审稿结果，省略时自动带回且只能补充真实裁决', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-review-facts-'))
  const pending = {
    planPath: '大纲/创作设计/人物/CHAR-001-林晚.md',
    factPath: '定稿/设定/角色/林晚.md',
    content: '# 林晚\n\n练气四层。',
    decision: '冲突',
    difference: '计划是练气三层，正文写成练气四层。',
    impact: '会改变后续战力基线。',
    options: [
      { optionId: 'keep-plan', label: '改回三层', applyChange: false },
      { optionId: 'accept-draft', label: '接受四层', applyChange: true },
    ],
    removePlan: true,
  }
  const reviewedPayload = {
    frontMatter: { 章号: 3, 标题: '测试' },
    body: '',
  }
  try {
    await writeReviewArtifacts(root, 3, [], [pending], reviewedPayload)
    const restored = await applyReviewOutcome(root, 3, reviewedPayload)
    assert.equal(restored.ok, true, restored.error)
    assert.deepEqual(restored.payload.factChanges, [pending])

    const omitted = await applyReviewOutcome(root, 3, {
      ...reviewedPayload,
      factChanges: [],
    })
    assert.equal(omitted.ok, false)
    assert.match(omitted.error, /不能省略/)

    const resolved = await applyReviewOutcome(root, 3, {
      ...reviewedPayload,
      factChanges: [{
        ...pending,
        decision: '作者已裁决',
        resolution: '作者接受四层，后续按新境界续写。',
        optionId: 'accept-draft',
      }],
    })
    assert.equal(resolved.ok, true, resolved.error)
    assert.equal(resolved.payload.factChanges[0].decision, '作者已裁决')

    const tampered = await applyReviewOutcome(root, 3, {
      ...reviewedPayload,
      factChanges: [{ ...pending, content: '# 林晚\n\n未经审查的改写。' }],
    })
    assert.equal(tampered.ok, false)
    assert.match(tampered.error, /事实审查结果不一致/)

    const missingSemantics = {
      ...pending,
      options: pending.options.map((option) => ({ ...option })),
    }
    delete missingSemantics.options[0].applyChange
    const boundInput = await writeReviewArtifacts(
      root,
      3,
      [],
      [missingSemantics],
      reviewedPayload
    )
    const malformedOption = await applyReviewOutcome(root, 3, reviewedPayload)
    assert.equal(malformedOption.ok, false)
    assert.match(malformedOption.error, /options\[0\]\.applyChange/)

    await fs.writeFile(
      path.join(root, '工作区', '评审报告', '审稿结果.json'),
      JSON.stringify({
        章号: 3,
        issues: [],
        审稿输入令牌: boundInput.审稿输入令牌,
        草稿哈希: reviewedDraftHash(reviewedPayload),
        factChanges: {},
      }),
      'utf8'
    )
    const nonArray = await applyReviewOutcome(root, 3, reviewedPayload)
    assert.equal(nonArray.ok, false)
    assert.match(nonArray.error, /factChanges 必须是数组/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
