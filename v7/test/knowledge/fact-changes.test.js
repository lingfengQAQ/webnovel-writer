import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import {
  factContentHash,
  validateFactChanges,
} from '../../src/knowledge/fact-changes.js'
import { designFixture } from './_design-fixture.js'
import { FACT_PATH, PLAN_PATH, factFixture as fact } from './_fact-fixture.js'

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-fact-validation-'))
  const plan = path.join(root, ...PLAN_PATH.split('/'))
  await fs.mkdir(path.dirname(plan), { recursive: true })
  await fs.writeFile(plan, designFixture(), 'utf8')
  return { root, cleanup: () => fs.rm(root, { recursive: true, force: true }) }
}

test('首次事实转正：计划存在、无冲突且路径安全时通过', async () => {
  const { root, cleanup } = await fixture()
  try {
    const result = await validateFactChanges(root, [{
      planPath: PLAN_PATH,
      factPath: FACT_PATH,
      content: fact(),
      decision: '无冲突',
      removePlan: true,
    }])
    assert.equal(result.ok, true, result.errors.join('；'))
    assert.equal(result.changes[0].removePlan, true)
  } finally {
    await cleanup()
  }
})

test('冲突、歧义和未说明的作者裁决全部在写盘前停止', async () => {
  const { root, cleanup } = await fixture()
  try {
    for (const decision of ['冲突', '歧义', '作者已裁决']) {
      const result = await validateFactChanges(root, [{
        planPath: PLAN_PATH,
        factPath: FACT_PATH,
        content: fact(),
        decision,
        removePlan: true,
      }])
      assert.equal(result.ok, false)
      assert.ok(result.errors.some((error) => error.includes(decision === '作者已裁决' ? 'resolution' : decision)))
    }
  } finally {
    await cleanup()
  }
})

test('覆盖既有事实必须匹配哈希；转正后计划已删仍可更新既有事实', async () => {
  const { root, cleanup } = await fixture()
  try {
    const factFile = path.join(root, ...FACT_PATH.split('/'))
    const current = fact()
    await fs.mkdir(path.dirname(factFile), { recursive: true })
    await fs.writeFile(factFile, current, 'utf8')
    await fs.rm(path.join(root, ...PLAN_PATH.split('/')))

    const missing = await validateFactChanges(root, [{
      planPath: PLAN_PATH,
      factPath: FACT_PATH,
      content: fact('练气四层'),
      decision: '作者已裁决',
      resolution: '作者确认本章突破成立',
      removePlan: false,
    }])
    assert.ok(missing.errors.some((error) => error.includes('expectedHash')))

    const drift = await validateFactChanges(root, [{
      planPath: PLAN_PATH,
      factPath: FACT_PATH,
      content: fact('练气四层'),
      decision: '作者已裁决',
      resolution: '作者确认本章突破成立',
      expectedHash: 'sha256:' + '0'.repeat(64),
      removePlan: false,
    }])
    assert.ok(drift.errors.some((error) => error.includes('不一致')))

    const valid = await validateFactChanges(root, [{
      planPath: PLAN_PATH,
      factPath: FACT_PATH,
      content: fact('练气四层'),
      decision: '作者已裁决',
      resolution: '作者确认本章突破成立',
      expectedHash: factContentHash(current),
      removePlan: false,
    }])
    assert.equal(valid.ok, true, valid.errors.join('；'))
  } finally {
    await cleanup()
  }
})

test('路径逃逸和同批重复目标被拒绝', async () => {
  const { root, cleanup } = await fixture()
  try {
    const change = {
      planPath: PLAN_PATH,
      factPath: FACT_PATH,
      content: fact(),
      decision: '无冲突',
      removePlan: true,
    }
    const result = await validateFactChanges(root, [
      { ...change, factPath: '定稿/设定/../../book.yaml' },
      change,
      change,
    ])
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((error) => error.includes('factPath')))
    assert.ok(result.errors.some((error) => error.includes('重复')))
  } finally {
    await cleanup()
  }
})
