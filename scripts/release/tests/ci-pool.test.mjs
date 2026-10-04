import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { root } from '../version.mjs'

test('an unexpected worker exit records the real code and remains a failed run', () => {
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
  const fixture = fs.mkdtempSync(path.join(root, '.tmp/ci-worker-'))
  try {
    const helper = pathToFileURL(path.join(root, 'scripts/release/ci-pool.mjs')).href
    fs.writeFileSync(path.join(fixture, 'vitest.config.mjs'), `import { diagnosticForks } from ${JSON.stringify(helper)};
export default { test: { root: ${JSON.stringify(fixture)}, include: ['crash.test.js'], maxWorkers: 1, pool: diagnosticForks(${JSON.stringify(fixture)}) } };`)
    fs.writeFileSync(path.join(fixture, 'crash.test.js'), 'import { it } from "vitest"; it("fixture exits", () => process.kill(process.pid, "SIGKILL"));')
    const result = spawnSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', path.join(fixture, 'vitest.config.mjs')], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000,
    })
    assert.equal(result.error, undefined)
    assert.notEqual(result.status, 0, 'worker death must not be accepted as success')
    assert.ok(fs.existsSync(path.join(fixture, 'workers.jsonl')), result.stdout + result.stderr)
    const exits = fs.readFileSync(path.join(fixture, 'workers.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    assert.ok(exits.some(exit => !exit.planned && (exit.signal === 'SIGKILL' || (Number.isInteger(exit.code) && exit.code !== 0))), JSON.stringify(exits))
  } finally { fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 5 }) }
})
