import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/resolve-alias.js'
import { fixtureCtx } from './_helper.js'

let ctx, cleanup
before(async () => {
  ;({ ctx, cleanup } = await fixtureCtx())
})
after(async () => {
  await cleanup()
})

test('resolve-alias 已登记别名 → 返回正名', async () => {
  const r = await run(['晚晚'], {}, ctx)
  assert.equal(r.ok, true)
  assert.equal(r.output, '林晚')
})

test('resolve-alias 未登记别名 → ok=false（不崩）', async () => {
  const r = await run(['查无此名'], {}, ctx)
  assert.equal(r.ok, false)
  assert.match(r.error, /未找到/)
})

test('resolve-alias 缺参数 → ok=false', async () => {
  const r = await run([], {}, ctx)
  assert.equal(r.ok, false)
})
