import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateReleaseAssets, registryStatus } from './publish-npm.mjs'

const registry = 'https://registry.npmjs.org/'

// Only a package's sole, byte-identical first version may lose an implicit latest.
export function needsFirstPublishTagRepair(pkg, metadata) {
  assert.deepEqual(Object.keys(metadata?.versions ?? {}), [pkg.version], `Not a sole first version: ${pkg.name}`)
  assert.equal(metadata.versions[pkg.version].dist?.integrity, pkg.integrity, `Registry bytes differ: ${pkg.name}`)
  assert.equal(metadata['dist-tags']?.preview, pkg.version, `Unexpected preview: ${pkg.name}`)
  const latest = metadata['dist-tags']?.latest
  assert.ok(latest === undefined || latest === pkg.version, `Refuse to remove another latest: ${pkg.name}`)
  return latest === pkg.version
}

async function metadataFor(name) {
  const url = new URL(encodeURIComponent(name), registry)
  // First publication can leave a cached 404 for several minutes.
  url.searchParams.set('scriptor-verify', `${Date.now()}-${Math.random()}`)
  const response = await fetch(url, { headers: { accept: 'application/json', 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(30000) })
  assert.ok(response.ok, `Registry lookup failed (${response.status}): ${name}`)
  return response.json()
}

async function main() {
  const args = process.argv.slice(2)
  const index = args.indexOf('--assets')
  assert.ok(index >= 0 && args[index + 1], 'Usage: node scripts/release/repair-first-publish.mjs --assets <directory> [--apply]')
  const tag = process.env.RELEASE_TAG
  assert.match(tag ?? '', /^scriptor-v\d+\.\d+\.\d+-preview\.[1-9]\d*$/)
  const commit = execFileSync('git', ['rev-parse', `${tag}^{commit}`], { encoding: 'utf8', windowsHide: true }).trim()
  execFileSync('git', ['merge-base', '--is-ancestor', commit, 'origin/v8'], { windowsHide: true })
  const packages = validateReleaseAssets(path.resolve(args[index + 1]), tag, commit)
  const plan = []
  for (const pkg of packages) plan.push({ pkg, removeLatest: needsFirstPublishTagRepair(pkg, await metadataFor(pkg.name)) })
  console.log(JSON.stringify(plan.map(({ pkg, removeLatest }) => ({ name: pkg.name, version: pkg.version, removeLatest })), null, 2))
  if (!args.includes('--apply')) return
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Apply tag repairs from GitHub Actions')
  assert.ok(process.env.NODE_AUTH_TOKEN, 'Configure NPM_TOKEN for dist-tag repair')
  for (const { pkg, removeLatest } of plan) {
    if (!removeLatest) continue
    // Recheck immediately before the mutation; never delete a newer stable tag.
    assert.ok(needsFirstPublishTagRepair(pkg, await metadataFor(pkg.name)))
    execFileSync('npm', ['dist-tag', 'rm', pkg.name, 'latest', `--registry=${registry}`], { stdio: 'inherit', windowsHide: true })
  }
  for (const { pkg } of plan) {
    let verified = false
    for (let attempt = 0; attempt < 12; attempt++) {
      const metadata = await metadataFor(pkg.name)
      if (!needsFirstPublishTagRepair(pkg, metadata)) {
        assert.equal(registryStatus(pkg, metadata), 'identical')
        verified = true
        break
      }
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
    assert.ok(verified, `Tag repair is not visible: ${pkg.name}`)
    console.log(`[npm] verified original bytes and preview without latest: ${pkg.name}@${pkg.version}`)
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
