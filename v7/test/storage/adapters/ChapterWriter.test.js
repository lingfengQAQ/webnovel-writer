import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChapterWriter } from '../../../src/storage/adapters/ChapterWriter.js'
import { makeRepo, cleanup, read } from '../_tmprepo.js'

test('ChapterWriter.writeChapter 写出定稿正文（防呆 front matter + 正文）', async () => {
  const root = await makeRepo()
  try {
    const w = new ChapterWriter(root)
    const fm = {
      章号: 152,
      标题: '北境的雪',
      卷: 5,
      字数: 3120,
      章定位: '推进',
      伏笔: ['埋下 伏笔-058'],
    }
    const r = await w.writeChapter(152, fm, '正文第一段。\n')
    assert.equal(r.ok, true)
    const content = await read(root, '定稿/正文/0152-北境的雪.md')
    assert.match(content, /^---\n/)
    assert.match(content, /标题: 北境的雪/)
    assert.match(content, /伏笔:\n {2}- 埋下 伏笔-058/) // 块列表防呆，两空格缩进
    assert.match(content, /正文第一段。/)
  } finally {
    await cleanup(root)
  }
})

test('ChapterWriter.writeChapter 危险值加引号（防呆）', async () => {
  const root = await makeRepo()
  try {
    const w = new ChapterWriter(root)
    const r = await w.writeChapter(1, { 章号: 1, 标题: '123', 卷: 1 }, '正文')
    assert.equal(r.ok, true)
    const content = await read(root, '定稿/正文/0001-123.md')
    assert.match(content, /标题: "123"/) // 纯数字串加引号
  } finally {
    await cleanup(root)
  }
})
