import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/list-characters.js'
import { fixtureCtx } from './_helper.js'

let ctx, cleanup
before(async () => {
  ;({ ctx, cleanup } = await fixtureCtx())
})
after(async () => {
  await cleanup()
})

test('list-characters 列出所有角色', async () => {
  const r = await run([], {}, ctx)
  assert.equal(r.ok, true)
  const rows = JSON.parse(r.output)
  const names = rows.map((c) => c.正名 ?? c.id)
  assert.ok(names.includes('林晚'))
  assert.ok(names.includes('神秘老者'))
})

test('list-characters --status=在世 按状态筛选', async () => {
  const r = await run([], { status: '在世' }, ctx)
  assert.equal(r.ok, true)
  const rows = JSON.parse(r.output)
  assert.ok(rows.some((c) => (c.正名 ?? c.id) === '林晚'))
  assert.ok(rows.every((c) => c.status === '在世' || c.状态 === '在世'))
})
