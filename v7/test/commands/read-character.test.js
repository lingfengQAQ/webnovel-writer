import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/read-character.js'
import { fixtureCtx } from './_helper.js'

let ctx, cleanup
before(async () => {
  ;({ ctx, cleanup } = await fixtureCtx())
})
after(async () => {
  await cleanup()
})

test('read-character --front-matter 返回 JSON 含姓名', async () => {
  const r = await run(['林晚'], { 'front-matter': true }, ctx)
  assert.equal(r.ok, true)
  const data = JSON.parse(r.output)
  assert.equal(data.姓名, '林晚')
})

test('read-character 默认返回完整（frontMatter + body）', async () => {
  const r = await run(['林晚'], {}, ctx)
  assert.equal(r.ok, true)
  const data = JSON.parse(r.output)
  assert.ok(data.frontMatter)
  assert.ok(data.body.includes('设定'))
})

test('read-character --section=设定 返回该小节', async () => {
  const r = await run(['林晚'], { section: '设定' }, ctx)
  assert.equal(r.ok, true)
  assert.ok(r.output.includes('外门弟子'))
})

test('read-character 缺正名 → ok=false', async () => {
  const r = await run([], {}, ctx)
  assert.equal(r.ok, false)
})

test('read-character 不存在的角色 → ok=false 且不崩', async () => {
  const r = await run(['查无此人'], { 'front-matter': true }, ctx)
  assert.equal(r.ok, false)
  assert.match(r.error, /不存在/)
})
