import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeImpact } from '../../../src/state-machine/flows/impact.js'
import { makeGitBook, chapter } from '../_helper.js'

test('影响分析：按已发布到章分两清单 + 履历/时间线命中', async () => {
  const { ctx, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n已发布到章: 1\n',
    '定稿/正文/0001-起.md': chapter(1, '林晚得到玉佩。'),
    '定稿/正文/0002-承.md': chapter(2, '玉佩再次发光。'),
    '定稿/正文/0003-转.md': chapter(3, '与玉佩无关的一章。'.replace('玉佩', '令牌')),
    '大纲/伏笔/伏笔-001-玉佩.md': '---\n强度: 高\n状态: 进行\n开启章: 1\n---\n## 履历\n- 第1章：埋下玉佩',
    '定稿/设定/时间线/第01卷.md': '| 章 | 书内时间 | 一句话事件 | 在场 |\n|--|--|--|--|\n| 1 | 春 | 得玉佩 | 林晚 |',
  })
  try {
    const r = await analyzeImpact(ctx, { 关键词: '玉佩' })
    assert.equal(r.ok, true)
    assert.deepEqual(r.已发布, [1]) // 第1章已发布
    assert.deepEqual(r.未发布, [2]) // 第2章未发布；第3章不含玉佩
    assert.ok(r.履历命中.some((f) => f.includes('伏笔-001')))
    assert.ok(r.时间线命中.some((f) => f.includes('第01卷')))
  } finally {
    await cleanup()
  }
})

test('影响分析：缺关键词 → ok=false', async () => {
  const { ctx, cleanup } = await makeGitBook({ 'book.yaml': '书名: 测\n' })
  try {
    const r = await analyzeImpact(ctx, {})
    assert.equal(r.ok, false)
  } finally {
    await cleanup()
  }
})
