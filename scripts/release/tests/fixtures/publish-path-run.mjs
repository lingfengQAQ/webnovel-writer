/**
 * End-to-end publish-path fixture: runs the real publisher against a stub npm CLI
 * and a first-publication registry, so the exact argv, the package order and the
 * retry behaviour are observed instead of assumed.
 *
 * Usage: node publish-path-run.mjs <assets-directory> <work-directory> [--publish|--verify-only]
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'

const assets = path.resolve(process.argv[2])
const work = path.resolve(process.argv[3])
const mode = process.argv[4] ?? '--publish'
// The caller decides whether an earlier run's registry state is kept, so a retry
// sees the versions an earlier publish created.
if (process.env.SCRIPTOR_KEEP_STATE !== '1' && fs.existsSync(work)) fs.rmSync(work, { recursive: true, force: true })
fs.mkdirSync(work, { recursive: true })
const log = path.join(work, 'invocations.jsonl')
const publishState = path.join(work, 'published.json')
fs.writeFileSync(log, '')

const readState = () => (fs.existsSync(publishState) ? JSON.parse(fs.readFileSync(publishState, 'utf8')) : {})
const registry = createServer((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return }
  const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname.slice(1))
  const tarball = name.match(/^tarballs\/([A-Za-z0-9][A-Za-z0-9._-]*)$/)
  if (tarball) {
    const file = path.join(assets, tarball[1])
    if (!fs.existsSync(file)) { response.writeHead(404); response.end(); return }
    response.writeHead(200, { 'content-type': 'application/octet-stream' })
    response.end(fs.readFileSync(file))
    return
  }
  const entry = readState()[name]
  if (!entry) { response.writeHead(404); response.end(); return }
  const now = new Date().toISOString()
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ name, 'dist-tags': { [entry.distTag]: entry.version },
    time: { created: now, modified: now, [entry.version]: now },
    versions: { [entry.version]: { name, version: entry.version,
      dist: { tarball: `http://127.0.0.1:${registry.address().port}/tarballs/${entry.tarball}`, integrity: entry.integrity } } } }))
})

registry.listen(0, '127.0.0.1', async () => {
  const origin = `http://127.0.0.1:${registry.address().port}/`
  try {
    // Absolute paths come from the caller so the fixture never depends on module-relative resolution.
    const publisher = process.env.SCRIPTOR_PUBLISHER
    const stub = process.env.SCRIPTOR_STUB_NPM
    if (!publisher || !stub || !fs.existsSync(publisher) || !fs.existsSync(stub)) {
      throw new Error(`publish-path fixture needs existing SCRIPTOR_PUBLISHER and SCRIPTOR_STUB_NPM: ${publisher}, ${stub}`)
    }
    const environment = {
      ...process.env,
      SCRIPTOR_NPM_REGISTRY: origin,
      SCRIPTOR_STUB_REGISTRY: origin,
      SCRIPTOR_STUB_LOG: log,
      SCRIPTOR_STUB_PUBLISH: publishState,
      NPM_CLI_ENTRY: stub,
      GITHUB_ACTIONS: 'true',
      NODE_AUTH_TOKEN: 'fixture-token',
    }
    // The publisher must refuse to upload without the Actions provenance authority.
    if (environment.SCRIPTOR_STRIP_GITHUB) delete environment.GITHUB_ACTIONS
    const child = spawn(process.execPath, [publisher, '--assets', assets, ...mode.split(' ')], {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    const [code] = await once(child, 'exit')
    fs.writeFileSync(path.join(work, 'publisher.out'), Buffer.concat(stdout).toString('utf8'))
    fs.writeFileSync(path.join(work, 'publisher.err'), Buffer.concat(stderr).toString('utf8'))
    console.log(JSON.stringify({ code, origin, work }))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  } finally {
    registry.close()
  }
})