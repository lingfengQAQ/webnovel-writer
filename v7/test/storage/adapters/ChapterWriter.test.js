import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { ChapterWriter } from '../../../src/storage/adapters/ChapterWriter.js'
import { makeRepo, cleanup, read } from '../_tmprepo.js'

const listChapters = (root) =>
  fs.readdir(path.join(root, '定稿', '正文')).then((fs_) => fs_.filter((f) => f.endsWith('.md')))

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

test('ChapterWriter.writeChapter 重写同章改标题 → 删旧文件（P0-3a：不撞 PRIMARY KEY）', async () => {
  const root = await makeRepo()
  try {
    const w = new ChapterWriter(root)
    await w.writeChapter(5, { 章号: 5, 标题: '旧题', 卷: 1 }, '正文')
    let files = await listChapters(root)
    assert.equal(files.length, 1)
    await w.writeChapter(5, { 章号: 5, 标题: '新题', 卷: 1 }, '正文')
    files = await listChapters(root)
    assert.equal(files.length, 1, '重写同章应删旧文件，不留两条同章号 → scanChapters 不再撞 PRIMARY KEY')
    assert.ok(files[0].includes('新题'))
  } finally {
    await cleanup(root)
  }
})

test('ChapterWriter.writeChapter 标题含 Windows 非法字符 → 文件名净化不炸写盘（P2-1）', async () => {
  const root = await makeRepo()
  try {
    const w = new ChapterWriter(root)
    const r = await w.writeChapter(7, { 章号: 7, 标题: 'a:b?c*d"e|f<g>', 卷: 1 }, '正文')
    assert.equal(r.ok, true, r.error)
    const files = await listChapters(root)
    assert.equal(files.length, 1)
    assert.ok(!/[<>:"/\\|?*]/.test(files[0]), '文件名应剔除 Windows 非法字符')
    // 标题本体在 front matter 里保留（可能被 YAML 加引号，只断子串）
    const content = await read(root, `定稿/正文/${files[0]}`)
    assert.match(content, /a:b\?c\*d/)
  } finally {
    await cleanup(root)
  }
})
