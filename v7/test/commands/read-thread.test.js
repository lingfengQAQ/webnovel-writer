import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/read-thread.js'
import { fixtureCtx } from './_helper.js'

let ctx, cleanup
before(async () => {
  ;({ ctx, cleanup } = await fixtureCtx())
})
after(async () => {
  await cleanup()
})

test('read-thread 默认返回基本信息（强度/状态）', async () => {
  const r = await run(['伏笔-001'], {}, ctx)
  assert.equal(r.ok, true)
  const data = JSON.parse(r.output)
  assert.equal(data.strength ?? data.强度, '高')
  assert.equal(data.status ?? data.状态, '进行')
})

test('read-thread --履历 返回履历列表（含章号）', async () => {
  const r = await run(['伏笔-001'], { 履历: true }, ctx)
  assert.equal(r.ok, true)
  const history = JSON.parse(r.output)
  assert.ok(Array.isArray(history))
  assert.ok(history.some((h) => h.章号 === 1))
})

test('read-thread 缺 ID → ok=false', async () => {
  const r = await run([], {}, ctx)
  assert.equal(r.ok, false)
})

test('read-thread 不存在的条目 → ok=false 且不崩', async () => {
  const r = await run(['伏笔-999'], {}, ctx)
  assert.equal(r.ok, false)
  assert.match(r.error, /不存在/)
})
