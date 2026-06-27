import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SecretReader } from '../../../src/storage/adapters/SecretReader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.join(__dirname, '../../fixtures/sample-book')

test('SecretReader.readBasicInfo 读信息差 front matter', async () => {
  const r = await new SecretReader(fixtureRoot).readBasicInfo('信息差-001')
  assert.equal(r.ok, true)
  assert.equal(r.data.读者知道, false)
})

test('SecretReader.readContent 读 ## 内容 段', async () => {
  const r = await new SecretReader(fixtureRoot).readContent('信息差-001')
  assert.equal(r.ok, true)
  assert.ok(r.content.includes('封印邪灵'))
})

test('SecretReader 不存在的信息差 → ok=false', async () => {
  const r = await new SecretReader(fixtureRoot).readBasicInfo('信息差-999')
  assert.equal(r.ok, false)
})

test('SecretReader.listUnrevealed 无 cache 时返回空数组（不崩）', async () => {
  const rows = await new SecretReader(fixtureRoot).listUnrevealed()
  assert.deepEqual(rows, [])
})
