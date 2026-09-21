import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { root } from '../version.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const version = '0.1.0-preview.4'
const publishConfig = { access: 'public', tag: 'preview', registry: 'https://registry.npmjs.org/' }
function archive(files) {
  const rows = Object.entries(files).map(([name, text]) => {
    const body = Buffer.from(typeof text === 'object' ? JSON.stringify(text) : text)
    const header = Buffer.alloc(512)
    header.write(`package/${name}`)
    header.write(body.length.toString(8).padStart(11, '0'), 124)
    header.write('0', 156)
    return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)])
  })
  return zlib.gzipSync(Buffer.concat([...rows, Buffer.alloc(1024)]))
}
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()

/** Build release assets whose bytes and manifest match what the publisher validates. */
function writeAssets(directory) {
  const entries = [
    ['@linfengqaqtat/dsh-scriptor', version, `linfengqaqtat-dsh-scriptor-${version}.tgz`],
    ['webnovel-embedding-provider', '0.0.8', 'webnovel-embedding-provider-0.0.8.tgz'],
    ['@linfengqaqtat/dsh-scriptor-full', version, `linfengqaqtat-dsh-scriptor-full-${version}.tgz`],
  ]
  const packages = entries.map(([name, v, tarball]) => ({ name, version: v, tarball }))
  for (const [index, item] of packages.entries()) {
    const manifest = { name: item.name, version: item.version, license: 'GPL-3.0-only', publishConfig,
      repository: { url: 'https://github.com/lingfengQAQ/webnovel-writer.git' } }
    const files = { 'package.json': manifest, LICENSE: 'GNU GENERAL PUBLIC LICENSE', 'README.md': 'Example' }
    if (index === 1) Object.assign(files, { 'lib/index.js': '', 'lib/client.js': `window.__ModuleLoader__.load({ id: ${JSON.stringify(item.name)},`, 'cordis.patch.yml': '', 'MODEL_DIMENSIONS.md': '', 'THIRD_PARTY_NOTICES.md': 'Original notices' })
    if (index === 2) {
      manifest.dependencies = { '@linfengqaqtat/dsh-scriptor': version, 'webnovel-embedding-provider': '0.0.8' }
      manifest.dsh = { bundle: { patch: './cordis.patch.yml' } }
      files['cordis.patch.yml'] = fs.readFileSync(path.join(root, 'packages/meta/cordis.patch.yml'), 'utf8')
    }
    fs.writeFileSync(path.join(directory, item.tarball), archive(files))
  }
  const manifest = { schemaVersion: 1, packageName: packages[0].name, version, tag: `scriptor-v${version}`, publicCommit: commit, prerelease: true,
    filename: packages[0].tarball, optionalPackages: packages.slice(1),
    assets: packages.map(item => ({ file: item.tarball, sha256: hash(fs.readFileSync(path.join(directory, item.tarball))) })) }
  fs.writeFileSync(path.join(directory, 'release-manifest.json'), JSON.stringify(manifest))
  const files = [...manifest.assets, { file: 'release-manifest.json', sha256: hash(fs.readFileSync(path.join(directory, 'release-manifest.json'))) }]
  fs.writeFileSync(path.join(directory, 'SHA256SUMS'), files.map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n')
  return { manifest, packages }
}

const fixturePaths = {
  runner: path.join(root, 'scripts/release/tests/fixtures/publish-path-run.mjs'),
  publisher: path.join(root, 'scripts/release/publish-npm.mjs'),
  stub: path.join(root, 'scripts/release/tests/fixtures/stub-npm.mjs'),
}

/** Run the real publisher against the stub npm CLI and a first-publication registry. */
function runPublisher({ assets, fixture, mode = '--publish', environment = {}, keepState = false }) {
  const result = spawnSync(process.execPath, [fixturePaths.runner, assets, fixture, ...mode.split(' ')], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    env: {
      ...process.env,
      RELEASE_TAG: `scriptor-v${version}`,
      SCRIPTOR_PUBLISHER: fixturePaths.publisher,
      SCRIPTOR_STUB_NPM: fixturePaths.stub,
      ...(keepState ? { SCRIPTOR_KEEP_STATE: '1' } : {}),
      ...environment,
    },
  })
  assert.equal(result.status, 0, `publish-path fixture failed: ${result.stdout}${result.stderr}`)
  const report = JSON.parse(result.stdout.trim().split('\n').pop())
  const invocations = fs.readFileSync(path.join(fixture, 'invocations.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  return { report, invocations }
}

function withFixture(callback) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptor-publish-path-'))
  const assets = path.join(base, 'assets')
  const fixture = path.join(base, 'fixture')
  fs.mkdirSync(assets)
  const { manifest, packages } = writeAssets(assets)
  try {
    return callback({ base, assets, fixture, manifest, packages })
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
}

test('publish path preflights every package, then uploads the same tarballs in dependency order with provenance', () => withFixture(({ assets, fixture, packages }) => {
  const { invocations } = runPublisher({ assets, fixture })
  const dryRuns = invocations.filter(item => item.dryRun)
  const uploads = invocations.filter(item => !item.dryRun)
  assert.equal(dryRuns.length, 3, 'every package must be preflighted before any upload')
  assert.deepEqual(uploads.map(item => item.name), packages.map(item => item.name))
  for (const item of invocations) {
    assert.equal(item.command, 'publish')
    assert.ok(item.rest.includes('--access'), 'public access flag is required')
    assert.equal(item.rest[item.rest.indexOf('--access') + 1], 'public')
    assert.ok(item.rest.includes('--ignore-scripts'), 'lifecycle scripts must stay disabled')
    assert.equal(item.rest[item.rest.indexOf('--tag') + 1], 'preview', 'preview releases must not take latest')
    const target = item.rest.find(value => value.startsWith('--registry='))
    assert.ok(target, 'every npm invocation must name its registry explicitly')
    assert.ok(target === '--registry=https://registry.npmjs.org/' || /^--registry=http:\/\/127\.0\.0\.1:\d+\/$/.test(target), `unexpected registry target: ${target}`)
    assert.equal(item.registryConfigured, target.slice('--registry='.length), 'the stub must receive the same registry the publisher targets')
  }
  for (const item of uploads) assert.ok(item.provenance, `provenance is required for ${item.name}`)
  for (const item of dryRuns) assert.ok(!item.provenance, 'dry runs must not request provenance')
  for (const item of uploads) assert.equal(path.basename(item.rest[0]), item.tarball, 'uploads must name the release tarball')
  assert.deepEqual(uploads.map(item => path.basename(item.rest[0])), packages.map(item => item.tarball))
  const published = JSON.parse(fs.readFileSync(path.join(fixture, 'published.json'), 'utf8'))
  assert.deepEqual(Object.keys(published).sort(), packages.map(item => item.name).sort())
  for (const item of packages) assert.equal(published[item.name].tarball, item.tarball)
  for (const item of packages) assert.equal(published[item.name].distTag, 'preview')
  assert.ok(!Object.values(published).some(item => item.distTag === 'latest'), 'no preview upload may move latest')
  assert.deepEqual(uploads.slice(-1).map(item => item.integrity), [published[packages[2].name].integrity])
}))

test('publish retry skips a byte-identical version and never re-uploads it', () => withFixture(({ assets, fixture, packages }) => {
  runPublisher({ assets, fixture })
  const firstUploads = JSON.parse(fs.readFileSync(path.join(fixture, 'published.json'), 'utf8'))
  const { invocations } = runPublisher({ assets, fixture, keepState: true })
  const uploads = invocations.filter(item => !item.dryRun)
  assert.deepEqual(uploads, [], 'a re-run must not publish an existing name/version again')
  assert.equal(invocations.filter(item => item.dryRun).length, 3, 'the preflight still runs on a retry')
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixture, 'published.json'), 'utf8')), firstUploads)
  for (const item of packages) assert.equal(firstUploads[item.name].distTag, 'preview')
}))

test('publish requires the GitHub Actions environment before any upload', () => withFixture(({ assets, fixture }) => {
  const runner = spawnSync(process.execPath, [fixturePaths.runner, assets, fixture, '--publish'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    env: { ...process.env, RELEASE_TAG: `scriptor-v${version}`, SCRIPTOR_PUBLISHER: fixturePaths.publisher, SCRIPTOR_STUB_NPM: fixturePaths.stub, SCRIPTOR_STRIP_GITHUB: '1' },
  })
  const report = JSON.parse(runner.stdout.trim().split('\n').pop())
  assert.equal(runner.status, 0, 'the fixture itself must report its result')
  assert.notEqual(report.code, 0, 'publishing outside Actions must fail')
  const invocations = fs.readFileSync(path.join(fixture, 'invocations.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  assert.deepEqual(invocations.filter(item => !item.dryRun), [], 'nothing may be uploaded without provenance authority')
}))