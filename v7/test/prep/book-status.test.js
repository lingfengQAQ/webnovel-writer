import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { assembleBookStatus } from '../../src/prep/book-status.js'
import { fixtureCtx } from '../commands/_helper.js'

let ctx, cleanup
before(async () => {
  ;({ ctx, cleanup } = await fixtureCtx())
})
after(async () => {
  await cleanup()
})

test('assembleBookStatus 产结构化近况 + Markdown', async () => {
  const r = await assembleBookStatus(ctx)
  assert.equal(r.ok, true)
  // fixture：2 章、卷 1、卷规模 40
  assert.equal(r.data.当前卷, 1)
  assert.equal(r.data.卷内进度.写到, 2)
  assert.equal(r.data.卷内进度.卷规模, 40)
  assert.equal(r.data.总章数, 2)
  assert.equal(r.data.连续弱钩, 0)
  assert.ok(Array.isArray(r.data.悬了太久))
  assert.match(r.markdown, /第\s*1\s*卷/)
  assert.match(r.markdown, /连续弱钩/)
})
