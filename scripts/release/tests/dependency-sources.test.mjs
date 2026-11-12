import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import { collectDependencySources, verifyRegistrySources } from '../dependency-sources.mjs'

test('registry source exception requires exact archive bytes and complete pinned TypeScript source', () => {
  const body = Buffer.from('export const original = true\n')
  const header = Buffer.alloc(512)
  header.write('package/src/index.ts')
  header.write(body.length.toString(8).padStart(11, '0'), 124)
  header.write('0', 156)
  const bytes = zlib.gzipSync(Buffer.concat([header, body, Buffer.alloc(512 - body.length), Buffer.alloc(1024)]))
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptor-source-proof-'))
  const file = path.join(directory, 'source.tgz')
  fs.writeFileSync(file, bytes)
  const sha = value => createHash('sha256').update(value).digest('hex')
  const pin = { integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`, sourceFiles: 1,
    sourceSha256: sha(`src/index.ts\0${sha(body)}\n`) }
  try {
    assert.equal(verifyRegistrySources(file, pin).sourceFiles, 1)
    assert.throws(() => verifyRegistrySources(file, { ...pin, integrity: 'sha512-invalid' }), /integrity mismatch/)
    assert.throws(() => verifyRegistrySources(file, { ...pin, sourceFiles: 2 }), /file count mismatch/)
    assert.throws(() => verifyRegistrySources(file, { ...pin, sourceSha256: '0'.repeat(64) }), /content mismatch/)
  } finally { fs.unlinkSync(file); fs.rmdirSync(directory) }
})

test('dependency sources can select only the main bundle while the default retains both components', async t => {
  const temporary = fs.realpathSync.native(os.tmpdir())
  const root = fs.mkdtempSync(path.join(temporary, 'scriptor-selected-sources-'))
  t.after(() => {
    assert.ok(root.startsWith(path.join(temporary, 'scriptor-selected-sources-')))
    const remove = directory => { for (const name of fs.readdirSync(directory)) { const file = path.join(directory, name); if (fs.lstatSync(file).isDirectory()) remove(file); else fs.unlinkSync(file) } fs.rmdirSync(directory) }
    remove(root)
  })
  const bundle = path.join(root, 'packages/bundle/lib'), embedding = path.join(root, 'packages/embedding-provider/lib')
  fs.mkdirSync(bundle, { recursive: true })
  fs.writeFileSync(path.join(bundle, 'third-party-inputs.json'), JSON.stringify([{ name: 'bundle-fixture', version: '1.0.0', license: 'MIT' }]))
  const archive = Buffer.from('fixture registry distribution'), upstream = Buffer.from('fixture upstream source')
  const requested = []
  t.mock.method(globalThis, 'fetch', async input => {
    const url = String(input); requested.push(url)
    if (url.endsWith('.tgz')) return new Response(archive)
    if (url.startsWith('https://codeload.github.com/')) return new Response(upstream)
    const name = decodeURIComponent(url.split('/').at(-2))
    return Response.json({ repository: `https://github.com/fixture/${name}`, gitHead: 'a'.repeat(40),
      dist: { tarball: `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`, integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}` } })
  })
  const mainOutput = path.join(root, 'main-output'); fs.mkdirSync(mainOutput)
  assert.deepEqual((await collectDependencySources(root, mainOutput, { components: ['bundle'] })).map(item => item.name), ['bundle-fixture'])
  assert.equal(fs.existsSync(embedding), false)
  assert.equal(requested.some(url => url.includes('embedding-fixture')), false)
  assert.ok(fs.statSync(path.join(mainOutput, 'third-party-sources.tar.gz')).size > 0)
  fs.mkdirSync(embedding, { recursive: true })
  fs.writeFileSync(path.join(embedding, 'third-party-inputs.json'), JSON.stringify([{ name: 'embedding-fixture', version: '1.0.0', license: 'MIT' }]))
  const defaultOutput = path.join(root, 'default-output'); fs.mkdirSync(defaultOutput)
  assert.deepEqual((await collectDependencySources(root, defaultOutput)).map(item => item.name), ['bundle-fixture', 'embedding-fixture'])
  await assert.rejects(collectDependencySources(root, path.join(root, 'invalid-output'), { components: ['../outside'] }), /known, distinct release components/)
  assert.equal(fs.existsSync(path.join(root, 'invalid-output')), false)
})
