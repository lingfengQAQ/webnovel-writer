import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DesignReader } from '../../../src/storage/adapters/DesignReader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.join(__dirname, '../../fixtures/sample-book')

test('sample-book 的计划对象可按 ID 和名称精确读取', async () => {
  const reader = new DesignReader(fixtureRoot)
  const listed = await reader.list()
  assert.equal(listed.ok, true, listed.errors.join('；'))
  assert.ok(listed.objects.some((item) => item.ID === 'ITEM-002' && item.名称 === '玄阶令牌'))

  const byId = await reader.read('ITEM-002')
  assert.equal(byId.ok, true, byId.error)
  assert.equal(byId.data.path, '大纲/创作设计/设定/ITEM-002-玄阶令牌.md')
  assert.match(byId.data.sections.get('本书设计'), /权限凭证/)

  const byName = await reader.read('玄阶令牌')
  assert.equal(byName.ok, true, byName.error)
  assert.equal(byName.data.ID, 'ITEM-002')
})
