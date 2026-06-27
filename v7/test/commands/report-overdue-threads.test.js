import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/commands/report-overdue-threads.js'
import { fixtureCtx, repoCtx } from './_helper.js'

test('report-overdue-threads 在 fixture 上返回合法分组 JSON', async () => {
  const { ctx, cleanup } = await fixtureCtx()
  try {
    const r = await run([], {}, ctx)
    assert.equal(r.ok, true)
    const grouped = JSON.parse(r.output)
    assert.equal(typeof grouped, 'object')
  } finally {
    await cleanup()
  }
})

test('report-overdue-threads 检出真正悬了太久的条目并按类型分组（AC9）', async () => {
  // 20 章，伏笔最后推进在第 1 章 → 悬了 19 章 > 阈值 10
  const chapters = {}
  for (let i = 1; i <= 20; i++) {
    const n = String(i).padStart(4, '0')
    chapters[`定稿/正文/${n}-第${i}章.md`] =
      `---\n章号: ${i}\n标题: 第${i}章\n卷: 1\n字数: 100\n章定位: 推进\n---\n正文。`
  }
  const { ctx, cleanup } = await repoCtx(null, {
    'book.yaml': 'spec_version: "7.0"\n书名: 测试\n伏笔悬了太久章数: 10\n',
    '定稿/设定/名册.md': '| 正名 | 别名 | 类型 | 首现章 |\n|--|--|--|--|\n| 甲 | 乙 | character | 1 |\n',
    '大纲/伏笔/伏笔-001-老坑.md':
      '---\n强度: 高\n状态: 进行\n开启章: 1\n最后推进章: 1\n---\n## 描述\n埋了很久。',
    ...chapters,
  })
  try {
    const r = await run([], {}, ctx)
    assert.equal(r.ok, true)
    const grouped = JSON.parse(r.output)
    assert.ok(grouped.foreshadow, `应按类型分组检出伏笔，实际：${r.output}`)
    assert.equal(grouped.foreshadow[0].id, '伏笔-001')
  } finally {
    await cleanup()
  }
})
