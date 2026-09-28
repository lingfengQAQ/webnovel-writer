/** Match the CLI's launch initialization before the source-denied probe. */
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const [profile, hostAnchor] = process.argv.slice(2)
const require = createRequire(hostAnchor)
const { loadProfile, createRuntimeResolution } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
const home = path.dirname(path.dirname(profile))
const resolution = await createRuntimeResolution({ installAnchor: hostAnchor, home,
  profile: loadProfile('dsh', path.basename(profile), hostAnchor, home) })
fs.writeFileSync(path.join(profile, 'scriptor-probe-resolution.json'), JSON.stringify(resolution))
console.log('Computed the isolated profile runtime resolution using the host launch API')
