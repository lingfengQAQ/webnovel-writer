import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { CacheManager } from '../../src/cache/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.join(__dirname, '../fixtures/sample-book')

test('ensureReady：创建数据库并执行 DDL', async () => {
  const tmpDb = path.join(os.tmpdir(), `test-${Date.now()}.db`)
  const cache = new CacheManager(tmpDb)

  await cache.ensureReady(fixtureRoot)

  // 验证表是否创建
  const tables = await cache.query("SELECT name FROM sqlite_master WHERE type='table'")
  const tableNames = tables.map((t) => t.name)

  assert.ok(tableNames.includes('chapters'))
  assert.ok(tableNames.includes('threads'))
  assert.ok(tableNames.includes('entities'))

  await cache.close()
  await fs.unlink(tmpDb)
})

test('rebuildFromSource：全量重建填充数据', async () => {
  const tmpDb = path.join(os.tmpdir(), `test-rebuild-${Date.now()}.db`)
  const cache = new CacheManager(tmpDb)

  const result = await cache.rebuildFromSource(fixtureRoot)

  assert.equal(result.ok, true)

  // 验证 chapters 表有数据
  const chapters = await cache.query('SELECT * FROM chapters')
  assert.ok(chapters.length > 0)
  assert.equal(chapters[0].title, '开局')

  // 验证 threads 表有数据
  const threads = await cache.query('SELECT * FROM threads')
  assert.ok(threads.length > 0)

  // 验证 entity_aliases 表有数据
  const aliases = await cache.query('SELECT * FROM entity_aliases')
  assert.ok(aliases.length > 0)

  await cache.close()
  await fs.unlink(tmpDb)
})

test('删除缓存后全量重建，查询结果不变（AC1）', async () => {
  const tmpDb = path.join(os.tmpdir(), `test-delete-rebuild-${Date.now()}.db`)
  const cache1 = new CacheManager(tmpDb)

  // 第一次重建
  await cache1.ensureReady(fixtureRoot)
  const count1 = await cache1.query('SELECT COUNT(*) as count FROM chapters')
  await cache1.close()

  // 删除缓存
  await fs.unlink(tmpDb)

  // 第二次重建
  const cache2 = new CacheManager(tmpDb)
  await cache2.ensureReady(fixtureRoot)
  const count2 = await cache2.query('SELECT COUNT(*) as count FROM chapters')
  await cache2.close()

  // 结果应相同
  assert.equal(count1[0].count, count2[0].count)

  await fs.unlink(tmpDb)
})
