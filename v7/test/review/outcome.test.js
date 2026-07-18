import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { applyReviewOutcome } from '../../src/review/outcome.js'
import { writeReviewArtifacts } from '../staging/_helper.js'

test('结构化审稿结果把实际契约问题写入章档案，普通问题不进入', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-review-outcome-'))
  try {
    await writeReviewArtifacts(root, 3, [
      {
        severity: 'medium',
        category: 'pacing',
        description: '核心承诺连续两场没有推进',
        contract_clause: '核心读者承诺',
        blocking: false,
      },
      { severity: 'low', category: 'structure', description: '转场略硬', blocking: false },
    ])
    const result = await applyReviewOutcome(root, 3, {
      frontMatter: { 章号: 3, 标题: '测试' },
      body: '正文。',
    })
    assert.equal(result.ok, true, result.error)
    assert.deepEqual(result.payload.frontMatter.契约问题, [
      '核心读者承诺｜中｜核心承诺连续两场没有推进',
    ])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('阻断问题立即停止暂存或定稿；缺结构化结果也不能靠手写审稿单绕过', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-review-block-'))
  try {
    await writeReviewArtifacts(root, 3, [
      {
        severity: 'critical',
        category: 'setting',
        description: '作品契约与本章结局直接冲突',
        contract_clause: '骨架约定',
        blocking: false,
      },
    ])
    const blocked = await applyReviewOutcome(root, 3, {
      frontMatter: { 章号: 3, 标题: '测试' },
    })
    assert.equal(blocked.ok, false)
    assert.match(blocked.error, /阻断问题/)

    await fs.rm(path.join(root, '工作区', '评审报告'), { recursive: true, force: true })
    const missing = await applyReviewOutcome(root, 3, {
      frontMatter: { 章号: 3, 标题: '测试' },
    })
    assert.equal(missing.ok, false)
    assert.match(missing.error, /结构化审稿结果/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
