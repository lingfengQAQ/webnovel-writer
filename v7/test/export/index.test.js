import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { exportChapters } from '../../src/export/index.js'
import { ChapterReader } from '../../src/storage/adapters/ChapterReader.js'
import { tempBookCtx, repoCtx } from '../commands/_helper.js'

// sample-book：第 1 章「开局」、第 2 章「初遇」，书名「测试书」

async function readExport(ctx, name) {
  return fs.readFile(path.join(ctx.repoPath, '工作区', '导出', name), 'utf8')
}

test('单章导出：去 front matter 纯正文、无标题行、文件名零填充', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    const r = await exportChapters(ctx, { mode: 'single', chapterNum: 1 })
    assert.equal(r.ok, true, r.error)
    assert.deepEqual(r.files, ['第0001章-开局.txt'])
    const body = (await new ChapterReader(ctx.repoPath).readBody(1)).body
    const exported = await readExport(ctx, '第0001章-开局.txt')
    assert.equal(exported, body.trim() + '\n')
    assert.doesNotMatch(exported, /^第1章/) // 正文体不带标题行
    assert.doesNotMatch(exported, /^---/) // 无 front matter
  } finally {
    await cleanup()
  }
})

test('范围导出：合并单文件、每章「第N章 标题」行、章间空两行', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    const r = await exportChapters(ctx, { mode: 'range', start: 1, end: 2 })
    assert.equal(r.ok, true, r.error)
    assert.deepEqual(r.files, ['第0001-0002章.txt'])
    const reader = new ChapterReader(ctx.repoPath)
    const b1 = (await reader.readBody(1)).body.trim()
    const b2 = (await reader.readBody(2)).body.trim()
    const exported = await readExport(ctx, '第0001-0002章.txt')
    assert.equal(exported, `第1章 开局\n\n${b1}\n\n\n第2章 初遇\n\n${b2}\n`)
  } finally {
    await cleanup()
  }
})

test('全书导出：文件名含书名、内容同合并格式；重复导出覆盖', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    const r1 = await exportChapters(ctx, { mode: 'all' })
    assert.equal(r1.ok, true, r1.error)
    assert.deepEqual(r1.files, ['全书-测试书.txt'])
    const first = await readExport(ctx, '全书-测试书.txt')
    assert.match(first, /^第1章 开局\n/)
    assert.match(first, /\n第2章 初遇\n/)

    const r2 = await exportChapters(ctx, { mode: 'all' })
    assert.equal(r2.ok, true, r2.error)
    assert.equal(await readExport(ctx, '全书-测试书.txt'), first) // 覆盖后仍完整
  } finally {
    await cleanup()
  }
})

test('缺章：范围含空洞人话列缺章，零写入', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    const r = await exportChapters(ctx, { mode: 'range', start: 1, end: 4 })
    assert.equal(r.ok, false)
    assert.match(r.error, /第 3、4 章/)
    await assert.rejects(readExport(ctx, '第0001-0004章.txt'))
  } finally {
    await cleanup()
  }
})

test('单章不存在与范围颠倒：人话报错', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    const miss = await exportChapters(ctx, { mode: 'single', chapterNum: 9 })
    assert.equal(miss.ok, false)
    assert.match(miss.error, /第 9 章/)

    const flipped = await exportChapters(ctx, { mode: 'range', start: 2, end: 1 })
    assert.equal(flipped.ok, false)
    assert.match(flipped.error, /起章不能大于止章/)
  } finally {
    await cleanup()
  }
})

test('空定稿区：人话报错', async () => {
  const { ctx, cleanup } = await repoCtx(null, {
    'book.yaml': 'spec_version: "7.0"\n书名: 空书\n类型: 玄幻\n每章目标字数: 3000\n卷规模: 40\n',
  })
  try {
    const r = await exportChapters(ctx, { mode: 'all' })
    assert.equal(r.ok, false)
    assert.match(r.error, /还没有定稿章节/)
  } finally {
    await cleanup()
  }
})
