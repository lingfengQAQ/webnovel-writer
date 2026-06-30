import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { gotoChapter } from '../../../src/state-machine/flows/goto-chapter.js'
import { makeGitBook, chapter } from '../_helper.js'

function bookWithChapters() {
  return makeGitBook(
    { 'book.yaml': 'spec_version: "7.0"\n书名: 测\n' },
    {
      commits: [
        { message: 'ch(1): 起', files: { '定稿/正文/0001-起.md': chapter(1) } },
        { message: 'ch(2): 承', files: { '定稿/正文/0002-承.md': chapter(2) } },
      ],
    }
  )
}

test('回到第N章 confirm=false：列出将丢弃的提交', async () => {
  const { ctx, cleanup } = await bookWithChapters()
  try {
    const r = await gotoChapter(ctx, { chapterNum: 1, confirm: false })
    assert.equal(r.ok, true)
    assert.equal(r.needsConfirm, true)
    assert.ok(r.willLose.some((s) => s.includes('ch(2)')))
  } finally {
    await cleanup()
  }
})

test('回到第N章 confirm=true：reset 到该章 + 备份 ref，后续章消失', async () => {
  const { ctx, root, git, cleanup } = await bookWithChapters()
  try {
    const r = await gotoChapter(ctx, { chapterNum: 1, confirm: true })
    assert.equal(r.ok, true)
    assert.equal(r.reverted, true)
    await assert.rejects(() => fs.access(path.join(root, '定稿/正文/0002-承.md')))
    await fs.access(path.join(root, '定稿/正文/0001-起.md'))
    const { stdout } = await git(['rev-parse', '--verify', r.backupRef])
    assert.ok(stdout.trim().length >= 7)
  } finally {
    await cleanup()
  }
})

test('回到第N章：不存在的章 → ok=false', async () => {
  const { ctx, cleanup } = await bookWithChapters()
  try {
    const r = await gotoChapter(ctx, { chapterNum: 99, confirm: true })
    assert.equal(r.ok, false)
  } finally {
    await cleanup()
  }
})

test('P1-6：定稿有未登记手改 + confirm → 拒绝 reset（不丢手改）', async () => {
  const { ctx, root, git, cleanup } = await bookWithChapters()
  try {
    // 在已跟踪的第1章上手改（不提交）
    const path1 = path.join(root, '定稿/正文/0001-起.md')
    await fs.writeFile(path1, (await fs.readFile(path1, 'utf8')) + '\n手改了一句。', 'utf8')
    const r = await gotoChapter(ctx, { chapterNum: 1, confirm: true })
    assert.equal(r.ok, false, '脏树应拒绝 reset')
    assert.match(r.error, /手改/)
    // 手改仍在,未被抹掉（rescue ref 不含工作树,拒绝才安全）
    assert.ok((await fs.readFile(path1, 'utf8')).includes('手改了一句'), '手改应保留')
    // 第2章也仍在（未 reset）
    await fs.stat(path.join(root, '定稿/正文/0002-承.md'))
    void git
  } finally {
    await cleanup()
  }
})
