/** Build one GitHub-only test package from a clean, independent public checkout. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { root as toolingRoot, releaseVersion } from './version.mjs'
import { checkTree } from './check-public-tree.mjs'
import { collectDependencySources } from './dependency-sources.mjs'
import { restoreNoticeLineEndings } from './release-source.mjs'

const MAIN = '@linfengqaqtat/dsh-scriptor'
const inside = (parent, child) => {
  const relative = path.relative(parent, child)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 }).trim()
function destinationIdentity(directory) {
  let ancestor = path.resolve(directory)
  const suffix = []
  while (!fs.existsSync(ancestor)) { suffix.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor) }
  return path.join(fs.realpathSync.native(ancestor), ...suffix)
}

export function testReleaseIdentity(sourceVersion, version) {
  const source = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(sourceVersion)
  const preview = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-preview\.([1-9]\d*)$/.exec(version)
  assert.ok(source && preview, 'Use a stable source version and an explicit next-patch preview.N version')
  assert.ok(source[1] === preview[1] && source[2] === preview[2] && BigInt(source[3]) + 1n === BigInt(preview[3]), 'Test version must be the next patch of the stable source')
  return { sourceVersion, version, tag: `scriptor-test-v${version}`, packageName: MAIN,
    filename: `linfengqaqtat-dsh-scriptor-${version}.tgz`, channel: 'github-test', prerelease: true }
}

export function checkedPnpmVersion(entry, packageManager) {
  assert.ok(entry && /^pnpm(?:\.[cm]?js)?$/.test(path.basename(entry)) && fs.statSync(entry).isFile(), 'Run via pnpm exec, or set PNPM_CLI_ENTRY to the pnpm CLI')
  const expected = /^pnpm@(\d+\.\d+\.\d+)$/.exec(packageManager)
  assert.ok(expected, 'Source packageManager must pin an exact pnpm version')
  entry = path.resolve(entry)
  const actual = execFileSync(process.execPath, [entry, '--version'], { cwd: path.dirname(entry), encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 }).trim()
  assert.equal(actual, expected[1], 'Selected pnpm CLI does not match the source packageManager pin')
  return actual
}

export function checkTestSource(root) {
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) {
    assert.ok(!process.env[name], 'Test source must not inherit an alternate Git directory, index or object store')
  }
  const dotGit = path.join(root, '.git')
  assert.ok(fs.lstatSync(dotGit).isDirectory() && !fs.lstatSync(dotGit).isSymbolicLink(), 'Test source must have its own public Git directory, not a shared worktree')
  assert.ok(!fs.existsSync(path.join(dotGit, 'commondir')) && !fs.existsSync(path.join(dotGit, 'objects/info/alternates')), 'Shared Git object stores are not permitted')
  assert.ok(!fs.lstatSync(path.join(dotGit, 'objects')).isSymbolicLink(), 'Git objects must stay in the public checkout')
  assert.equal(git(root, ['status', '--porcelain', '--untracked-files=all']), '', 'Test source checkout must be clean')
  checkTree(root)
  const commit = git(root, ['rev-parse', 'HEAD'])
  assert.match(commit, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
  return commit
}

/** Copy only declared package files; symlinks and ambiguous names never enter staging. */
export function stageTestPackage(packageRoot, staging, version) {
  const source = fs.realpathSync.native(packageRoot)
  const target = path.join(fs.realpathSync.native(path.dirname(staging)), path.basename(staging))
  assert.ok(!inside(source, target) && !fs.existsSync(target), 'Use a new staging directory outside the source package')
  const inspect = relative => {
    const parts = relative.split('/')
    let absolute = source, stat
    for (const [index, part] of parts.entries()) {
      absolute = path.join(absolute, part)
      stat = fs.lstatSync(absolute)
      assert.ok(!stat.isSymbolicLink(), `Package links are not permitted: ${parts.slice(0, index + 1).join('/')}`)
      if (index < parts.length - 1) assert.ok(stat.isDirectory(), `Non-directory package parent: ${relative}`)
    }
    const physical = fs.realpathSync.native(absolute)
    assert.ok(inside(source, physical), `Package path escapes the source: ${relative}`)
    return { absolute: physical, stat }
  }
  const original = fs.readFileSync(inspect('package.json').absolute)
  const manifest = JSON.parse(original)
  assert.equal(manifest.name, MAIN)
  testReleaseIdentity(manifest.version, version)
  assert.ok(Array.isArray(manifest.files) && manifest.files.length, 'Main package must declare its file allowlist')
  const selected = new Map()
  const walk = relative => {
    const { absolute, stat } = inspect(relative)
    if (stat.isDirectory()) return fs.readdirSync(absolute).sort().flatMap(name => walk(`${relative}/${name}`))
    assert.ok(stat.isFile(), `Non-regular package file: ${relative}`)
    return [relative]
  }
  for (const pattern of manifest.files) {
    assert.ok(typeof pattern === 'string' && pattern && !pattern.includes('\\') && !pattern.includes(':') && !pattern.includes('\0') &&
      !pattern.split('/').some(part => part === '' || part === '.' || part === '..') && ![...'?![]{}()'].some(char => pattern.includes(char)), 'Unsupported or unsafe package file pattern')
    const parts = pattern.split('/'), wildcard = parts.findIndex(part => part.includes('*'))
    const prefix = (wildcard < 0 ? parts : parts.slice(0, wildcard)).join('/')
    assert.ok(prefix, 'Package patterns must start in a named file or directory')
    const matches = walk(prefix).filter(relative => wildcard < 0 || path.posix.matchesGlob(relative, pattern))
    assert.ok(matches.length, `Package file pattern has no files: ${pattern}`)
    for (const relative of matches) {
      assert.notEqual(relative, 'package.json', 'The package manifest is supplied by the test overlay')
      const key = relative.normalize('NFC').toLowerCase()
      assert.ok(!selected.has(key) || selected.get(key) === relative, `Ambiguous package path: ${relative}`)
      selected.set(key, relative)
    }
  }
  fs.mkdirSync(target)
  for (const relative of [...selected.values()].sort()) {
    const { absolute, stat } = inspect(relative)
    assert.ok(stat.isFile(), `Non-regular package file: ${relative}`)
    const destination = path.join(target, ...relative.split('/'))
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(absolute, destination, fs.constants.COPYFILE_EXCL)
  }
  const overlay = { ...manifest, version, publishConfig: { ...manifest.publishConfig, tag: 'preview' } }
  delete overlay.devDependencies
  delete overlay.scripts
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(overlay, null, 2) + '\n', { flag: 'wx' })
  assert.deepEqual(fs.readFileSync(inspect('package.json').absolute), original, 'Source manifest changed during staging')
  return { manifest: overlay, files: ['package.json', ...selected.values()].sort() }
}

