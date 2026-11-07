import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidence = path.resolve(process.argv[2])
const cli = path.resolve(process.argv[3])
const port = Number(process.argv[4] ?? 6096)
const indexCheck = process.argv.includes('--index')
const packageArg = process.argv.indexOf('--package')
if (packageArg >= 0 && !process.argv[packageArg + 1]) throw new Error('--package requires an installed package directory')
const testedPackage = packageArg >= 0 ? path.resolve(process.argv[packageArg + 1]) : packageRoot
const retrievalArg = process.argv.indexOf('--retrieval-package')
if (retrievalArg >= 0 && !process.argv[retrievalArg + 1]) throw new Error('--retrieval-package requires an installed package directory')
const testedRetrieval = retrievalArg >= 0 ? path.resolve(process.argv[retrievalArg + 1]) : path.resolve(packageRoot, '../embedding-provider')
const fullArg = process.argv.indexOf('--full-package')
if (fullArg >= 0 && !process.argv[fullArg + 1]) throw new Error('--full-package requires an installed meta package directory')
const testedFull = fullArg >= 0 ? path.resolve(process.argv[fullArg + 1]) : undefined
if (testedFull && !indexCheck) throw new Error('--full-package requires --index')
if (JSON.parse(fs.readFileSync(path.join(testedPackage, 'package.json'), 'utf8')).name !== '@linfengqaqtat/dsh-scriptor') throw new Error('Expected the installed Scriptor package')
if (!fs.existsSync(cli) || !Number.isInteger(port) || port < 1024) throw new Error('Supply the installed DSH CLI entry and an available port')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-browser-'))
const profile = path.join(root, 'profiles', 'web')
const workspaceArg = process.argv.indexOf('--workspace')
if (workspaceArg >= 0 && !process.argv[workspaceArg + 1]) throw new Error('--workspace requires a path')
const workspace = workspaceArg >= 0 ? path.resolve(process.argv[workspaceArg + 1]) : path.join(root, 'workspace')
fs.mkdirSync(profile, { recursive: true }); fs.mkdirSync(workspace, { recursive: true }); fs.mkdirSync(evidence, { recursive: true })
const linkPackage = (name, target) => {
  const link = path.join(profile, 'node_modules', name)
  fs.mkdirSync(path.dirname(link), { recursive: true })
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
}
linkPackage('@linfengqaqtat/dsh-scriptor', testedPackage)
if (indexCheck) linkPackage('@linfengqaqtat/dsh-scriptor-retrieval', testedRetrieval)
if (testedFull) linkPackage('@linfengqaqtat/dsh-scriptor-full', testedFull)
const extraBundles = testedFull ? ['@linfengqaqtat/dsh-scriptor-full'] : ['@linfengqaqtat/dsh-scriptor', ...(indexCheck ? ['@linfengqaqtat/dsh-scriptor-retrieval'] : [])]
fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ name: 'webnovel-acceptance-profile', private: true, type: 'module',
  dependencies: testedFull ? { '@linfengqaqtat/dsh-scriptor-full': 'file:' + testedFull } : { '@linfengqaqtat/dsh-scriptor': 'file:' + testedPackage, ...(indexCheck ? { '@linfengqaqtat/dsh-scriptor-retrieval': 'file:' + testedRetrieval } : {}) },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...extraBundles], patchReload: 'live' } } }, null, 2))
// Keep the Host-only fixture outside the source package so Client discovery uses the installed artifact.
const fixture = path.join(root, 'browser-fixture')
fs.mkdirSync(fixture)
fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'scriptor-browser-fixture', type: 'module' }))
for (const name of ['study-browser-host.mjs', 'index-browser-extension.mjs', 'graph-data.mjs', 'result-card-demo.mjs', 'maintenance-card-demo.mjs']) {
  fs.copyFileSync(path.join(packageRoot, 'tests/fixtures', name), path.join(fixture, name))
}
const hostRequire = createRequire(cli)
for (const name of ['dsh-llm', 'dsh-credentials', 'dsh-tool-present']) {
  const link = path.join(fixture, 'node_modules/@deepseek-ai', name)
  fs.mkdirSync(path.dirname(link), { recursive: true })
  const target = fs.realpathSync(path.dirname(hostRequire.resolve(`@deepseek-ai/${name}/package.json`)))
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
}
fs.writeFileSync(path.join(profile, 'cordis.yml'), '[]\n')
fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), JSON.stringify([
  { id: 'agent-default-model', config: { provider: 'webnovel-acceptance', model: 'fixture' } },
  { insert: [{ id: 'webnovel-browser-acceptance', name: pathToFileURL(path.join(fixture, 'study-browser-host.mjs')).href }] },
], null, 2))
const stdout = fs.openSync(path.join(root, 'stdout.log'), 'a')
const stderr = fs.openSync(path.join(root, 'stderr.log'), 'a')
const child = spawn(process.execPath, [cli, '--profile', 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
  cwd: workspace, env: { ...process.env, DSH_HOME: root, DSH_AGENTS_HOME: path.join(root, 'agents'), WEBNOVEL_TEST_PACKAGE: testedPackage, ...(indexCheck ? { WEBNOVEL_INDEX_CHECK: '1' } : {}), WEBNOVEL_BROWSER_WORKSPACE: workspace, WEBNOVEL_BROWSER_REPORT: path.join(evidence, 'browser-host-report.json'), DSH_TELEMETRY_DISABLED: '1' },
  detached: true, windowsHide: true, stdio: ['ignore', stdout, stderr],
})
child.unref(); fs.closeSync(stdout); fs.closeSync(stderr)
fs.writeFileSync(path.join(evidence, 'browser-runtime.json'), JSON.stringify({ root, workspace, port, processId: child.pid, testedPackage, ...(indexCheck ? { testedRetrieval } : {}), ...(testedFull ? { testedFull } : {}) }, null, 2) + '\n')
console.log(JSON.stringify({ processId: child.pid, port, root }))
