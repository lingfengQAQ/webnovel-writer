import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/grep-story.js'
import { fixtureCtx } from './_helper.js'

let ctx, cleanup
before(async () => {
  ;({ ctx, cleanup } = await fixtureCtx())
})
after(async () => {
  await cleanup()
})

test('grep-story 关键词命中正文，返回章号与匹配行', async () => {
  const r = await run(['玉佩'], {}, ctx)
  assert.equal(r.ok, true)
  const hits = JSON.parse(r.output)
  assert.ok(hits.length >= 1)
  assert.ok(hits.every((h) => h.匹配行.includes('玉佩')))
  assert.ok(hits.some((h) => h.章号 === 1))
})

test('grep-story 无命中 → ok 且空数组', async () => {
  const r = await run(['绝不存在的词xyz'], {}, ctx)
  assert.equal(r.ok, true)
  assert.deepEqual(JSON.parse(r.output), [])
})

test('grep-story 缺关键词 → ok=false', async () => {
  const r = await run([], {}, ctx)
  assert.equal(r.ok, false)
})
