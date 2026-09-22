import { test } from 'node:test'
import assert from 'node:assert/strict'
import { needsFirstPublishTagRepair } from '../repair-first-publish.mjs'

const pkg = { name: 'example', version: '0.1.0-preview.5', integrity: 'sha512-original' }
const metadata = () => ({
  versions: { [pkg.version]: { dist: { integrity: pkg.integrity } } },
  'dist-tags': { preview: pkg.version, latest: pkg.version },
})

test('first-publish repair only removes latest for the sole identical preview version', () => {
  const value = metadata()
  assert.equal(needsFirstPublishTagRepair(pkg, value), true)
  delete value['dist-tags'].latest
  assert.equal(needsFirstPublishTagRepair(pkg, value), false)
})

test('first-publish repair refuses changed bytes, tags, and noninitial package histories', () => {
  assert.throws(() => needsFirstPublishTagRepair(pkg, undefined), /sole first version/)
  const changedBytes = metadata()
  changedBytes.versions[pkg.version].dist.integrity = 'sha512-other'
  assert.throws(() => needsFirstPublishTagRepair(pkg, changedBytes), /bytes differ/)
  const changedPreview = metadata()
  changedPreview['dist-tags'].preview = '0.1.0-preview.6'
  assert.throws(() => needsFirstPublishTagRepair(pkg, changedPreview), /Unexpected preview/)
  const changedLatest = metadata()
  changedLatest['dist-tags'].latest = '1.0.0'
  assert.throws(() => needsFirstPublishTagRepair(pkg, changedLatest), /another latest/)
  const laterHistory = metadata()
  laterHistory.versions['1.0.0'] = { dist: { integrity: 'sha512-stable' } }
  assert.throws(() => needsFirstPublishTagRepair(pkg, laterHistory), /sole first version/)
})