export async function buildTestRelease({ version, output, root = toolingRoot }) {
  root = fs.realpathSync.native(root)
  const publicCommit = checkTestSource(root)
  const sourceInfo = releaseVersion(root)
  const info = testReleaseIdentity(sourceInfo.version, version)
  if (process.env.RELEASE_TAG) assert.equal(process.env.RELEASE_TAG, info.tag, 'Test release tag must match the package version')
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
  const start = changelog.indexOf(`## [${info.version}]`)
  assert.ok(start >= 0, 'Missing versioned test-release changelog entry')
  const changes = changelog.slice(start).split(/\r?\n## \[/)[0].trim()
  assert.ok(output, 'Pass --out with a new, empty output directory outside the source checkout')
  output = path.resolve(output)
  assert.ok(!inside(root, destinationIdentity(output)), 'Test assets must be outside the source checkout')
  if (fs.existsSync(output)) assert.ok(fs.lstatSync(output).isDirectory() && !fs.lstatSync(output).isSymbolicLink() && fs.readdirSync(output).length === 0, 'Test output must be an empty ordinary directory')
  const selectedPnpm = process.env.PNPM_CLI_ENTRY ?? process.env.npm_execpath
  const pnpmEntry = selectedPnpm && path.resolve(selectedPnpm)
  const pnpmVersion = checkedPnpmVersion(pnpmEntry, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).packageManager)
  const temp = fs.realpathSync.native(os.tmpdir())
  assert.ok(!/\s/.test(temp) && !inside(root, temp), 'Staging needs a source-external temporary directory without spaces')
  const evidence = fs.mkdtempSync(path.join(temp, 'scriptor-test-'))
  console.log(`[test-build] Staging and failure evidence: ${evidence}`)
  fs.mkdirSync(output, { recursive: true })
  assert.ok(!inside(root, fs.realpathSync.native(output)), 'Test assets must not resolve inside the source checkout')
  const pnpm = (args, cwd = root) => execFileSync(process.execPath, [pnpmEntry, ...args], { cwd, windowsHide: true, stdio: 'inherit' })
  pnpm(['--filter', MAIN, 'build'])
  restoreNoticeLineEndings(root)
  assert.equal(git(root, ['status', '--porcelain', '--untracked-files=all']), '', 'Build changed tracked source or notices; review and commit them before packaging')
  const staging = path.join(evidence, 'package')
  const staged = stageTestPackage(path.join(root, 'packages/bundle'), staging, info.version)
  pnpm(['pack', '--pack-destination', output], staging)
  const tarball = path.join(output, info.filename)
  assert.deepEqual(fs.readdirSync(output), [info.filename], 'One test candidate must produce exactly one main-package tarball')
  const checked = execFileSync(process.execPath, [path.join(root, 'packages/bundle/scripts/pack-check.mjs'), tarball, '--github-test'],
    { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
  fs.writeFileSync(path.join(evidence, 'pack-check.log'), checked)
  const packCheck = JSON.parse(checked)
  assert.ok(packCheck.ok && packCheck.version === info.version && packCheck.sha256 === sha256(tarball), 'Test tarball failed its exact-artifact check')
  const recipe = { schemaVersion: 1, channel: info.channel, sourceVersion: info.sourceVersion, version: info.version, publicCommit,
    tool: 'scripts/release/build-test.mjs', steps: ['pnpm install --frozen-lockfile', `pnpm exec node scripts/release/build-test.mjs --version ${info.version} --out <new-empty-directory>`],
    manifestOverlay: { version: info.version, publishConfig: { tag: 'preview' }, remove: ['devDependencies', 'scripts'] },
    files: staged.files.map(file => ({ file, sha256: sha256(path.join(staging, ...file.split('/'))) })),
    note: 'Source retains its stable version. Only the isolated main-package manifest receives this test overlay; no npm upload is performed.' }
  fs.writeFileSync(path.join(output, 'build-recipe.json'), JSON.stringify(recipe, null, 2) + '\n')
  const source = `dsh-scriptor-${info.version}-source.tar.gz`
  git(root, ['archive', '--format=tar.gz', '--prefix=dsh-scriptor-source/', `--output=${path.join(output, source)}`, 'HEAD'])
  const dependencies = await collectDependencySources(root, output, { components: ['bundle'] })
  assert.equal(git(root, ['rev-parse', 'HEAD']), publicCommit, 'Source commit changed during the build')
  assert.equal(git(root, ['status', '--porcelain', '--untracked-files=all']), '', 'Source changed during the build')
  const baseline = JSON.parse(fs.readFileSync(path.join(root, 'dsh-baseline.json'), 'utf8'))
  const notes = `${changes}\n\n仅提供以 ${info.sourceVersion} 为基础的写作主插件 GitHub 测试安装包；未发布到 npm。检索、完整版与桌宠不在本次附件中。宿主兼容范围为 ${baseline.compatibility.range}，隔离安装验收的固定宿主为 DSH ${baseline.registry.version}。\n\n下载 ${info.filename}，核对 SHA256SUMS；停止原 profile 实例后，通过 DSH 插件页安装该本地文件，或在相同 profile 使用 dsh plugin --profile <原profile> add <下载后的tgz绝对路径>。仅验证安装包、预览和真实阻断项，不自动执行书仓升级。真实书仓是否可升级仍需重新预览确认。\n\n公开源码与对应第三方源码随本页提供；build-recipe.json 记录稳定源码到测试包的清单覆盖和重建命令。公开提交：${publicCommit}。\n`
  fs.writeFileSync(path.join(output, 'release-notes.md'), notes)
  const assets = fs.readdirSync(output).filter(file => fs.lstatSync(path.join(output, file)).isFile()).sort()
  const manifest = { schemaVersion: 1, ...info, publicCommit, node: process.version,
    pnpm: pnpmVersion,
    dsh: baseline.registry.version, dshCompatibility: baseline.compatibility.range, optionalPackages: [], dependencyCount: dependencies.length,
    buildValidated: true,
    packCheck: { ok: true, files: packCheck.files, skills: packCheck.skills, scripts: packCheck.scripts },
    verificationScope: 'Build and exact tarball checks; installation of the same tarball is recorded in separate release evidence before publication.',
    assets: assets.map(file => ({ file, sha256: sha256(path.join(output, file)) })) }
  fs.writeFileSync(path.join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  assets.push('release-manifest.json')
  fs.writeFileSync(path.join(output, 'SHA256SUMS'), assets.sort().map(file => `${sha256(path.join(output, file))}  ${file}`).join('\n') + '\n')
  return { ok: true, output, evidence, version: info.version, tag: info.tag, publicCommit, tarball, installation: 'pending' }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2).filter(arg => arg !== '--')
  assert.ok(args.length === 4 && args[0] === '--version' && args[2] === '--out', 'Usage: pnpm exec node scripts/release/build-test.mjs --version <next-patch-preview.N> --out <new-empty-directory>')
  console.log(JSON.stringify(await buildTestRelease({ version: args[1], output: args[3] }), null, 2))
}
