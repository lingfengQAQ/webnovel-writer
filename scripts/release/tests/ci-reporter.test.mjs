import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import CiReporter from '../ci-reporter.mjs'

test('worker failure retains active and not-yet-started files without serializing environment', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptor-ci-report-'))
  try {
    const reporter = new CiReporter()
    reporter.onInit({ config: { root } })
    const modules = ['finished', 'crashed', 'pending'].map(name => ({ moduleId: path.join(root, `packages/example/${name}.spec.ts`) }))
    await reporter.onTestRunStart(modules)
    reporter.onTestModuleStart(modules[0]); reporter.onTestModuleEnd(modules[0])
    reporter.onTestModuleStart(modules[1])
    reporter.onTestCaseReady({ module: modules[1], fullName: 'last running test' })
    reporter.onTestRunEnd([], [new Error('Worker exited unexpectedly')], 'passed')
    const report = JSON.parse(fs.readFileSync(path.join(root, '.tmp/ci/progress.json'), 'utf8'))
    assert.deepEqual(Object.keys(report.active), ['packages/example/crashed.spec.ts'])
    assert.deepEqual(report.pending, ['packages/example/pending.spec.ts'])
    assert.equal(report.completed[0].file, 'packages/example/finished.spec.ts')
    assert.equal(report.errors[0].message, 'Worker exited unexpectedly')
    assert.equal(report.reason, 'failed')
    assert.equal(report.activeTests['packages/example/crashed.spec.ts'], 'last running test')
    assert.equal(Object.hasOwn(report, 'env'), false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('pending files contain only the current shard', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptor-ci-shard-'))
  try {
    const modules = ['one', 'two', 'three', 'four'].map(name => ({ moduleId: path.join(root, `${name}.spec.ts`) }))
    const seen = []
    for (const index of [1, 2]) {
      const reporter = new CiReporter()
      reporter.onInit({ config: { root, shard: { index, count: 2 } } })
      await reporter.onTestRunStart(modules)
      const report = JSON.parse(fs.readFileSync(path.join(root, '.tmp/ci/progress.json'), 'utf8'))
      assert.equal(report.pending.length, 2)
      seen.push(...report.pending)
    }
    assert.equal(new Set(seen).size, 4)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
