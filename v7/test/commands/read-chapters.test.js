import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/read-chapters.js'
import { fixtureCtx } from './_helper.js'

let ctx, cleanup
before(async () => {
  ;({ ctx, cleanup } = await fixtureCtx())
})
after(async () => {
  await cleanup()
})

test('read-chapters --range=1-2 --摘要 返回范围内各章摘要', async () => {
  const r = await run([], { range: '1-2', 摘要: true }, ctx)
  assert.equal(r.ok, true)
  const rows = JSON.parse(r.output)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].章号, 1)
  assert.ok(rows[0].摘要.length > 0)
})

test('read-chapters --recent=1 --tail=8 返回近 1 章结尾', async () => {
  const r = await run([], { recent: '1', tail: '8' }, ctx)
  assert.equal(r.ok, true)
  const rows = JSON.parse(r.output)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].章号, 2) // 最新章
  assert.ok([...rows[0].结尾].length <= 8)
})

test('read-chapters 缺选项 → ok=false', async () => {
  const r = await run([], {}, ctx)
  assert.equal(r.ok, false)
})
