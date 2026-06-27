import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/read-outline.js'
import { fixtureCtx } from './_helper.js'

let ctx, cleanup
before(async () => {
  ;({ ctx, cleanup } = await fixtureCtx())
})
after(async () => {
  await cleanup()
})

test('read-outline --总纲 --结局 返回结局段', async () => {
  const r = await run([], { 总纲: true, 结局: true }, ctx)
  assert.equal(r.ok, true)
  assert.ok(r.output.includes('血仇得报'))
})

test('read-outline --总纲 --section=核心冲突 返回该小节', async () => {
  const r = await run([], { 总纲: true, section: '核心冲突' }, ctx)
  assert.equal(r.ok, true)
  assert.ok(r.output.includes('灭门血仇'))
})

test('read-outline --卷=1 返回卷纲全文', async () => {
  const r = await run([], { 卷: '1' }, ctx)
  assert.equal(r.ok, true)
  assert.ok(r.output.includes('卷定位'))
})

test('read-outline --卷=1 --section=卷定位 返回卷内小节', async () => {
  const r = await run([], { 卷: '1', section: '卷定位' }, ctx)
  assert.equal(r.ok, true)
  assert.ok(r.output.includes('开篇立人设'))
})

test('read-outline 不存在的卷 → ok=false', async () => {
  const r = await run([], { 卷: '99' }, ctx)
  assert.equal(r.ok, false)
})
