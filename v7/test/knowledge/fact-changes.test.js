import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import {
  factContentHash,
  formatFactChangeValidationError,
  validateFactChanges,
} from '../../src/knowledge/fact-changes.js'
import { designFixture } from './_design-fixture.js'
import { FACT_PATH, PLAN_PATH, factFixture as fact } from './_fact-fixture.js'

const DECISION_DETAILS = {
  difference: '计划写林晚仍在练气三层，正文却让她突破到练气四层。',
  impact: '若按正文转正，后续战力、对手安排和角色卡境界都要以练气四层为准。',
  options: [
    {
      optionId: 'keep-plan',
      label: '保留练气三层',
      description: '修改正文，不转正本次突破。',
      applyChange: false,
    },
    {
      optionId: 'accept-breakthrough',
      label: '接受练气四层',
      description: '按正文更新事实并调整后续安排。',
      applyChange: true,
    },
  ],
}

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
      options: [],
      removePlan: true,
    }])
    assert.equal(result.ok, true, result.errors.join('；'))
    assert.equal(result.changes[0].applyChange, true)
    assert.equal(result.changes[0].removePlan, true)
    assert.equal(result.changes[0].options, undefined, '普通无冲突转正不新增裁决负担')
  } finally {
    await cleanup()
  }
})

test('作者裁决只从命中的审稿选项派生执行语义，false 归一为 no-op', async () => {
  const { root, cleanup } = await fixture()
  try {
    const base = {
      planPath: PLAN_PATH,
      factPath: FACT_PATH,
      content: fact('练气四层'),
      decision: '作者已裁决',
      ...DECISION_DETAILS,
      resolution: '作者完成裁决。',
      removePlan: true,
    }
    const kept = await validateFactChanges(root, [{ ...base, optionId: 'keep-plan' }])
    assert.equal(kept.ok, true, kept.errors.join('；'))
    assert.equal(kept.changes[0].applyChange, false)
    assert.equal(kept.changes[0].removePlan, false)
    assert.equal(kept.changes[0].options[0].applyChange, false)

    const accepted = await validateFactChanges(root, [{
      ...base,
      optionId: 'accept-breakthrough',
    }])
    assert.equal(accepted.ok, true, accepted.errors.join('；'))
    assert.equal(accepted.changes[0].applyChange, true)
    assert.equal(accepted.changes[0].removePlan, true)

    const malformedOptions = DECISION_DETAILS.options.map((option) => ({ ...option }))
    delete malformedOptions[0].applyChange
    const malformed = await validateFactChanges(root, [{
      ...base,
      options: malformedOptions,
      optionId: 'keep-plan',
    }])
    assert.equal(malformed.ok, false)
    assert.ok(malformed.errors.some((error) => error.includes('options[0].applyChange')))

    const forged = await validateFactChanges(root, [{
      ...base,
      optionId: 'keep-plan',
      applyChange: true,
    }])
    assert.equal(forged.ok, false)
    assert.ok(forged.errors.some((error) => error.includes('执行语义不一致')))
  } finally {
    await cleanup()
  }
})

test('冲突、歧义和缺少选项编号的作者裁决全部在写盘前停止', async () => {
  const { root, cleanup } = await fixture()
  try {
    for (const decision of ['冲突', '歧义', '作者已裁决']) {
      const result = await validateFactChanges(root, [{
        planPath: PLAN_PATH,
        factPath: FACT_PATH,
        content: fact(),
        decision,
        ...DECISION_DETAILS,
        removePlan: true,
      }])
      assert.equal(result.ok, false)
      if (decision === '作者已裁决') {
        assert.ok(result.errors.some((error) => error.includes('resolution')))
        assert.ok(result.errors.some((error) => error.includes('optionId')))
      } else {
        assert.ok(result.errors.some((error) => error.includes(decision)))
      }
    }
  } finally {
    await cleanup()
  }
})

test('冲突呈报缺差异、影响或处理选项时拒绝；完整呈报进入统一作者提示', async () => {
  const { root, cleanup } = await fixture()
  try {
    const incomplete = await validateFactChanges(root, [{
      planPath: PLAN_PATH,
      factPath: FACT_PATH,
      content: fact(),
      decision: '冲突',
      removePlan: true,
    }])
    assert.equal(incomplete.ok, false)
    for (const field of ['difference', 'impact', 'options']) {
      assert.ok(incomplete.errors.some((error) => error.includes(field)), field)
    }

    const complete = await validateFactChanges(root, [{
      planPath: PLAN_PATH,
      factPath: FACT_PATH,
      content: fact(),
      decision: '冲突',
      ...DECISION_DETAILS,
      removePlan: true,
    }])
    const message = formatFactChangeValidationError(complete)
    assert.match(message, /计划写林晚仍在练气三层/)
    assert.match(message, /后续战力、对手安排和角色卡境界/)
    assert.match(message, /keep-plan：保留练气三层/)
    assert.match(message, /accept-breakthrough：接受练气四层/)
    assert.match(message, /resolution 和所选 optionId/)
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
      options: DECISION_DETAILS.options,
      resolution: '作者确认本章突破成立',
      optionId: 'accept-breakthrough',
      removePlan: false,
    }])
    assert.ok(missing.errors.some((error) => error.includes('expectedHash')))

    const drift = await validateFactChanges(root, [{
      planPath: PLAN_PATH,
      factPath: FACT_PATH,
      content: fact('练气四层'),
      decision: '作者已裁决',
      options: DECISION_DETAILS.options,
      resolution: '作者确认本章突破成立',
      optionId: 'accept-breakthrough',
      expectedHash: 'sha256:' + '0'.repeat(64),
      removePlan: false,
    }])
    assert.ok(drift.errors.some((error) => error.includes('不一致')))

    const valid = await validateFactChanges(root, [{
      planPath: PLAN_PATH,
      factPath: FACT_PATH,
      content: fact('练气四层'),
      decision: '作者已裁决',
      options: DECISION_DETAILS.options,
      resolution: '作者确认本章突破成立',
      optionId: 'accept-breakthrough',
      expectedHash: factContentHash(current),
      removePlan: false,
    }])
    assert.equal(valid.ok, true, valid.errors.join('；'))
    assert.equal(valid.changes[0].optionId, 'accept-breakthrough')
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
