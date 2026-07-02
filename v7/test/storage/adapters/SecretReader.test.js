import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SecretReader } from '../../../src/storage/adapters/SecretReader.js'
import { fixtureCtx } from '../../commands/_helper.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.join(__dirname, '../../fixtures/sample-book')

test('SecretReader.readBasicInfo 读信息差 front matter', async () => {
  const r = await new SecretReader(fixtureRoot).readBasicInfo('信息差-001')
  assert.equal(r.ok, true)
  assert.equal(r.data.读者已知, false)
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

test('SecretReader.listUnrevealed 缓存直出 短题/知情人/关键词/登记章', async () => {
  const { ctx, cleanup } = await fixtureCtx()
  try {
    const rows = await new SecretReader(ctx.repoPath, ctx.cache).listUnrevealed()
    const one = rows.find((s) => s.id === '信息差-001')
    assert.ok(one, JSON.stringify(rows))
    assert.equal(one.短题, '灭门真凶') // 文件名第三段起
    assert.deepEqual(one.知情人, ['林晚'])
    assert.deepEqual(one.关键词, ['玉佩', '宗门'])
    assert.equal(one.登记章, 1)
  } finally {
    await cleanup()
  }
})

test('SecretReader.readContentFirstLine 取「## 内容」段首行', async () => {
  const r = await new SecretReader(fixtureRoot).readContentFirstLine('信息差-001')
  assert.equal(r.ok, true)
  assert.equal(r.line, '玉佩乃前代掌门封印邪灵之物，外人不可知。')
})

test('SecretReader.readContentFirstLine 不存在 → ok=false', async () => {
  const r = await new SecretReader(fixtureRoot).readContentFirstLine('信息差-999')
  assert.equal(r.ok, false)
})
