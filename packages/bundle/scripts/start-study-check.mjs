import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidence = path.resolve(process.argv[2])
const cli = path.resolve(process.argv[3])
const port = Number(process.argv[4] ?? 6096)
const indexCheck = process.argv.includes('--index')
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
linkPackage('@linfengqaqtat/dsh-scriptor', packageRoot)
if (indexCheck) linkPackage('webnovel-embedding-provider', path.resolve(packageRoot, '../embedding-provider'))
fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ name: 'webnovel-acceptance-profile', private: true, type: 'module', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], patchReload: 'live' } } }, null, 2))
fs.writeFileSync(path.join(profile, 'cordis.yml'), '[]\n')
fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), JSON.stringify([
  { id: 'agent-default-model', config: { provider: 'webnovel-acceptance', model: 'fixture' } },
  { insert: [{ id: 'webnovel', name: '@linfengqaqtat/dsh-scriptor' },
    ...(indexCheck ? [['webnovel-embeddings', ''], ['webnovel-scenes', '/scenes'], ['webnovel-reranking', '/reranking']].map(([id, entry]) => ({ id, name: `webnovel-embedding-provider${entry}` })) : []),
    { id: 'webnovel-browser-acceptance', name: pathToFileURL(path.join(packageRoot, 'tests/fixtures/study-browser-host.mjs')).href }] },
], null, 2))
const stdout = fs.openSync(path.join(root, 'stdout.log'), 'a')
const stderr = fs.openSync(path.join(root, 'stderr.log'), 'a')
const child = spawn(process.execPath, [cli, '--profile', 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
  cwd: packageRoot, env: { ...process.env, DSH_HOME: root, ...(indexCheck ? { WEBNOVEL_INDEX_CHECK: '1' } : {}), WEBNOVEL_BROWSER_WORKSPACE: workspace, WEBNOVEL_BROWSER_REPORT: path.join(evidence, 'browser-host-report.json'), DSH_TELEMETRY_DISABLED: '1' },
  detached: true, windowsHide: true, stdio: ['ignore', stdout, stderr],
})
child.unref(); fs.closeSync(stdout); fs.closeSync(stderr)
fs.writeFileSync(path.join(evidence, 'browser-runtime.json'), JSON.stringify({ root, workspace, port, processId: child.pid }, null, 2) + '\n')
console.log(JSON.stringify({ processId: child.pid, port, root }))
