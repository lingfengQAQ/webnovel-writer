import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChapterWriter } from '../../../src/storage/adapters/ChapterWriter.js'
import { ThreadLedgerWriter } from '../../../src/storage/adapters/ThreadLedgerWriter.js'

// Writer 端口在 M1 只定接口占位，调用应抛明确的 M2 提示（不静默成功）
test('ChapterWriter 方法抛 M2 占位错误', async () => {
  const w = new ChapterWriter('/x')
  await assert.rejects(() => w.writeChapter(1, {}, ''), /M2/)
  await assert.rejects(() => w.updateFrontMatter(1, {}), /M2/)
})

test('ThreadLedgerWriter 方法抛 M2 占位错误', async () => {
  const w = new ThreadLedgerWriter('/x')
  await assert.rejects(() => w.updateThread('伏笔-001', {}), /M2/)
  await assert.rejects(() => w.appendHistory('伏笔-001', {}), /M2/)
})
