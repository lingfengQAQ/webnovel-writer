import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { BookConfigReader } from '../../../src/storage/adapters/BookConfigReader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.join(__dirname, '../../fixtures/sample-book')

test('BookConfigReader 读 book.yaml 平铺字段', async () => {
  const r = await new BookConfigReader(fixtureRoot).read()
  assert.equal(r.ok, true)
  assert.equal(r.data.书名, '测试书')
  assert.equal(r.data.每章目标字数, 3000)
  assert.equal(r.data.伏笔悬了太久章数, 10)
})

test('BookConfigReader 缺 book.yaml → ok=false（不崩）', async () => {
  const r = await new BookConfigReader(path.join(os.tmpdir(), 'wnw-nonexistent-xyz')).read()
  assert.equal(r.ok, false)
})
