import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/list-volumes.js'
import { fixtureCtx } from './_helper.js'

let ctx, cleanup
before(async () => {
  ;({ ctx, cleanup } = await fixtureCtx())
})
after(async () => {
  await cleanup()
})

test('list-volumes 返回卷号与章数范围', async () => {
  const r = await run([], {}, ctx)
  assert.equal(r.ok, true)
  const vols = JSON.parse(r.output)
  const v1 = vols.find((v) => v.卷号 === 1)
  assert.ok(v1, `应含第1卷，实际：${r.output}`)
  assert.equal(v1.起始章, 1)
  assert.equal(v1.结束章, 2)
})
