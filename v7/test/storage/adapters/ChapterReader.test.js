import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ChapterReader } from '../../../src/storage/adapters/ChapterReader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.join(__dirname, '../../fixtures/sample-book')

test('readFrontMatter：读取章节 front matter', async () => {
  const reader = new ChapterReader(fixtureRoot)
  const result = await reader.readFrontMatter(1)

  assert.equal(result.ok, true)
  assert.equal(result.data.章号, 1)
  assert.equal(result.data.标题, '开局')
  assert.equal(result.data.卷, 1)
  assert.equal(result.data.视角, '林晚')
})

test('readFrontMatter：不存在的章号', async () => {
  const reader = new ChapterReader(fixtureRoot)
  const result = await reader.readFrontMatter(999)

  assert.equal(result.ok, false)
  assert.ok(result.error.includes('不存在'))
})

test('readBody：读取章节正文', async () => {
  const reader = new ChapterReader(fixtureRoot)
  const result = await reader.readBody(1)

  assert.equal(result.ok, true)
  assert.ok(result.body.includes('林晚抬头望着宗门大殿'))
  assert.ok(result.body.includes('消失在夜色中'))
  assert.ok(!result.body.includes('---')) // 不含 front matter
})

test('readTail：读取章节末尾 N 字', async () => {
  const reader = new ChapterReader(fixtureRoot)
  const result = await reader.readTail(1, 50)

  assert.equal(result.ok, true)
  assert.ok(result.text.includes('消失在夜色中'))
  assert.ok(result.text.length <= 60) // 允许少量误差（字符 vs 字）
})

test('readHead：读取章节开头 N 字', async () => {
  const reader = new ChapterReader(fixtureRoot)
  const result = await reader.readHead(1, 20)

  assert.equal(result.ok, true)
  assert.ok(result.text.includes('林晚抬头'))
})

test('readRange：批量读取章号范围', async () => {
  const reader = new ChapterReader(fixtureRoot)
  const result = await reader.readRange(1, 2, ['标题', '卷'])

  assert.equal(result.ok, true)
  assert.equal(result.chapters.length, 2)
  assert.equal(result.chapters[0].章号, 1)
  assert.equal(result.chapters[0].标题, '开局')
  assert.equal(result.chapters[1].标题, '初遇')
})
