/**
 * Stub npm CLI for the publish-path fixture. Records every invocation verbatim,
 * fails loudly on a missing tarball, and registers published names with the
 * fixture registry so the publisher's own verification step is exercised too.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { packageFiles } from '../../tar.mjs'

const [command, ...rest] = process.argv.slice(2)
const log = process.env.SCRIPTOR_STUB_LOG
const registry = process.env.SCRIPTOR_STUB_REGISTRY
const publish = process.env.SCRIPTOR_STUB_PUBLISH
if (!log || !registry || !publish) {
  console.error('stub npm: SCRIPTOR_STUB_LOG, SCRIPTOR_STUB_REGISTRY and SCRIPTOR_STUB_PUBLISH are required')
  process.exit(2)
}
const record = value => fs.appendFileSync(log, `${JSON.stringify(value)}\n`)

if (command !== 'publish') {
  record({ command, rest })
  console.error(`stub npm: unexpected command ${command}`)
  process.exit(2)
}
const filename = path.resolve(rest[0])
if (!fs.existsSync(filename)) {
  record({ command, rest, missing: filename })
  console.error(`stub npm: tarball does not exist: ${filename}`)
  process.exit(2)
}
const bytes = fs.readFileSync(filename)
const manifest = JSON.parse(packageFiles(filename).get('package.json'))
const dryRun = rest.includes('--dry-run')
const entry = {
  name: manifest.name,
  version: manifest.version,
  tarball: path.basename(filename),
  integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  distTag: rest[rest.indexOf('--tag') + 1],
  provenance: rest.includes('--provenance'),
}
const state = JSON.parse(fs.existsSync(publish) ? fs.readFileSync(publish, 'utf8') : '{}')
if (!dryRun) state[manifest.name] = entry
fs.writeFileSync(publish, JSON.stringify(state, null, 2) + '\n')
record({ command, rest, dryRun, name: manifest.name, version: manifest.version, tarball: entry.tarball,
  integrity: entry.integrity, provenance: entry.provenance, distTag: entry.distTag, registryConfigured: registry })
// npm 11/12 reject an existing stable version even during --dry-run.
if (dryRun && state[manifest.name]?.version === manifest.version && !manifest.version.includes('-')) {
  console.error(`You cannot publish over the previously published versions: ${manifest.version}.`)
  process.exit(1)
}
if (dryRun && process.env.SCRIPTOR_FAIL_DRY_RUN === manifest.name) {
  console.error(`Injected dry-run failure: ${manifest.name}`)
  process.exit(1)
}
console.log(`[stub npm] ${dryRun ? 'dry-run ' : ''}publish ${manifest.name}@${manifest.version}`)
