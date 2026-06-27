import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/list-chapters.js'
import { fixtureCtx } from './_helper.js'

let ctx, cleanup
before(async () => {
  ;({ ctx, cleanup } = await fixtureCtx())
})
after(async () => {
  await cleanup()
})

test('list-chapters --章定位=推进 返回该定位的章节', async () => {
  const r = await run([], { 章定位: '推进' }, ctx)
  assert.equal(r.ok, true)
  const rows = JSON.parse(r.output)
  const nums = rows.map((c) => c.chapter_num).sort()
  assert.deepEqual(nums, [1, 2])
})

test('list-chapters --章定位=推进 --卷=1 受卷过滤', async () => {
  const r = await run([], { 章定位: '推进', 卷: '1' }, ctx)
  assert.equal(r.ok, true)
  assert.equal(JSON.parse(r.output).length, 2)
})

test('list-chapters 空结果（无日常章）→ ok 且空数组', async () => {
  const r = await run([], { 章定位: '日常' }, ctx)
  assert.equal(r.ok, true)
  assert.deepEqual(JSON.parse(r.output), [])
})

test('list-chapters 缺 --章定位 → ok=false', async () => {
  const r = await run([], {}, ctx)
  assert.equal(r.ok, false)
})
