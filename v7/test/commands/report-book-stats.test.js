import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/report-book-stats.js'
import { fixtureCtx } from './_helper.js'

let ctx, cleanup
before(async () => {
  ;({ ctx, cleanup } = await fixtureCtx())
})
after(async () => {
  await cleanup()
})

test('report-book-stats 返回总章数/总字数/条目数/角色数', async () => {
  const r = await run([], {}, ctx)
  assert.equal(r.ok, true)
  const s = JSON.parse(r.output)
  assert.equal(s.总章数, 2)
  assert.equal(s.总字数, 5400) // 2800 + 2600
  assert.equal(s.条目数, 3) // 伏笔-001 + 悬念-001 + 感情线-001
  assert.equal(s.角色数, 2) // 林晚 + 神秘老者
})
