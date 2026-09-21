import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { validateReleaseAssets, registryStatus } from '../publish-npm.mjs'
import { checkPublishableManifest, checkMetaPackage } from '../tar.mjs'
import { root } from '../version.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const version = '0.1.0-preview.4'
const commit = 'a'.repeat(40)
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
async function fixture(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptor-npm-test-'))
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
  const writeManifest = () => {
    fs.writeFileSync(path.join(directory, 'release-manifest.json'), JSON.stringify(manifest))
    const files = [...manifest.assets, { file: 'release-manifest.json', sha256: hash(fs.readFileSync(path.join(directory, 'release-manifest.json'))) }]
    fs.writeFileSync(path.join(directory, 'SHA256SUMS'), files.map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n')
  }
  writeManifest()
  try { await callback({ directory, manifest, writeManifest, packages }) }
  finally { for (const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, file)); fs.rmdirSync(directory) }
}

test('release assets bind tag, public commit, package identities, bytes and dependency order', () => fixture(({ directory }) => {
  const packages = validateReleaseAssets(directory, `scriptor-v${version}`, commit)
  assert.deepEqual(packages.map(item => item.name), ['@linfengqaqtat/dsh-scriptor', 'webnovel-embedding-provider', '@linfengqaqtat/dsh-scriptor-full'])
  assert.throws(() => validateReleaseAssets(directory, 'scriptor-v0.1.0-preview.9', commit))
  assert.throws(() => validateReleaseAssets(directory, `scriptor-v${version}`, 'b'.repeat(40)))
  fs.appendFileSync(packages[0].filename, 'tampered')
  assert.throws(() => validateReleaseAssets(directory, `scriptor-v${version}`, commit), /checksum mismatch/)
}))
test('release validation rejects unsafe paths and ambiguous optional packages even with consistent checksums', () => fixture(({ directory, manifest, writeManifest }) => {
  manifest.optionalPackages[1].tarball = '../escape.tgz'
  writeManifest()
  assert.throws(() => validateReleaseAssets(directory, `scriptor-v${version}`, commit))
  manifest.optionalPackages[1] = manifest.optionalPackages[0]
  writeManifest()
  assert.throws(() => validateReleaseAssets(directory, `scriptor-v${version}`, commit))
}))
test('npm retry permits identical bytes but rejects replaced versions and latest pollution', () => {
  const pkg = { name: 'example', version, integrity: 'sha512-example' }
  assert.equal(registryStatus(pkg, undefined), 'missing')
  const metadata = { versions: { [version]: { dist: { integrity: pkg.integrity } } }, 'dist-tags': { preview: version } }
  assert.equal(registryStatus(pkg, metadata), 'identical')
  metadata.versions[version].dist.integrity = 'sha512-different'
  assert.throws(() => registryStatus(pkg, metadata), /different bytes/)
  metadata.versions[version].dist.integrity = pkg.integrity
  metadata['dist-tags'].latest = version
  assert.throws(() => registryStatus(pkg, metadata), /latest/)
})
test('publish contract rejects private, lifecycle hooks, local dependencies and unintended tags', () => {
  const base = { publishConfig }
  checkPublishableManifest(base)
  for (const change of [{ private: true }, { scripts: { prepare: 'arbitrary-command' } }, { dependencies: { local: 'workspace:*' } }, { publishConfig: { ...publishConfig, tag: 'latest' } }]) {
    assert.throws(() => checkPublishableManifest({ ...base, ...change }))
  }
})
test('full package requires exact dependencies and a DSH bundle declaration', () => fixture(({ directory, packages }) => {
  const filename = path.join(directory, packages[2].tarball)
  checkMetaPackage(filename, version, '0.0.8')
  assert.throws(() => checkMetaPackage(filename, version, '0.0.9'))
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages/meta/package.json'), 'utf8'))
  manifest.version = version
  manifest.dependencies = { '@linfengqaqtat/dsh-scriptor': version, 'webnovel-embedding-provider': '0.0.8' }
  delete manifest.dsh
  fs.writeFileSync(filename, archive({ 'package.json': manifest }))
  assert.throws(() => checkMetaPackage(filename, version, '0.0.8'))
}))
test('first-publication registry serves unchanged tarballs and redirects only other public packages', () => fixture(async ({ directory, packages }) => {
  const filename = path.join(directory, packages[0].tarball)
  const child = spawn(process.execPath, [path.join(root, 'scripts/release/fixture-registry.mjs'), filename], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const [data] = await once(child.stdout, 'data', { signal: AbortSignal.timeout(10000) })
    const url = data.toString().trim()
    const response = await fetch(`${url}${encodeURIComponent(packages[0].name)}`)
    const metadata = await response.json()
    assert.equal(metadata['dist-tags'].preview, version)
    const tarball = await fetch(metadata.versions[version].dist.tarball)
    assert.deepEqual(Buffer.from(await tarball.arrayBuffer()), fs.readFileSync(filename))
    const fallback = await fetch(`${url}react`, { redirect: 'manual' })
    assert.equal(fallback.status, 307)
    assert.equal(fallback.headers.get('location'), 'https://registry.npmjs.org/react')
  } finally { const exited = once(child, 'exit'); child.kill(); await exited }
}))
