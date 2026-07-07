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

// A6：接口形状不随缓存冷热漂移——缓存命中与文件降级都输出中文键
test('readFrontMatter：缓存命中与文件降级输出同一形状（中文键）', async () => {
  const fakeCache = {
    query: async () => [
      {
        chapter_num: 1, title: '开局', volume_num: 1, perspective: '林晚',
        story_time: null, word_count: 100, chapter_position: '开篇',
        hook_type: '悬念钩-强', mood_position: null, is_volume_end: 0,
        file_path: '/x/0001.md', is_key_chapter: 0,
      },
    ],
  }
  const warm = await new ChapterReader(fixtureRoot, fakeCache).readFrontMatter(1)
  const cold = await new ChapterReader(fixtureRoot).readFrontMatter(1)
  assert.equal(warm.ok, true)
  assert.equal(cold.ok, true)
  assert.equal(warm.data.章号, 1)
  assert.equal(warm.data.标题, '开局')
  assert.equal(warm.data.chapter_num, undefined, '缓存命中不得泄漏英文列名')
  assert.equal(warm.data.file_path, undefined, '不得泄漏文件路径')
  assert.equal(cold.data.标题, '开局')
})
