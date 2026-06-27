import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/read-timeline.js'
import { fixtureCtx } from './_helper.js'

let ctx, cleanup
before(async () => {
  ;({ ctx, cleanup } = await fixtureCtx())
})
after(async () => {
  await cleanup()
})

test('read-timeline --current-and-prev 返回时间线数组', async () => {
  const r = await run([], { 'current-and-prev': true }, ctx)
  assert.equal(r.ok, true)
  const timeline = JSON.parse(r.output)
  assert.ok(Array.isArray(timeline))
  assert.ok(timeline.length >= 1)
})

test('read-timeline 无任何选项 → ok=false（提示需指定）', async () => {
  const r = await run([], {}, ctx)
  assert.equal(r.ok, false)
})
