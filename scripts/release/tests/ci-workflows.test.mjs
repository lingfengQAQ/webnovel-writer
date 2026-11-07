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
  assert.deepEqual(ci.jobs.quality.strategy.matrix.node, ['24.9.0', '24.15.0'])
  assert.deepEqual(ci.jobs.quality.strategy.matrix.shard, [1, 2, 3, 4])
  assert.deepEqual(ci.jobs.required.needs, ['policy', 'quality', 'build', 'portability'])
  assert.deepEqual(ci.jobs.build.strategy.matrix.node, ci.jobs.quality.strategy.matrix.node)
  assert.equal(ci.jobs.portability['runs-on'], 'ubuntu-latest')
  assert.equal(ci.jobs.macos['runs-on'], 'macos-latest')
  assert.equal(ci.jobs.macos['continue-on-error'], true)
  for (const job of [ci.jobs.policy, ci.jobs.quality, ci.jobs.build, ci.jobs.portability]) assert.notEqual(job['continue-on-error'], true)
  const testStep = ci.jobs.quality.steps.find(step => step.run?.startsWith('pnpm test '))
  assert.match(testStep.run, /--shard=\$\{\{ matrix.shard \}\}\/4/)
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
        else if (entry.isFile() && /\.(spec|test)\.ts$/.test(entry.name)) expected.push(file)
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
      vitest.config.shard = { index, count: 4 }
      shards.push(await new BaseSequencer(vitest).shard(specifications))
    }
    const combined = shards.flat().map(spec => path.resolve(spec.moduleId))
    assert.equal(new Set(combined).size, combined.length, 'shards must not overlap')
    assert.deepEqual(combined.sort(), actual, 'shards must not omit tests')
  } finally { await vitest.close() }
})

test('release runs one complete test suite and keeps installation before draft creation', () => {
  const jobs = workflow('v8-release').jobs
  const steps = jobs.release.steps
  const commands = steps.map(step => step.run ?? '')
  assert.equal(commands.filter(command => /^pnpm test(?: |$)/.test(command)).length, 0)
  assert.equal(jobs.release.needs, 'tests')
  assert.deepEqual(jobs.tests.strategy.matrix.shard, [1, 2, 3, 4])
  assert.match(jobs.tests.steps.find(step => step.run?.startsWith('pnpm test ')).run, /--shard=\$\{\{ matrix.shard \}\}\/4/)
  assert.notEqual(jobs.tests['continue-on-error'], true)
  assert.ok(!commands.some(command => /pnpm -r.*\btest\b/.test(command)))
  const install = steps.findIndex(step => step.name === 'Install the exact release assets into a clean host')
  const draft = steps.findIndex(step => step.name === 'Create a draft; never replace an existing release')
  assert.ok(install >= 0 && draft > install)
  assert.match(steps[draft].run, /DSH Scriptor v\$\(\$manifest.version\)/)
})

test('only optional diagnostics may fail without hiding validation errors', () => {
  for (const name of ['v8-ci', 'v8-release']) {
    for (const [key, job] of Object.entries(workflow(name).jobs)) {
      for (const step of job.steps ?? []) {
        if (step['continue-on-error'] === true) assert.match(step.uses ?? '', /^actions\/upload-artifact@/, `${name}/${key}`)
      }
    }
  }
  const build = workflow('v8-ci').jobs.build.steps
  assert.ok(build.some(step => step.run === 'pnpm build'))
  assert.ok(build.some(step => step.run?.includes('pack-check')))
  const notices = build.find(step => step.name === 'Generated notices are current')
  assert.match(notices.run, /restoreNoticeLineEndings/)
  assert.match(notices.run, /git diff --exit-code/)
})

test('required registry packages gate finalize, companion stays independent, verify cannot upload', () => {
  const jobs = workflow('v8-npm-publish').jobs
  const upload = jobs.publish.steps.find(step => step.run?.includes('--submit-only'))
  assert.match(upload.if, /inputs.phase != 'verify'/)
  assert.equal(jobs.installation.if, "needs.publish.outputs.ready == 'true'")
  assert.equal(jobs.finalize.needs, 'installation')
  const registry = jobs.publish.steps.find(step => step.id === 'registry')
  assert.match(registry.run, /--check-visibility/)
  assert.match(registry.run, /--exclude-companion/)
  const installation = jobs.installation.steps.find(step => step.name === 'Verify registry bytes and install in clean profiles')
  assert.match(installation.run, /--verify-only --exclude-companion/)
  assert.match(installation.run, /install-smoke\.mjs \$main \$embedding \$meta --registry/)
  assert.doesNotMatch(installation.run, /--companion\s/)
  assert.match(jobs.finalize.steps[0].run, /companion-independent/)
  assert.ok(!registry.env?.NODE_AUTH_TOKEN)
  assert.equal(jobs.publish.outputs.ready, '${{ steps.registry.outputs.ready }}')
})

test('no workflow can move npm dist-tags outside the reviewed release path', () => {
  const directory = path.join(root, '.github/workflows')
  for (const name of fs.readdirSync(directory)) {
    const text = fs.readFileSync(path.join(directory, name), 'utf8')
    assert.doesNotMatch(text, /npm\s+dist-tag\s+add/, `${name} must not move npm dist-tags`)
  }
})
