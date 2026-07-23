import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCHEMA_EXAMPLE, validateReviewReport } from '../../src/review/schema.js'

const issue = (over = {}) => ({
  severity: 'high',
  category: 'setting',
  location: '第3段',
  description: '境界矛盾',
  evidence: '正文"金丹" vs 角色卡"练气"',
  fix_hint: '改回练气',
  blocking: false,
  ...over,
})

test('角色 schema 示例含可原样回传的合法审稿输入令牌', () => {
  assert.match(SCHEMA_EXAMPLE.审稿输入令牌, /^sha256:[0-9a-f]{64}$/)
  const r = validateReviewReport(SCHEMA_EXAMPLE, { reviewType: 'factCheck' })
  assert.equal(r.ok, true, r.errors.join('；'))
  assert.equal(r.report.审稿输入令牌, SCHEMA_EXAMPLE.审稿输入令牌)
})

test('合法事实审查报告：通过 + 计数复算', async () => {
  const r = validateReviewReport({ chapter: 5, issues: [issue(), issue({ category: 'timeline' })], issues_count: 99 }, { reviewType: 'factCheck' })
  assert.equal(r.ok, true)
  assert.equal(r.errors.length, 0)
  assert.equal(r.report.issues_count, 2, '计数应被复算覆盖伪造的 99')
})

test('critical → 强制 blocking=true（即便 AI 报 false）', async () => {
  const r = validateReviewReport({ chapter: 5, issues: [issue({ severity: 'critical', blocking: false })] }, { reviewType: 'factCheck' })
  assert.equal(r.report.issues[0].blocking, true)
  assert.equal(r.report.has_blocking, true)
})

test('unregistered_thread（D3）→ 强制 blocking=false（即便 AI 报 true）', async () => {
  const r = validateReviewReport(
    { chapter: 5, issues: [issue({ category: 'unregistered_thread', severity: 'high', blocking: true })] },
    { reviewType: 'factCheck' }
  )
  assert.equal(r.report.issues[0].blocking, false, 'D3 即兴伏笔候选恒非阻断')
  assert.equal(r.report.blocking_count, 0)
})

test('category 分域：编辑审 category 出现在事实审查 → 报错', async () => {
  const r = validateReviewReport({ chapter: 5, issues: [issue({ category: 'pacing' })] }, { reviewType: 'factCheck' })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('越界')))
})

test('category 分域：事实审查 category 出现在编辑审 → 报错', async () => {
  const r = validateReviewReport({ chapter: 5, issues: [issue({ category: 'setting' })] }, { reviewType: 'editorial' })
  assert.equal(r.ok, false)
})

test('编辑审合法 category 通过', async () => {
  const r = validateReviewReport({ chapter: 5, issues: [issue({ category: 'structure' })] }, { reviewType: 'editorial' })
  assert.equal(r.ok, true)
})

test('作品契约问题只接受明确的契约条款标识', () => {
  const valid = validateReviewReport(
    { chapter: 5, issues: [issue({ contract_clause: '冲突与关系结算原则/主角底线' })] },
    { reviewType: 'factCheck' }
  )
  assert.equal(valid.ok, true)
  assert.equal(valid.report.issues[0].contract_clause, '冲突与关系结算原则/主角底线')

  const invalid = validateReviewReport(
    { chapter: 5, issues: [issue({ contract_clause: '模型猜测的条款' })] },
    { reviewType: 'factCheck' }
  )
  assert.equal(invalid.ok, false)
  assert.ok(invalid.errors.some((error) => error.includes('contract_clause')))
})

test('差异化 issue 用 差异化点/<具体项> 口径可通过正式 schema', () => {
  const clause = '差异化点/系统情报只在行动前有效'
  const valid = validateReviewReport(
    {
      chapter: 5,
      issues: [issue({
        category: 'commercial',
        description: '系统答案永久正确，差异机制未形成行动因果',
        evidence: '契约要求情报只在行动前有效，正文却让答案永久有效',
        fix_hint: '让行动改变条件，并迫使角色重新验证情报',
        contract_clause: clause,
      })],
    },
    { reviewType: 'editorial' }
  )
  assert.equal(valid.ok, true, valid.errors.join('；'))
  assert.equal(valid.report.issues[0].contract_clause, clause)

  for (const contract_clause of [
    '差异化点',
    '差异化点/',
    '差异化点/   ',
    '差异化点：系统情报只在行动前有效',
  ]) {
    const invalid = validateReviewReport(
      { chapter: 5, issues: [issue({ category: 'commercial', contract_clause })] },
      { reviewType: 'editorial' }
    )
    assert.equal(invalid.ok, false)
    assert.ok(invalid.errors.some((error) => error.includes('contract_clause')))
  }
})

test('缺字段 / 非法 severity → 报错', async () => {
  const r = validateReviewReport(
    { chapter: 5, issues: [{ severity: 'fatal', category: 'setting', description: '' }] },
    { reviewType: 'factCheck' }
  )
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('severity')))
  assert.ok(r.errors.some((e) => e.includes('evidence') || e.includes('location') || e.includes('fix_hint')))
})

test('issues 非数组 → ok=false 不抛', async () => {
  const r = validateReviewReport({ chapter: 5 }, { reviewType: 'factCheck' })
  assert.equal(r.ok, false)
  assert.equal(r.report, null)
})

test('P1-2：issues 元素为 null/字符串/数组 → 报错不抛', () => {
  const r = validateReviewReport(
    { chapter: 5, issues: [null, '字符串', [1, 2], issue()] },
    { reviewType: 'factCheck' }
  )
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('issues[0]')), '应报 issues[0] 非对象')
  assert.ok(r.errors.some((e) => e.includes('issues[1]')), '应报 issues[1] 非对象')
  assert.ok(r.errors.some((e) => e.includes('issues[2]')), '应报 issues[2] 非对象')
})

test('P1-2：blocking 只认严格布尔 true,字符串 "true"/"false" 不当真', () => {
  const r = validateReviewReport(
    { chapter: 5, issues: [issue({ severity: 'high', blocking: 'true' })] },
    { reviewType: 'factCheck' }
  )
  assert.equal(r.ok, true)
  assert.equal(r.report.issues[0].blocking, false, '字符串 "true" 不应转为阻断')
  assert.equal(r.report.blocking_count, 0)

  const rc = validateReviewReport(
    { chapter: 5, issues: [issue({ severity: 'critical', blocking: 'false' })] },
    { reviewType: 'factCheck' }
  )
  assert.equal(rc.report.issues[0].blocking, true, 'critical 强制阻断覆盖')
})
