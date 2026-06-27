import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/read-worldview.js'
import { fixtureCtx } from './_helper.js'

let ctx, cleanup
before(async () => {
  ;({ ctx, cleanup } = await fixtureCtx())
})
after(async () => {
  await cleanup()
})

test('read-worldview --section=修炼体系 返回该小节', async () => {
  const r = await run([], { section: '修炼体系' }, ctx)
  assert.equal(r.ok, true)
  assert.ok(r.output.includes('练气'))
  assert.ok(!r.output.includes('## 势力'))
})

test('read-worldview 缺 --section → ok=false', async () => {
  const r = await run([], {}, ctx)
  assert.equal(r.ok, false)
})

test('read-worldview 不存在的小节 → ok=false', async () => {
  const r = await run([], { section: '不存在的节' }, ctx)
  assert.equal(r.ok, false)
})
