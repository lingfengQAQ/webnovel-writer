import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ThreadLedgerReader } from '../../../src/storage/adapters/ThreadLedgerReader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.join(__dirname, '../../fixtures/sample-book')

test('readBasicInfo：读取伏笔基本信息', async () => {
  const reader = new ThreadLedgerReader(fixtureRoot)
  const result = await reader.readBasicInfo('伏笔-001')

  assert.equal(result.ok, true)
  assert.equal(result.data.强度, '高')
  assert.equal(result.data.状态, '进行')
  assert.equal(result.data.开启章, 1)
  assert.equal(result.data.预计收尾, '第3卷')
})

test('readBasicInfo：不存在的条目', async () => {
  const reader = new ThreadLedgerReader(fixtureRoot)
  const result = await reader.readBasicInfo('伏笔-999')

  assert.equal(result.ok, false)
  assert.ok(result.error.includes('不存在'))
})

test('readHistory：读取履历', async () => {
  const reader = new ThreadLedgerReader(fixtureRoot)
  const result = await reader.readHistory('伏笔-001')

  assert.equal(result.ok, true)
  assert.equal(result.history.length, 1)
  assert.equal(result.history[0].章号, 1)
  assert.ok(result.history[0].原文.includes('埋下'))
})

test('readClosurePlan：读取收尾计划', async () => {
  const reader = new ThreadLedgerReader(fixtureRoot)
  const result = await reader.readClosurePlan('伏笔-001')

  assert.equal(result.ok, true)
  assert.ok(result.plan.includes('第三卷揭晓'))
})

test('readDescription：读取描述', async () => {
  const reader = new ThreadLedgerReader(fixtureRoot)
  const result = await reader.readDescription('伏笔-001')

  assert.equal(result.ok, true)
  assert.ok(result.description.includes('神秘老者的真实身份'))
})
