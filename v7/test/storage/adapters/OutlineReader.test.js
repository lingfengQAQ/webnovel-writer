import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { OutlineReader } from '../../../src/storage/adapters/OutlineReader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.join(__dirname, '../../fixtures/sample-book')

test('OutlineReader.readOutlineSection 读总纲指定小节', async () => {
  const r = await new OutlineReader(fixtureRoot).readOutlineSection('结局')
  assert.equal(r.ok, true)
  assert.ok(r.content.includes('血仇得报'))
})

test('OutlineReader.readVolumeOutline 读卷纲全文', async () => {
  const r = await new OutlineReader(fixtureRoot).readVolumeOutline(1)
  assert.equal(r.ok, true)
  assert.ok(r.content.includes('卷定位'))
})

test('OutlineReader.readVolumeOutline 不存在的卷 → ok=false', async () => {
  const r = await new OutlineReader(fixtureRoot).readVolumeOutline(99)
  assert.equal(r.ok, false)
})

test('OutlineReader.listVolumes 列出卷号', async () => {
  const vols = await new OutlineReader(fixtureRoot).listVolumes()
  assert.deepEqual(vols, [1])
})
