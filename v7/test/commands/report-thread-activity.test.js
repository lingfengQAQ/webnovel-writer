import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/report-thread-activity.js'
import { fixtureCtx } from './_helper.js'

let ctx, cleanup
before(async () => {
  ;({ ctx, cleanup } = await fixtureCtx())
})
after(async () => {
  await cleanup()
})

test('report-thread-activity --卷=1 返回本卷开/推进/收尾', async () => {
  const r = await run([], { 卷: '1' }, ctx)
  assert.equal(r.ok, true)
  const rep = JSON.parse(r.output)
  assert.equal(rep.卷, 1)
  const openedIds = rep.本卷开.map((t) => t.id)
  assert.ok(openedIds.includes('伏笔-001')) // 开启章 1 在第1卷范围
  assert.deepEqual(rep.本卷收尾, []) // fixture 无已收尾
})

test('report-thread-activity 缺 --卷 → ok=false', async () => {
  const r = await run([], {}, ctx)
  assert.equal(r.ok, false)
})
