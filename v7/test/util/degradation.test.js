import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDegradationCollector } from '../../src/util/degradation.js'

/**
 * P1-F6：降级事件收集器（ctx 随行旁路）。
 * 收集有损降级事件（读失败→空/残缺数据继续组装 DTO）；良性降级（缓存坏→文件读成功）不进此通道。
 */

test('degradation collector：report 收集 site/reason，drain 清空', () => {
  const c = createDegradationCollector()
  assert.equal(c.size, 0)
  assert.deepEqual(c.drain(), [])

  c.report('SecretReader.listUnrevealed', 'SQLITE_CORRUPT: database disk image is malformed')
  c.report('review.roster', Error('boom').message)
  assert.equal(c.size, 2)
  const events = c.drain()
  assert.equal(events.length, 2)
  assert.equal(events[0].site, 'SecretReader.listUnrevealed')
  assert.match(events[0].reason, /SQLITE_CORRUPT/)
  assert.deepEqual(c.drain(), [], 'drain 后清空')
})

test('degradation collector：reason 截断 200 字符（DTO 是材料不是日志）', () => {
  const c = createDegradationCollector()
  c.report('x', 'a'.repeat(500))
  assert.equal(c.drain()[0].reason.length, 200)
})

test('degradation collector：site/reason 归一为字符串', () => {
  const c = createDegradationCollector()
  c.report('x', null)
  c.report('y', undefined)
  const events = c.drain()
  assert.equal(typeof events[0].reason, 'string')
  assert.equal(typeof events[1].reason, 'string')
})
