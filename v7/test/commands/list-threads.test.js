import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/list-threads.js'
import { fixtureCtx } from './_helper.js'

let ctx, cleanup
before(async () => {
  ;({ ctx, cleanup } = await fixtureCtx())
})
after(async () => {
  await cleanup()
})

test('list-threads --type=foreshadow 只返回伏笔', async () => {
  const r = await run([], { type: 'foreshadow' }, ctx)
  assert.equal(r.ok, true)
  const rows = JSON.parse(r.output)
  assert.ok(rows.length >= 1)
  assert.ok(rows.every((t) => t.id.startsWith('伏笔')))
})

test('list-threads --type=suspense 只返回悬念', async () => {
  const r = await run([], { type: 'suspense' }, ctx)
  assert.equal(r.ok, true)
  const rows = JSON.parse(r.output)
  assert.ok(rows.some((t) => t.id === '悬念-001'))
})

test('list-threads --strength=高 按强度筛选', async () => {
  const r = await run([], { strength: '高' }, ctx)
  assert.equal(r.ok, true)
  const rows = JSON.parse(r.output)
  assert.ok(rows.every((t) => t.strength === '高'))
  assert.ok(rows.some((t) => t.id === '伏笔-001'))
})

test('list-threads --悬了太久 返回数组（不崩）', async () => {
  const r = await run([], { 悬了太久: true }, ctx)
  assert.equal(r.ok, true)
  assert.ok(Array.isArray(JSON.parse(r.output)))
})

test('list-threads 无筛选 → ok=false 提示', async () => {
  const r = await run([], {}, ctx)
  assert.equal(r.ok, false)
})
