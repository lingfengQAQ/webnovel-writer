import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SummaryWriter } from '../../../src/storage/adapters/SummaryWriter.js'
import { makeRepo, cleanup, read } from '../_tmprepo.js'

test('SummaryWriter.writeChapterSummary 写章摘要到 定稿/摘要/章摘要/NNNN.md', async () => {
  const root = await makeRepo()
  try {
    const w = new SummaryWriter(root)
    const r = await w.writeChapterSummary(152, '林晚于北境得血书，玄阶令牌现世。')
    assert.equal(r.ok, true)
    const content = await read(root, '定稿/摘要/章摘要/0152.md')
    assert.match(content, /林晚于北境得血书/)
  } finally {
    await cleanup(root)
  }
})
