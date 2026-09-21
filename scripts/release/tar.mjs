import assert from 'node:assert/strict'
import fs from 'node:fs'
import zlib from 'node:zlib'

/** Read regular package files without extracting an untrusted archive. */
export function packageFiles(filename) {
  const data = zlib.gunzipSync(fs.readFileSync(filename), { maxOutputLength: 64 * 1024 * 1024 })
  const files = new Map()
  const names = new Set()
  let offset = 0, pending
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const field = (start, size) => header.toString('utf8', start, start + size).replace(/\0[\s\S]*$/, '')
    const size = parseInt(field(124, 12), 8) || 0
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= data.length, 'Invalid tar entry size')
    const type = field(156, 1)
    const body = data.subarray(offset + 512, offset + 512 + size)
    if (type === 'x') {
      const pax = body.toString('utf8')
      assert.ok(!/\blinkpath=/.test(pax), 'Package links are forbidden')
      pending = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(pax)?.[1]
    } else if (type === 'L') pending = body.toString('utf8').replace(/\0[\s\S]*$/, '')
    else {
      assert.ok(['', '0', '5'].includes(type), `Package entry type is not permitted: ${type}`)
      const prefix = field(345, 155)
      const name = pending ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100))
      pending = undefined
      assert.ok(name.startsWith('package/') && !name.includes('\\') && !name.includes(':') && !name.split('/').some(part => part === '..' || part === '.'), `Unsafe package entry: ${name}`)
      if (type !== '5') {
        const relative = name.slice(8)
        assert.ok(relative && !names.has(relative.toLowerCase()), `Duplicate package entry: ${name}`)
        names.add(relative.toLowerCase())
        files.set(relative, body)
      }
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  assert.ok(files.size, 'Empty package')
  return files
}

export function checkPublishableManifest(manifest) {
  assert.notEqual(manifest.private, true, 'Release packages must not be private')
  assert.equal(manifest.publishConfig?.access, 'public')
  assert.equal(manifest.publishConfig?.tag, 'preview')
  assert.equal(manifest.publishConfig?.registry, 'https://registry.npmjs.org/')
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublishOnly', 'prepack', 'postpack', 'publish', 'postpublish']) {
    assert.equal(manifest.scripts?.[hook], undefined, `Release packages must not run ${hook}`)
  }
  for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies })) {
    assert.ok(!name.startsWith('@webnovel/') && !/^(workspace:|file:|link:)/.test(version), 'Unpublished runtime dependency')
  }
}

export function checkEmbeddingPackage(filename, expectedVersion) {
  const files = packageFiles(filename)
  const read = file => { assert.ok(files.has(file), `Missing ${file}`); return files.get(file).toString('utf8') }
  const manifest = JSON.parse(read('package.json'))
  assert.equal(manifest.name, 'webnovel-embedding-provider')
  assert.equal(manifest.version, expectedVersion)
  assert.equal(manifest.license, 'GPL-3.0-only')
  checkPublishableManifest(manifest)
  assert.ok(read('LICENSE').includes('GNU GENERAL PUBLIC LICENSE'))
  assert.ok(read('THIRD_PARTY_NOTICES.md').includes('Original notices'))
  for (const name of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'README.md', 'MODEL_DIMENSIONS.md']) read(name)
  assert.ok(read('lib/client.js').startsWith(`window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)},`), 'Embedding client identity must match its installed package name')
  for (const [file, data] of files) {
    assert.match(file, /^(package\.json|LICENSE|THIRD_PARTY_NOTICES\.md|README\.md|MODEL_DIMENSIONS\.md|cordis\.patch\.yml|lib\/(index|client)\.js|licenses\/[^/]+\.txt)$/)
    assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[A-Za-z0-9_-]{30,}/.test(data.toString('utf8')), `Possible credential in ${file}`)
  }
  for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })) {
    assert.ok(!name.startsWith('@webnovel/') && !/^(workspace:|file:|link:)/.test(version), 'Unpublished runtime dependency')
  }
  return { ok: true, files: files.size, version: manifest.version }
}

export function checkMetaPackage(filename, expectedVersion, embeddingVersion) {
  const files = packageFiles(filename)
  const read = name => { assert.ok(files.has(name), `Missing ${name}`); return files.get(name).toString('utf8') }
  const manifest = JSON.parse(read('package.json'))
  assert.equal(manifest.name, '@linfengqaqtat/dsh-scriptor-full')
  assert.equal(manifest.version, expectedVersion)
  assert.equal(manifest.license, 'GPL-3.0-only')
  checkPublishableManifest(manifest)
  assert.deepEqual(manifest.dependencies, {
    '@linfengqaqtat/dsh-scriptor': expectedVersion,
    'webnovel-embedding-provider': embeddingVersion,
  })
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(read('cordis.patch.yml').replaceAll('\r\n', '\n').trim(),
    "- insert:\n    - id: webnovel\n      name: '@linfengqaqtat/dsh-scriptor'\n    - id: webnovel-embeddings\n      name: webnovel-embedding-provider")
  assert.ok(read('LICENSE').includes('GNU GENERAL PUBLIC LICENSE'))
  read('README.md')
  for (const file of files.keys()) assert.match(file, /^(package\.json|LICENSE|README\.md|RELEASE_NOTES\.md|cordis\.patch\.yml)$/)
  return { ok: true, files: files.size, version: manifest.version }
}
