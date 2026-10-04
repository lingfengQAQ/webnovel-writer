import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import CiReporter from '../ci-reporter.mjs'

test('worker failure retains active and not-yet-started files without serializing environment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptor-ci-report-'))
  try {
    const reporter = new CiReporter()
    reporter.onInit({ config: { root } })
    const modules = ['finished', 'crashed', 'pending'].map(name => ({ moduleId: path.join(root, `packages/example/${name}.spec.ts`) }))
    reporter.onTestRunStart(modules)
    reporter.onTestModuleStart(modules[0]); reporter.onTestModuleEnd(modules[0])
    reporter.onTestModuleStart(modules[1])
    reporter.onTestRunEnd([], [new Error('Worker exited unexpectedly')], 'failed')
    const report = JSON.parse(fs.readFileSync(path.join(root, '.tmp/ci/progress.json'), 'utf8'))
    assert.deepEqual(Object.keys(report.active), ['packages/example/crashed.spec.ts'])
    assert.deepEqual(report.pending, ['packages/example/pending.spec.ts'])
    assert.equal(report.completed[0].file, 'packages/example/finished.spec.ts')
    assert.equal(report.errors[0].message, 'Worker exited unexpectedly')
    assert.equal(report.reason, 'failed')
    assert.equal(Object.hasOwn(report, 'env'), false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
