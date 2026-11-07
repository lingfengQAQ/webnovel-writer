import assert from 'node:assert/strict'
import fs from 'node:fs'

export const dshBaseline = JSON.parse(fs.readFileSync(new URL('../../dsh-baseline.json', import.meta.url), 'utf8'))

/** Installation compatibility is a range; reproducible development still uses exact SDK versions. */
export function checkDshCompatibility(manifest) {
  const compatibility = dshBaseline.compatibility
  assert.ok(compatibility?.range && compatibility.minimum, 'Missing DSH compatibility policy')
  assert.equal(manifest.engines?.dsh, compatibility.range, 'Package DSH range differs from the shared policy')
  assert.equal(manifest.engines?.node, compatibility.nodeRange, 'Package Node range differs from the supported DSH runtime')
  for (const [name, version] of Object.entries(manifest.peerDependencies ?? {})) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, compatibility.range, `DSH peer range drift: ${name}`)
    if (name === '@deepseek-ai/cordis') assert.equal(version, compatibility.cordisRange, 'Cordis peer must admit compatible 4.x updates')
  }
  for (const [name, version] of Object.entries(manifest.devDependencies ?? {})) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, dshBaseline.registry.version, `Development SDK must remain pinned: ${name}`)
  }
}
