import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/read-secret.js'
import { fixtureCtx } from './_helper.js'

let ctx, cleanup
before(async () => {
  ;({ ctx, cleanup } = await fixtureCtx())
})
after(async () => {
  await cleanup()
})

test('read-secret --基本信息 返回 JSON（含读者知道/关键词）', async () => {
  const r = await run(['信息差-001'], { 基本信息: true }, ctx)
  assert.equal(r.ok, true)
  const data = JSON.parse(r.output)
  assert.equal(data.读者知道, false)
  assert.ok(Array.isArray(data.关键词))
})

test('read-secret --内容 返回内容段落', async () => {
  const r = await run(['信息差-001'], { 内容: true }, ctx)
  assert.equal(r.ok, true)
  assert.ok(r.output.includes('封印邪灵'))
})

test('read-secret 不存在 → ok=false', async () => {
  const r = await run(['信息差-999'], { 基本信息: true }, ctx)
  assert.equal(r.ok, false)
  assert.match(r.error, /不存在/)
})
