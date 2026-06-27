import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ThreadLedgerWriter } from '../../../src/storage/adapters/ThreadLedgerWriter.js'
import { makeRepo, cleanup, read } from '../_tmprepo.js'

const 伏笔文件 = `---
强度: 高
状态: 进行
开启章: 1
最后推进章: 1
---
## 描述
神秘老者身份。

## 履历
- 第1章：埋下——留玉佩
`

test('updateThread 改 front matter，保留正文与履历', async () => {
  const root = await makeRepo({ '大纲/伏笔/伏笔-001-老者.md': 伏笔文件 })
  try {
    const r = await new ThreadLedgerWriter(root).updateThread('伏笔-001', {
      状态: '已收尾',
      最后推进章: 152,
    })
    assert.equal(r.ok, true)
    const c = await read(root, '大纲/伏笔/伏笔-001-老者.md')
    assert.match(c, /状态: 已收尾/)
    assert.match(c, /最后推进章: 152/)
    assert.match(c, /## 履历/)
    assert.match(c, /神秘老者身份/)
  } finally {
    await cleanup(root)
  }
})

test('appendHistory 在 ## 履历 段尾追加一行', async () => {
  const root = await makeRepo({ '大纲/伏笔/伏笔-001-老者.md': 伏笔文件 })
  try {
    const r = await new ThreadLedgerWriter(root).appendHistory(
      '伏笔-001',
      '第152章：推进——林晚取得实证'
    )
    assert.equal(r.ok, true)
    const c = await read(root, '大纲/伏笔/伏笔-001-老者.md')
    assert.match(c, /- 第1章：埋下——留玉佩/)
    assert.match(c, /- 第152章：推进——林晚取得实证/)
  } finally {
    await cleanup(root)
  }
})

test('updateThread 不存在的条目 → ok=false（不崩）', async () => {
  const root = await makeRepo({})
  try {
    const r = await new ThreadLedgerWriter(root).updateThread('伏笔-999', {})
    assert.equal(r.ok, false)
  } finally {
    await cleanup(root)
  }
})
