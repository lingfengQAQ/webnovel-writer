import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TimelineWriter } from '../../../src/storage/adapters/TimelineWriter.js'
import { makeRepo, cleanup, read } from '../_tmprepo.js'

test('appendRow 向已有卷时间线追加一行', async () => {
  const root = await makeRepo({
    '定稿/设定/时间线/第05卷.md':
      '| 章 | 书内时间 | 一句话事件 | 在场 |\n|---|---|---|---|\n| 151 | 冬月初二 | 旧事 | 林晚 |\n',
  })
  try {
    const r = await new TimelineWriter(root).appendRow(5, {
      章: 152,
      书内时间: '冬月初三',
      一句话事件: '北境得血书',
      在场: '林晚',
    })
    assert.equal(r.ok, true)
    const c = await read(root, '定稿/设定/时间线/第05卷.md')
    assert.match(c, /\| 151 \|/)
    assert.match(c, /\| 152 \| 冬月初三 \| 北境得血书 \| 林晚 \|/)
  } finally {
    await cleanup(root)
  }
})

test('appendRow 文件不存在时新建表头', async () => {
  const root = await makeRepo({})
  try {
    const r = await new TimelineWriter(root).appendRow(1, {
      章: 1,
      书内时间: '春月初一',
      一句话事件: '入宗门',
      在场: '林晚',
    })
    assert.equal(r.ok, true)
    const c = await read(root, '定稿/设定/时间线/第01卷.md')
    assert.match(c, /\| 章 \| 书内时间 \| 一句话事件 \| 在场 \|/)
    assert.match(c, /\| 1 \| 春月初一 \| 入宗门 \| 林晚 \|/)
  } finally {
    await cleanup(root)
  }
})
