import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { packageFiles } from './tar.mjs'

export function verifyRegistrySources(filename, pin) {
  const bytes = fs.readFileSync(filename)
  assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, pin.integrity, 'Pinned registry source integrity mismatch')
  const sources = [...packageFiles(filename)].filter(([name]) => name.startsWith('src/') && name.endsWith('.ts')).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  assert.ok(sources.length > 0 && sources.length === pin.sourceFiles, 'Registry source file count mismatch')
  const proof = sources.map(([name, bytes]) => `${name}\0${createHash('sha256').update(bytes).digest('hex')}\n`).join('')
  assert.equal(createHash('sha256').update(proof).digest('hex'), pin.sourceSha256, 'Registry source content mismatch')
  return { sourceKind: 'registry-typescript', sourceFiles: sources.length, sourceSha256: pin.sourceSha256 }
}

async function download(url) {
  assert.ok(url.startsWith('https://registry.npmjs.org/') || url.startsWith('https://codeload.github.com/') || url.startsWith('https://code.haverbeke.berlin/'), 'Unexpected source host')
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`Source download failed (${response.status}): ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

/** Publish package distributions and pinned upstream sources, never local paths. */
export async function collectDependencySources(root, output) {
  const components = new Map()
  for (const pkg of ['bundle', 'embedding-provider']) {
    const entries = JSON.parse(fs.readFileSync(path.join(root, 'packages', pkg, 'lib/third-party-inputs.json'), 'utf8'))
    for (const entry of entries) components.set(`${entry.name}@${entry.version}`, entry)
  }
  const directory = path.join(output, 'third-party-sources')
  fs.mkdirSync(directory)
  const upstream = new Map()
  const report = []
  // Release tooling may be newer than the immutable source tag.
  const pinned = JSON.parse(fs.readFileSync(new URL('./upstream-sources.json', import.meta.url), 'utf8'))
  for (const entry of components.values()) {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(entry.name)}/${encodeURIComponent(entry.version)}`, { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`Package source metadata unavailable: ${entry.name}@${entry.version}`)
    const metadata = await response.json()
    const tarball = await download(metadata.dist.tarball)
    const integrity = metadata.dist.integrity
    if (integrity) {
      const [algorithm, value] = integrity.split(' ')[0].split('-')
      assert.ok(['sha512', 'sha256', 'sha1'].includes(algorithm))
      assert.equal(createHash(algorithm).update(tarball).digest('base64'), value, 'Registry source integrity mismatch')
    } else assert.equal(createHash('sha1').update(tarball).digest('hex'), metadata.dist.shasum)
    const filename = `${entry.name.replaceAll('@', '').replaceAll('/', '__')}--${entry.version}.tgz`
    fs.writeFileSync(path.join(directory, filename), tarball)
    const repository = typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url
    const github = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:#.*)?$/.exec(repository ?? '')
    const haverbeke = /code\.haverbeke\.berlin\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(repository ?? '')
    const override = pinned[`${entry.name}@${entry.version}`]
    if (override?.source === 'registry-typescript') {
      const proof = verifyRegistrySources(path.join(directory, filename), override)
      report.push({ name: entry.name, version: entry.version, license: entry.license, repository,
        packageArchive: filename, packageIntegrity: integrity, ...proof, upstreamCommit: null, note: override.reason })
      console.log(`[source] ${entry.name}@${entry.version}: pinned registry TypeScript source`)
      continue
    }
    const commit = override?.commit ?? metadata.gitHead
    assert.match(commit ?? '', /^[a-f0-9]{40}$/, `Pin upstream source for ${entry.name}@${entry.version}`)
    let upstreamFile = null, sourceUrl = null
    const upstreamRepo = override?.repository ?? (github ? `${github[1]}/${github[2]}` : null)
    if (upstreamRepo || haverbeke) {
      const key = `${upstreamRepo ?? `${haverbeke[1]}/${haverbeke[2]}`}-${commit}`.replaceAll('/', '-')
      sourceUrl = upstreamRepo ? `https://codeload.github.com/${upstreamRepo}/tar.gz/${commit}`
        : `https://code.haverbeke.berlin/${haverbeke[1]}/${haverbeke[2]}/archive/${commit}.tar.gz`
      if (!upstream.has(key)) {
        upstreamFile = `${key}.tar.gz`
        fs.writeFileSync(path.join(directory, upstreamFile), await download(sourceUrl))
        upstream.set(key, upstreamFile)
      } else upstreamFile = upstream.get(key)
    }
    assert.ok(upstreamFile, `No corresponding upstream source for ${entry.name}@${entry.version}`)
    report.push({ name: entry.name, version: entry.version, license: entry.license, repository,
      packageArchive: filename, packageIntegrity: integrity ?? `sha1:${metadata.dist.shasum}`,
      upstreamArchive: upstreamFile, upstreamUrl: sourceUrl, upstreamCommit: commit,
      upstreamSha256: createHash('sha256').update(fs.readFileSync(path.join(directory, upstreamFile))).digest('hex'),
      note: 'Pinned upstream source and registry distribution included.' })
    console.log(`[source] ${entry.name}@${entry.version}: package${upstreamFile ? ' + upstream' : ''}`)
  }
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(report, null, 2) + '\n')
  fs.writeFileSync(path.join(directory, 'README.txt'), 'Corresponding third-party source materials for this release. See manifest.json for exact versions, original integrity and pinned upstream archives. Original licenses are also shipped with the application.\n')
  execFileSync('tar', ['-czf', 'third-party-sources.tar.gz', 'third-party-sources'], { cwd: output, windowsHide: true })
  return report
}
