import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { checkedPnpmVersion, checkTestSource, stageTestPackage, testReleaseIdentity } from '../build-test.mjs'

const temporary = fs.realpathSync.native(os.tmpdir())
function fixture(t) {
  const root = fs.mkdtempSync(path.join(temporary, 'scriptor-test-build-fixture-'))
  t.after(() => {
    assert.ok(root.startsWith(path.join(temporary, 'scriptor-test-build-fixture-')))
    const remove = directory => {
      for (const name of fs.readdirSync(directory)) {
        const file = path.join(directory, name), stat = fs.lstatSync(file)
        if (stat.isDirectory() && !stat.isSymbolicLink()) remove(file)
        else { if (!stat.isSymbolicLink()) fs.chmodSync(file, 0o666); fs.unlinkSync(file) }
      }
      fs.rmdirSync(directory)
    }
    remove(root)
  })
  return root
}

test('test identity requires an explicit next-patch preview and cannot trigger the stable tag workflow', () => {
  const identity = testReleaseIdentity('8.4.0', '8.4.1-preview.1')
  assert.equal(identity.tag, 'scriptor-test-v8.4.1-preview.1')
  assert.equal(identity.tag.startsWith('scriptor-v'), false)
  assert.equal(identity.filename, 'linfengqaqtat-dsh-scriptor-8.4.1-preview.1.tgz')
  for (const version of ['8.4.1', '8.4.1-preview.0', '8.4.1-preview.01', '8.4.2-preview.1', '8.5.0-preview.1', '8.4.1-preview.1+local']) {
    assert.throws(() => testReleaseIdentity('8.4.0', version))
  }
  assert.throws(() => testReleaseIdentity('8.4.0-preview.1', '8.4.1-preview.1'))
})

test('the selected pnpm executable must actually report the pinned version before it can be recorded', t => {
  const root = fixture(t), entry = path.join(root, 'pnpm.cjs')
  const cli = version => `if (process.argv.slice(2).join(' ') !== '--version') throw new Error('Only a version probe is expected'); console.log(${JSON.stringify(version)})\n`
  fs.writeFileSync(entry, cli('11.25.0'))
  assert.throws(() => checkedPnpmVersion(entry, 'pnpm@11.27.1'), /does not match the source packageManager pin/)
  fs.writeFileSync(entry, cli('11.27.1'))
  assert.equal(checkedPnpmVersion(entry, 'pnpm@11.27.1'), '11.27.1')
  assert.throws(() => checkedPnpmVersion(entry, 'pnpm@latest'), /exact pnpm version/)
  fs.writeFileSync(entry, 'process.exit(3)\n')
  assert.throws(() => checkedPnpmVersion(entry, 'pnpm@11.27.1'), error => error.status === 3)
})

