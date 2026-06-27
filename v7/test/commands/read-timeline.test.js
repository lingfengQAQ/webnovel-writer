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

test('read-timeline --current-volume 返回当前卷时间线', async () => {
  const r = await run([], { 'current-volume': true }, ctx)
  assert.equal(r.ok, true)
  assert.ok(Array.isArray(JSON.parse(r.output)))
})

test('read-timeline --卷=1 返回指定卷时间线', async () => {
  const r = await run([], { 卷: '1' }, ctx)
  assert.equal(r.ok, true)
  assert.ok(JSON.parse(r.output).length >= 1)
})

test('read-timeline --在场=林晚 只返回该角色在场的行', async () => {
  const r = await run([], { 在场: '林晚' }, ctx)
  assert.equal(r.ok, true)
  const rows = JSON.parse(r.output)
  assert.ok(rows.length >= 1)
  assert.ok(rows.every((e) => e.在场.includes('林晚')))
})

test('read-timeline 无任何选项 → ok=false（提示需指定）', async () => {
  const r = await run([], {}, ctx)
  assert.equal(r.ok, false)
})
