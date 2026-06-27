import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/read-chapter.js'
import { fixtureCtx } from './_helper.js'

let ctx, cleanup
before(async () => {
  ;({ ctx, cleanup } = await fixtureCtx())
})
after(async () => {
  await cleanup()
})

test('read-chapter --front-matter 返回 JSON 含标题', async () => {
  const r = await run(['1'], { 'front-matter': true }, ctx)
  assert.equal(r.ok, true)
  const data = JSON.parse(r.output)
  assert.equal(data.title ?? data.标题, '开局')
})

test('read-chapter --tail=N 返回正文末尾 N 字', async () => {
  const r = await run(['1'], { tail: '6' }, ctx)
  assert.equal(r.ok, true)
  assert.equal([...r.output].length, 6)
})

test('read-chapter 默认返回正文（不含 front matter）', async () => {
  const r = await run(['1'], {}, ctx)
  assert.equal(r.ok, true)
  assert.ok(!r.output.includes('章号:'))
  assert.ok(r.output.includes('林晚'))
})

test('read-chapter 不存在的章号 → ok=false 且不崩', async () => {
  const r = await run(['999'], { 'front-matter': true }, ctx)
  assert.equal(r.ok, false)
  assert.match(r.error, /不存在/)
})

test('read-chapter 非数字章号 → ok=false', async () => {
  const r = await run(['abc'], {}, ctx)
  assert.equal(r.ok, false)
  assert.match(r.error, /数字/)
})
