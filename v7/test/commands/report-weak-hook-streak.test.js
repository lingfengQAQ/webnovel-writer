import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/report-weak-hook-streak.js'
import { fixtureCtx, repoCtx } from './_helper.js'

test('report-weak-hook-streak fixture 末尾无弱钩 → streak 0', async () => {
  const { ctx, cleanup } = await fixtureCtx()
  try {
    const r = await run([], {}, ctx)
    assert.equal(r.ok, true)
    assert.equal(JSON.parse(r.output).streak, 0)
  } finally {
    await cleanup()
  }
})

test('report-weak-hook-streak 统计末尾连续弱钩（design §6.3）', async () => {
  const { ctx, cleanup } = await repoCtx(null, {
    'book.yaml': 'spec_version: "7.0"\n书名: 测试\n',
    '定稿/正文/0001-起.md': '---\n章号: 1\n标题: 起\n卷: 1\n字数: 100\n章定位: 推进\n钩子: 危机钩-强\n---\n正文。',
    '定稿/正文/0002-承.md': '---\n章号: 2\n标题: 承\n卷: 1\n字数: 100\n章定位: 推进\n钩子: 情绪钩-弱\n---\n正文。',
    '定稿/正文/0003-转.md': '---\n章号: 3\n标题: 转\n卷: 1\n字数: 100\n章定位: 推进\n钩子: 悬念钩-弱\n---\n正文。',
  })
  try {
    const r = await run([], {}, ctx)
    assert.equal(r.ok, true)
    // 第3、2章弱钩，第1章强钩 → 末尾连续 2
    assert.equal(JSON.parse(r.output).streak, 2)
  } finally {
    await cleanup()
  }
})