test('staging copies the package allowlist, applies only the test manifest overlay and preserves source bytes', t => {
  const root = fixture(t), source = path.join(root, 'source'), staging = path.join(root, 'staging')
  fs.mkdirSync(source)
  const manifest = { name: '@linfengqaqtat/dsh-scriptor', version: '8.4.0',
    files: ['lib/index.js', 'skills/**/*', 'licenses/*.txt', 'README.md', 'LICENSE'],
    scripts: { build: 'node build.mjs', prepare: 'must not execute' }, devDependencies: { '@webnovel/core': 'workspace:*' },
    peerDependencies: { react: '18.3.1' }, publishConfig: { access: 'public', tag: 'latest', registry: 'https://registry.npmjs.org/' } }
  const files = { 'lib/index.js': 'export const value = 1\n', 'lib/third-party-inputs.json': '[]', 'skills/example/SKILL.md': '# Example\n',
    'licenses/example.txt': 'Original license\n', 'licenses/internal.json': '{}', 'README.md': '# Package\n', LICENSE: 'License\n',
    'src/private.ts': 'not packaged', 'package.json': JSON.stringify(manifest, null, 2) + '\n' }
  for (const [file, data] of Object.entries(files)) { const destination = path.join(source, file); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, data) }
  const result = stageTestPackage(source, staging, '8.4.1-preview.1')
  assert.deepEqual(result.files, ['LICENSE', 'README.md', 'lib/index.js', 'licenses/example.txt', 'package.json', 'skills/example/SKILL.md'])
  assert.equal(result.manifest.version, '8.4.1-preview.1')
  assert.equal(result.manifest.publishConfig.tag, 'preview')
  assert.deepEqual(result.manifest.peerDependencies, manifest.peerDependencies)
  assert.equal(Object.hasOwn(result.manifest, 'devDependencies'), false)
  assert.equal(Object.hasOwn(result.manifest, 'scripts'), false)
  assert.equal(fs.existsSync(path.join(staging, 'src')), false)
  assert.equal(fs.existsSync(path.join(staging, 'lib/third-party-inputs.json')), false)
  for (const [file, data] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(source, file), 'utf8'), data)
  assert.throws(() => stageTestPackage(source, staging, '8.4.1-preview.1'), /new staging directory/)
  assert.throws(() => stageTestPackage(source, path.join(source, 'stage'), '8.4.1-preview.1'), /outside the source/)
  fs.mkdirSync(path.join(root, 'external'))
  fs.symlinkSync(path.join(root, 'external'), path.join(source, 'skills/link'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => stageTestPackage(source, path.join(root, 'linked-stage'), '8.4.1-preview.1'), /Package links/)
  assert.equal(fs.existsSync(path.join(root, 'linked-stage')), false)
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ ...manifest, files: ['../external'] }))
  assert.throws(() => stageTestPackage(source, path.join(root, 'escaped-stage'), '8.4.1-preview.1'), /unsafe package file pattern/)
})

test('staging rejects a linked parent of a fixed allowlist file before copying outside bytes', t => {
  const root = fixture(t), source = path.join(root, 'source'), outside = path.join(root, 'outside'), staging = path.join(root, 'staging')
  fs.mkdirSync(source); fs.mkdirSync(outside)
  const outsideFile = path.join(outside, 'index.js'), content = 'export const outsideSource = true\n'
  fs.writeFileSync(outsideFile, content)
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: '@linfengqaqtat/dsh-scriptor', version: '8.4.0', files: ['lib/index.js'] }))
  fs.symlinkSync(outside, path.join(source, 'lib'), process.platform === 'win32' ? 'junction' : 'dir')
  // lstat on the final file follows its parent; checking that file alone cannot enforce the boundary.
  assert.equal(fs.lstatSync(path.join(source, 'lib/index.js')).isFile(), true)
  assert.throws(() => stageTestPackage(source, staging, '8.4.1-preview.1'), /Package links are not permitted: lib/)
  assert.equal(fs.existsSync(staging), false)
  assert.equal(fs.readFileSync(outsideFile, 'utf8'), content)
})

test('test source rejects dirty checkouts, shared Git objects and private reachable history', t => {
  const root = fixture(t)
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim()
  git(['init']); git(['config', 'core.autocrlf', 'false']); git(['config', 'commit.gpgsign', 'false'])
  git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.com'])
  fs.writeFileSync(path.join(root, 'README.md'), '# Public\n')
  git(['add', '.']); git(['commit', '-m', 'public fixture'])
  assert.equal(checkTestSource(root), git(['rev-parse', 'HEAD']))
  fs.writeFileSync(path.join(root, 'README.md'), '# Dirty\n')
  assert.throws(() => checkTestSource(root), /checkout must be clean/)
  fs.writeFileSync(path.join(root, 'README.md'), '# Public\n')
  const alternates = path.join(root, '.git/objects/info/alternates')
  fs.writeFileSync(alternates, 'unrelated-object-store\n')
  assert.throws(() => checkTestSource(root), /Shared Git object stores/)
  fs.unlinkSync(alternates)
  const privateDirectory = path.join(root, '.trellis')
  fs.mkdirSync(privateDirectory); fs.writeFileSync(path.join(privateDirectory, 'private.md'), 'private history\n')
  git(['add', '.']); git(['commit', '-m', 'private fixture'])
  fs.unlinkSync(path.join(privateDirectory, 'private.md')); fs.rmdirSync(privateDirectory)
  git(['add', '-u']); git(['commit', '-m', 'remove private current file'])
  assert.throws(() => checkTestSource(root), /outside public allowlist|Private content path/)
})
