import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EntityReader } from '../../../src/storage/adapters/EntityReader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.join(__dirname, '../../fixtures/sample-book')

test('readCharacterFrontMatter：读取角色卡 front matter', async () => {
  const reader = new EntityReader(fixtureRoot)
  const result = await reader.readCharacterFrontMatter('林晚')

  assert.equal(result.ok, true)
  assert.equal(result.data.姓名, '林晚')
  assert.equal(result.data.状态, '在世')
  assert.equal(result.data.位置, '青云宗')
  assert.deepEqual(result.data.别名, ['晚晚', '林师妹'])
})

test('readCharacterFull：读取角色卡完整内容', async () => {
  const reader = new EntityReader(fixtureRoot)
  const result = await reader.readCharacterFull('林晚')

  assert.equal(result.ok, true)
  assert.equal(result.frontMatter.姓名, '林晚')
  assert.ok(result.body.includes('外门弟子'))
  assert.ok(result.body.includes('本姑娘才不怕'))
})

test('resolveAlias：解析别名到正名', async () => {
  const reader = new EntityReader(fixtureRoot)
  const result = await reader.resolveAlias('晚晚')

  assert.equal(result.ok, true)
  assert.equal(result.canonicalName, '林晚')
})

test('resolveAlias：未找到别名', async () => {
  const reader = new EntityReader(fixtureRoot)
  const result = await reader.resolveAlias('不存在的别名')

  assert.equal(result.ok, false)
  assert.ok(result.error.includes('未找到'))
})

test('listCharacters：列出所有角色', async () => {
  const reader = new EntityReader(fixtureRoot)
  const characters = await reader.listCharacters()

  assert.ok(characters.length > 0)
  assert.ok(characters.some((c) => c.正名 === '林晚'))
})

test('listCharacters：按状态筛选', async () => {
  const reader = new EntityReader(fixtureRoot)
  const characters = await reader.listCharacters({ status: '在世' })

  assert.ok(characters.length > 0)
  assert.ok(characters.every((c) => c.状态 === '在世'))
})
