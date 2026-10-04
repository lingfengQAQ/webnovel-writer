import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { BaseSequencer, createVitest } from 'vitest/node'
import { root } from '../version.mjs'

const { parse } = createRequire(path.join(root, 'packages/bundle/package.json'))('yaml')
const workflow = name => parse(fs.readFileSync(path.join(root, `.github/workflows/${name}.yml`), 'utf8'))

test('both Windows runtimes keep complete, disjoint test shards and required policy checks', async () => {
  const ci = workflow('v8-ci')
  assert.deepEqual(ci.jobs.quality.strategy.matrix.node, ['22.19.0', '24.15.0'])
  assert.deepEqual(ci.jobs.quality.strategy.matrix.shard, [1, 2])
  assert.deepEqual(ci.jobs.required.needs, ['policy', 'quality'])
  for (const job of [ci.jobs.policy, ci.jobs.quality]) assert.notEqual(job['continue-on-error'], true)
  const testStep = ci.jobs.quality.steps.find(step => step.run?.startsWith('pnpm test '))
  assert.match(testStep.run, /--shard=\$\{\{ matrix.shard \}\}\/2/)
  assert.equal(testStep.if, undefined)
  assert.notEqual(testStep['continue-on-error'], true)
  assert.ok(ci.jobs.policy.steps.some(step => step.run === 'pnpm check:public'))

  const vitest = await createVitest('test', { root, watch: false })
  try {
    const specifications = await vitest.globTestSpecifications()
    const actual = specifications.map(spec => path.resolve(spec.moduleId)).sort()
    const expected = []
    const walk = directory => {
      if (!fs.existsSync(directory)) return
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name)
        if (entry.isDirectory() && entry.name !== 'node_modules') walk(file)
        else if (entry.isFile() && entry.name.endsWith('.spec.ts')) expected.push(file)
      }
    }
    for (const entry of fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      for (const folder of ['tests', 'src']) walk(path.join(root, 'packages', entry.name, folder))
    }
    assert.ok(expected.length > 0)
    assert.deepEqual(actual, expected.sort(), 'the root run must cover every package test')
    const shards = []
    for (const index of ci.jobs.quality.strategy.matrix.shard) {
      vitest.config.shard = { index, count: 2 }
      shards.push(await new BaseSequencer(vitest).shard(specifications))
    }
    const combined = shards.flat().map(spec => path.resolve(spec.moduleId))
    assert.equal(new Set(combined).size, combined.length, 'shards must not overlap')
    assert.deepEqual(combined.sort(), actual, 'shards must not omit tests')
  } finally { await vitest.close() }
})

test('release runs one complete test suite and keeps installation before draft creation', () => {
  const steps = workflow('v8-release').jobs.release.steps
  const commands = steps.map(step => step.run ?? '')
  assert.equal(commands.filter(command => /^pnpm test(?: |$)/.test(command)).length, 1)
  assert.ok(!commands.some(command => /pnpm -r.*\btest\b/.test(command)))
  const install = steps.findIndex(step => step.name === 'Install the exact release assets into a clean host')
  const draft = steps.findIndex(step => step.name === 'Create a draft; never replace an existing release')
  assert.ok(install >= 0 && draft > install)
  assert.match(steps[draft].run, /DSH Scriptor v\$\(\$manifest.version\)/)
})

test('pending registry versions cannot reach installation or finalize; verify mode cannot upload', () => {
  const jobs = workflow('v8-npm-publish').jobs
  const upload = jobs.publish.steps.find(step => step.run?.includes('--submit-only'))
  assert.match(upload.if, /inputs.phase != 'verify'/)
  assert.equal(jobs.installation.if, "needs.publish.outputs.ready == 'true'")
  assert.equal(jobs.finalize.needs, 'installation')
  const registry = jobs.publish.steps.find(step => step.id === 'registry')
  assert.match(registry.run, /--check-visibility/)
  assert.ok(!registry.env?.NODE_AUTH_TOKEN)
  assert.equal(jobs.publish.outputs.ready, '${{ steps.registry.outputs.ready }}')
})
