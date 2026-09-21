import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { root as sourceRoot } from './version.mjs'
import { packageFiles } from './tar.mjs'

const fromRegistry = process.argv.includes('--registry')
const args = process.argv.slice(2).filter(value => value !== '--' && value !== '--registry')
assert.ok(args[0], 'Usage: pnpm release:smoke <main.tgz> [embedding.tgz] [meta.tgz] [--registry] [--root <new-directory>]')
const main = path.resolve(args[0])
const embedding = args[1] && args[1] !== '--root' ? path.resolve(args[1]) : undefined
const meta = args[2] && args[2] !== '--root' ? path.resolve(args[2]) : undefined
const rootIndex = args.indexOf('--root')
const root = rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'scriptor-install-'))
assert.ok(root !== sourceRoot && !root.startsWith(sourceRoot + path.sep), 'Use an isolated directory outside the source checkout')
assert.ok(!root.includes(' '), 'The current Windows DSH plugin installer requires a path without spaces')
if (fs.existsSync(root)) assert.equal(fs.readdirSync(root).length, 0, 'Isolation directory must be empty')
fs.mkdirSync(root, { recursive: true })
const host = path.join(root, 'host')
const home = path.join(root, 'home')
const workspace = path.join(root, 'workspace')
for (const directory of [host, home, workspace]) fs.mkdirSync(directory)
fs.writeFileSync(path.join(host, 'package.json'), JSON.stringify({ name: 'scriptor-isolated-host', private: true, type: 'module' }))
fs.writeFileSync(path.join(root, 'npmrc'), '')
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(npm_|pnpm_)|TOKEN|API_KEY|SECRET|DSH_|AGENTS_HOME|NODE_PATH/i.test(key)))
Object.assign(env, { DSH_HOME: home, DSH_AGENTS_HOME: path.join(root, 'agents'), DSH_TELEMETRY_DISABLED: '1', NPM_CONFIG_USERCONFIG: path.join(root, 'npmrc') })
const run = (entry, rest, cwd = workspace, timeout = 240000) => execFileSync(process.execPath, [entry, ...rest], { cwd, env, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 24 * 1024 * 1024 })
const npmCandidates = [process.env.NPM_CLI_ENTRY, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean)
const npm = npmCandidates.find(file => fs.existsSync(file))
assert.ok(npm, 'npm-cli.js was not found; set NPM_CLI_ENTRY to the installed npm CLI')
const report = { ok: false, node: process.version, packageSha256: createHash('sha256').update(fs.readFileSync(main)).digest('hex'), checks: {} }
const reportPath = path.join(root, 'install-report.json')
const log = (name, output) => { fs.writeFileSync(path.join(root, `${name}.log`), output); console.log(`[install] ${name}`) }
const packageSpec = file => {
  const manifest = JSON.parse(packageFiles(file).get('package.json'))
  return `${manifest.name}@${manifest.version}`
}
let fixtureRegistry
let fixtureRegistryUrl
try {
  // Hosted Windows runners with a cold npm cache exceeded 4 minutes for the DSH tree; the network-bound step gets its own bound.
  log('install-host', run(npm, ['install', '--prefix', host, '--save-exact', '--no-audit', '--no-fund', '@deepseek-ai/dsh@0.1.5-rc.2', 'pnpm@11.27.1'], host, 15 * 60 * 1000))
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
  env[pathKey] = path.join(host, 'node_modules/.bin') + path.delimiter + (env[pathKey] ?? '')
  report.hostPackageManager = 'pnpm@11.27.1'
  const require = createRequire(path.join(host, 'package.json'))
  const hostAnchor = require.resolve('@deepseek-ai/dsh/package.json')
  const cli = path.join(path.dirname(hostAnchor), 'lib/bin.js')
  assert.equal(run(cli, ['--version']).trim(), '0.1.5-rc.2')
  report.checks.freshHost = true
  log('web-profile', run(cli, ['--profile', 'scriptor-test', '--from-default-profile', 'web', '--dump-config']))
  const copiedMain = path.join(root, 'main.tgz')
  fs.copyFileSync(main, copiedMain)
  const mainSpec = fromRegistry ? packageSpec(main) : copiedMain
  log('add-main', run(cli, ['plugin', '--profile', 'scriptor-test', 'add', mainSpec]))
  report.installSource = fromRegistry ? 'npm' : 'tarball'
  const profile = path.join(home, 'profiles/scriptor-test')
  const dump = run(cli, ['--profile', 'scriptor-test', '--dump-config'])
  assert.ok(dump.includes('@linfengqaqtat/dsh-scriptor'))
  report.checks.configuration = true
  const installed = require.resolve('@linfengqaqtat/dsh-scriptor/package.json', { paths: [profile] })
  const installedRoot = path.dirname(installed)
  assert.ok(installedRoot.startsWith(root + path.sep))
  const prepare = path.join(root, 'prepare-profile.mjs')
  fs.copyFileSync(path.join(sourceRoot, 'packages/bundle/tests/fixtures/packaging-prepare.mjs'), prepare)
  log('prepare-profile', run(prepare, [profile, hostAnchor]))
  const script = path.join(root, 'isolation.mjs')
  fs.copyFileSync(path.join(sourceRoot, 'packages/bundle/tests/fixtures/packaging-isolation.mjs'), script)
  const isolatedReport = path.join(root, 'source-isolation.json')
  const blocked = path.join(sourceRoot, 'packages/bundle/src/index.ts')
  const output = execFileSync(process.execPath, ['--permission', `--allow-fs-read=${root}`, `--allow-fs-write=${root}`, `--allow-fs-read=${path.dirname(process.execPath)}`, script, profile, hostAnchor, blocked, isolatedReport], { cwd: workspace, env, encoding: 'utf8', windowsHide: true, timeout: 45000 })
  log('source-isolation', output)
  assert.equal(JSON.parse(fs.readFileSync(isolatedReport, 'utf8')).ok, true)
  report.checks.sourceDeniedRealLoader = true
  report.checks.skills = 10
  if (embedding) {
    const copiedEmbedding = path.join(root, 'embedding.tgz')
    fs.copyFileSync(embedding, copiedEmbedding)
    log('add-embedding', run(cli, ['plugin', '--profile', 'scriptor-test', 'add', fromRegistry ? packageSpec(embedding) : copiedEmbedding]))
    assert.ok(run(cli, ['--profile', 'scriptor-test', '--dump-config']).includes('webnovel-embedding-provider'))
    report.checks.embeddingInstalled = true
  }
  fs.writeFileSync(path.join(workspace, 'author-sentinel.txt'), 'synthetic author asset')
  log('remove-main', run(cli, ['plugin', '--profile', 'scriptor-test', 'remove', '@linfengqaqtat/dsh-scriptor']))
  assert.ok(!/@linfengqaqtat\/dsh-scriptor(?!-)/.test(run(cli, ['--profile', 'scriptor-test', '--dump-config'])))
  assert.equal(fs.readFileSync(path.join(workspace, 'author-sentinel.txt'), 'utf8'), 'synthetic author asset')
  log('reinstall-main', run(cli, ['plugin', '--profile', 'scriptor-test', 'add', mainSpec]))
  assert.ok(/@linfengqaqtat\/dsh-scriptor(?!-)/.test(run(cli, ['--profile', 'scriptor-test', '--dump-config'])))
  assert.equal(fs.readFileSync(path.join(workspace, 'author-sentinel.txt'), 'utf8'), 'synthetic author asset')
  report.checks.uninstallReinstall = true
  if (meta) {
    assert.ok(embedding, 'Full package validation requires the embedding tarball')
    const fullName = 'scriptor-full-test'
    log('full-web-profile', run(cli, ['--profile', fullName, '--from-default-profile', 'web', '--dump-config']))
    const fullProfile = path.join(home, 'profiles', fullName)
    assert.ok(!run(cli, ['--profile', fullName, '--dump-config']).includes('id: webnovel'))
    const copiedMeta = path.join(root, 'meta.tgz')
    fs.copyFileSync(meta, copiedMeta)
    if (!fromRegistry) {
      // Serve the two exact tarballs without changing their manifests or adding
      // workspace configuration to a user profile. Other packages use npmjs.
      fixtureRegistry = spawn(process.execPath, [path.join(sourceRoot, 'scripts/release/fixture-registry.mjs'), copiedMain, path.join(root, 'embedding.tgz')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] })
      fixtureRegistryUrl = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Fixture registry startup timed out')), 10000)
        let output = ''
        fixtureRegistry.once('error', error => { clearTimeout(timer); reject(error) })
        fixtureRegistry.once('exit', code => { clearTimeout(timer); reject(new Error(`Fixture registry exited: ${code}`)) })
        fixtureRegistry.stdout.on('data', data => {
          output += data
          if (output.includes('\n')) { clearTimeout(timer); resolve(output.trim()) }
        })
      })
      assert.match(fixtureRegistryUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/)
    }
    const fullSpec = fromRegistry ? packageSpec(meta) : copiedMeta
    const registryArgs = fixtureRegistryUrl ? ['--registry', fixtureRegistryUrl] : []
    const fullDump = () => run(cli, ['--profile', fullName, '--dump-config'])
    const verifyFull = label => {
      const config = fullDump()
      assert.equal((config.match(/id: webnovel(?:\r?\n|$)/g) ?? []).length, 1)
      assert.equal((config.match(/id: webnovel-embeddings(?:\r?\n|$)/g) ?? []).length, 1)
      log(`${label}-prepare`, run(prepare, [fullProfile, hostAnchor]))
      const fullReport = path.join(root, `${label}-isolation.json`)
      log(`${label}-loader`, execFileSync(process.execPath, ['--permission', `--allow-fs-read=${root}`, `--allow-fs-write=${root}`, `--allow-fs-read=${path.dirname(process.execPath)}`, script, fullProfile, hostAnchor, blocked, fullReport, '--embedding'], { cwd: workspace, env, encoding: 'utf8', windowsHide: true, timeout: 45000 }))
      assert.equal(JSON.parse(fs.readFileSync(fullReport, 'utf8')).embeddingLoaded, true)
    }
    log('add-meta', run(cli, ['plugin', '--profile', fullName, 'add', fullSpec, ...registryArgs]))
    verifyFull('full')
    // pnpm remove has no --registry option, but removing one package re-resolves
// the remaining tree, so the unpublished dependencies are located through the
// profile's own npmrc instead.
    if (fixtureRegistryUrl) fs.writeFileSync(path.join(fullProfile, '.npmrc'), `registry=${fixtureRegistryUrl}\n`)
    log('remove-meta', run(cli, ['plugin', '--profile', fullName, 'remove', '@linfengqaqtat/dsh-scriptor-full']))
    assert.ok(!fullDump().includes('@linfengqaqtat/dsh-scriptor'))
    assert.ok(!fullDump().includes('webnovel-embedding-provider'))
    log('reinstall-meta', run(cli, ['plugin', '--profile', fullName, 'add', fullSpec, ...registryArgs]))
    verifyFull('full-reinstall')
    report.checks.metaFreshProfile = true
    report.checks.metaUninstallReinstall = true
  }
  report.ok = true
} finally {
  fixtureRegistry?.kill()
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ ...report, report: reportPath }))
}
