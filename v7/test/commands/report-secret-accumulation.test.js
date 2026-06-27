import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/report-secret-accumulation.js'
import { fixtureCtx } from './_helper.js'

let ctx, cleanup
before(async () => {
  ;({ ctx, cleanup } = await fixtureCtx())
})
after(async () => {
  await cleanup()
})

test('report-secret-accumulation 返回未揭晓信息差 + 蓄积章数', async () => {
  const r = await run([], {}, ctx)
  assert.equal(r.ok, true)
  const rows = JSON.parse(r.output)
  const one = rows.find((s) => s.id === '信息差-001')
  assert.ok(one, `应含 信息差-001，实际：${r.output}`)
  assert.equal(one.蓄积章数, 1) // max 2 − 登记章 1
})
