import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TimelineReader } from '../../../src/storage/adapters/TimelineReader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.join(__dirname, '../../fixtures/sample-book')

test('TimelineReader.readVolumeRange 读卷时间线（Markdown 表格行）', async () => {
  const r = await new TimelineReader(fixtureRoot).readVolumeRange(1, 1)
  assert.equal(r.ok, true)
  assert.ok(r.timeline.length >= 1)
  assert.ok(r.timeline[0].在场.includes('林晚'))
})

test('TimelineReader.readByParticipant 按在场角色过滤', async () => {
  const rows = await new TimelineReader(fixtureRoot).readByParticipant(1, '林晚')
  assert.ok(rows.length >= 1)
  assert.ok(rows.every((e) => e.在场.includes('林晚')))
})

test('TimelineReader 不存在的卷 → 空时间线（不崩）', async () => {
  const r = await new TimelineReader(fixtureRoot).readVolumeRange(99, 99)
  assert.equal(r.ok, true)
  assert.deepEqual(r.timeline, [])
})
