import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { packageFiles, checkPublishableManifest, checkEmbeddingPackage, checkMetaPackage } from './tar.mjs'

// The official registry is the only release target. The environment override exists so
// the publish path itself can be exercised against a first-publication fixture.
const registry = process.env.SCRIPTOR_NPM_REGISTRY ?? 'https://registry.npmjs.org/'
const mainName = '@linfengqaqtat/dsh-scriptor'
const embeddingName = 'webnovel-embedding-provider'
const metaName = '@linfengqaqtat/dsh-scriptor-full'
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding)

export function validateReleaseAssets(directory, expectedTag, expectedCommit) {
  assert.match(expectedTag ?? '', /^scriptor-v\d+\.\d+\.\d+-preview\.[1-9]\d*$/)
  assert.match(expectedCommit ?? '', /^[a-f0-9]{40}$/)
  const read = filename => {
    assert.match(filename, /^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Release assets must be flat filenames')
    const file = path.join(directory, filename)
    assert.ok(fs.lstatSync(file).isFile(), 'Release assets must be regular files')
    return fs.readFileSync(file)
  }
  const checksums = new Map()
  for (const line of read('SHA256SUMS').toString('utf8').trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(line)
    assert.ok(match, 'Malformed release checksum')
    assert.ok(!checksums.has(match[2]), 'Duplicate release checksum')
    checksums.set(match[2], match[1])
  }
  const checkedRead = filename => {
    const bytes = read(filename)
    assert.equal(digest(bytes), checksums.get(filename), `Release checksum mismatch: ${filename}`)
    return bytes
  }
  const manifest = JSON.parse(checkedRead('release-manifest.json'))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.tag, expectedTag)
  assert.equal(`scriptor-v${manifest.version}`, expectedTag)
  assert.equal(manifest.publicCommit, expectedCommit)
  assert.equal(manifest.prerelease, true)
  assert.equal(manifest.packageName, mainName)
  assert.equal(manifest.filename, `linfengqaqtat-dsh-scriptor-${manifest.version}.tgz`)
  assert.equal(manifest.optionalPackages?.length, 2)
  const optional = new Map(manifest.optionalPackages.map(item => [item.name, item]))
  assert.deepEqual([...optional.keys()].sort(), [embeddingName, metaName].sort())
  const embedding = optional.get(embeddingName)
  const meta = optional.get(metaName)
  assert.match(embedding.version, /^\d+\.\d+\.\d+$/)
  assert.equal(embedding.tarball, `webnovel-embedding-provider-${embedding.version}.tgz`)
  assert.equal(meta.version, manifest.version)
  assert.equal(meta.tarball, `linfengqaqtat-dsh-scriptor-full-${meta.version}.tgz`)
  const assets = new Map()
  for (const item of manifest.assets) {
    assert.ok(!assets.has(item.file), 'Duplicate manifest asset')
    assert.equal(item.sha256, checksums.get(item.file), 'Manifest/checksum disagreement')
    assets.set(item.file, item.sha256)
  }
  const packages = [
    { name: mainName, version: manifest.version, tarball: manifest.filename },
    embedding, meta,
  ].map(item => {
    const bytes = checkedRead(item.tarball)
    assert.equal(digest(bytes), assets.get(item.tarball), 'Package absent from release manifest')
    const filename = path.join(directory, item.tarball)
    const files = packageFiles(filename)
    const pkg = JSON.parse(files.get('package.json'))
    assert.equal(pkg.name, item.name)
    assert.equal(pkg.version, item.version)
    assert.equal(pkg.repository?.url, 'https://github.com/lingfengQAQ/webnovel-writer.git')
    checkPublishableManifest(pkg)
    return { ...item, filename, integrity: `sha512-${digest(bytes, 'sha512', 'base64')}` }
  })
  checkEmbeddingPackage(packages[1].filename, embedding.version)
  checkMetaPackage(packages[2].filename, manifest.version, embedding.version)
  return packages
}

// A retry must never overwrite an existing name/version or move latest.
export function registryStatus(pkg, metadata) {
  assert.notEqual(metadata?.['dist-tags']?.latest, pkg.version, 'Preview version must not occupy latest')
  const existing = metadata?.versions?.[pkg.version]
  if (!existing) return 'missing'
  assert.equal(existing.dist?.integrity, pkg.integrity, `Registry version has different bytes: ${pkg.name}@${pkg.version}`)
  return 'identical'
}

async function metadataFor(name) {
  const url = new URL(encodeURIComponent(name), registry)
  // npm's CDN can cache a pre-publication 404 for five minutes.
  url.searchParams.set('scriptor-verify', `${Date.now()}-${Math.random()}`)
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { accept: 'application/json', 'cache-control': 'no-cache' } })
  if (response.status === 404) return undefined
  assert.ok(response.ok, `Registry lookup failed (${response.status}): ${name}`)
  return response.json()
}

async function verifyRegistry(packages) {
  for (const pkg of packages) {
    let verified = false
    for (let attempt = 0; attempt < 40; attempt++) {
      const metadata = await metadataFor(pkg.name)
      if (registryStatus(pkg, metadata) === 'identical' && metadata['dist-tags']?.preview === pkg.version) {
        verified = true
        break
      }
      await new Promise(resolve => setTimeout(resolve, 3000))
    }
    assert.ok(verified, `Registry version/preview not visible: ${pkg.name}@${pkg.version}`)
    console.log(`[npm] verified ${pkg.name}@${pkg.version}`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const directoryIndex = args.indexOf('--assets')
  assert.ok(directoryIndex >= 0 && args[directoryIndex + 1], 'Usage: node scripts/release/publish-npm.mjs --assets <directory> [--publish|--verify-only]')
  assert.ok(!(args.includes('--publish') && args.includes('--verify-only')), 'Choose one mode')
  const directory = path.resolve(args[directoryIndex + 1])
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim()
  const packages = validateReleaseAssets(directory, process.env.RELEASE_TAG, commit)
  if (args.includes('--verify-only')) return verifyRegistry(packages)
  const npm = [process.env.NPM_CLI_ENTRY, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean).find(file => fs.existsSync(file))
  assert.ok(npm, 'npm-cli.js was not found; set NPM_CLI_ENTRY')
  const runNpm = rest => execFileSync(process.execPath, [npm, ...rest], { stdio: 'inherit', windowsHide: true })
  const plan = []
  for (const pkg of packages) {
    plan.push({ pkg, state: registryStatus(pkg, await metadataFor(pkg.name)) })
  }
  for (const { pkg, state } of plan) {
    // npm rejects already-published stable versions even in --dry-run mode.
    if (state === 'identical') continue
    runNpm(['publish', pkg.filename, '--dry-run', '--ignore-scripts', '--access', 'public', '--tag', 'preview', `--registry=${registry}`])
  }
  if (!args.includes('--publish')) return console.log('[npm] preflight passed; no packages published')
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Publish with provenance from GitHub Actions')
  assert.ok(process.env.NODE_AUTH_TOKEN, 'Configure repository secret NPM_TOKEN before publishing')
  for (const { pkg, state } of plan) {
    if (state === 'identical') console.log(`[npm] already published with identical bytes: ${pkg.name}@${pkg.version}`)
    else runNpm(['publish', pkg.filename, '--ignore-scripts', '--access', 'public', '--tag', 'preview', '--provenance', `--registry=${registry}`])
  }
  await verifyRegistry(packages)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
