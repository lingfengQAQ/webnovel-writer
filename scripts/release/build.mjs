import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { root as toolingRoot, releaseVersion } from './version.mjs'
import { checkTree } from './check-public-tree.mjs'
import { checkEmbeddingPackage, checkMetaPackage } from './tar.mjs'
import { collectDependencySources } from './dependency-sources.mjs'
import { restoreNoticeLineEndings } from './release-source.mjs'

const sourceIndex = process.argv.indexOf('--source')
const root = sourceIndex >= 0 ? path.resolve(process.argv[sourceIndex + 1]) : toolingRoot
const packagesIndex = process.argv.indexOf('--packages')
const originalPackages = packagesIndex >= 0 ? path.resolve(process.argv[packagesIndex + 1]) : undefined
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
const info = releaseVersion(root, process.env.RELEASE_TAG)
assert.equal(git(['status', '--porcelain']), '', 'Release source checkout must be clean')
if (sourceIndex >= 0) {
  assert.ok(process.env.RELEASE_TAG, '--source requires RELEASE_TAG')
  assert.equal(git(['rev-parse', 'HEAD']), git(['rev-parse', `${info.tag}^{commit}`]), 'Source must match the immutable release tag')
  checkTree(root)
}
// checkTree validation happens in CI workflow after export; development repo may contain internal tools
const outputIndex = process.argv.indexOf('--out')
const output = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : path.join(root, '.tmp', 'release', info.version)
assert.ok(!fs.existsSync(output) || fs.readdirSync(output).length === 0, 'Release output must be empty; never overwrite a version')
fs.mkdirSync(output, { recursive: true })
const pnpm = (args, cwd = root) => execFileSync(process.execPath, [process.env.npm_execpath, ...args], { cwd, stdio: 'inherit', windowsHide: true })
assert.ok(process.env.npm_execpath, 'Run via pnpm release:build')
const pack = (directory, filename) => {
  if (!originalPackages) return pnpm(['pack', '--pack-destination', output], path.join(root, directory))
  const original = path.join(originalPackages, filename)
  assert.ok(fs.lstatSync(original).isFile(), 'Original package must be a regular file')
  fs.copyFileSync(original, path.join(output, filename), fs.constants.COPYFILE_EXCL)
}
pnpm(['build'])
restoreNoticeLineEndings(root)
assert.equal(git(['status', '--porcelain']), '', 'Build changed tracked notices or metadata; commit them before release')
pack('packages/bundle', info.filename)
const main = path.join(output, info.filename)
pnpm(['--filter', info.packageName, 'pack-check', main])
const embedding = JSON.parse(fs.readFileSync(path.join(root, 'packages/embedding-provider/package.json'), 'utf8'))
const embeddingTarball = `linfengqaqtat-dsh-scriptor-retrieval-${embedding.version}.tgz`
pack('packages/embedding-provider', embeddingTarball)
checkEmbeddingPackage(path.join(output, embeddingTarball), embedding.version)
const meta = JSON.parse(fs.readFileSync(path.join(root, 'packages/meta/package.json'), 'utf8'))
const metaTarball = `linfengqaqtat-dsh-scriptor-full-${meta.version}.tgz`
pack('packages/meta', metaTarball)
checkMetaPackage(path.join(output, metaTarball), info.version, embedding.version)
const companion = JSON.parse(fs.readFileSync(path.join(root, 'packages/companion/package.json'), 'utf8'))
const companionTarball = `linfengqaqtat-dsh-scriptor-companion-${companion.version}.tgz`
pack('packages/companion', companionTarball)
pnpm(['--filter', companion.name, 'pack-check', path.join(output, companionTarball)])
const source = `dsh-scriptor-${info.version}-source.tar.gz`
git(['archive', '--format=tar.gz', '--prefix=dsh-scriptor-source/', `--output=${path.join(output, source)}`, 'HEAD'])
const dependencies = await collectDependencySources(root, output)
const hash = file => createHash('sha256').update(fs.readFileSync(path.join(output, file))).digest('hex')
const assets = fs.readdirSync(output).filter(file => fs.statSync(path.join(output, file)).isFile()).sort()
const manifest = { schemaVersion: 1, ...info, publicCommit: git(['rev-parse', 'HEAD']), node: process.version,
  pnpm: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).packageManager.split('@').pop(),
  dsh: JSON.parse(fs.readFileSync(path.join(root, 'dsh-baseline.json'), 'utf8')).registry.version,
  optionalPackages: [
    { name: embedding.name, version: embedding.version, tarball: embeddingTarball },
    { name: meta.name, version: meta.version, tarball: metaTarball },
    { name: companion.name, version: companion.version, tarball: companionTarball }
  ], dependencyCount: dependencies.length,
  assets: assets.map(file => ({ file, sha256: hash(file) })) }
fs.writeFileSync(path.join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
assets.push('release-manifest.json')
fs.writeFileSync(path.join(output, 'SHA256SUMS'), assets.sort().map(file => `${hash(file)}  ${file}`).join('\n') + '\n')
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
const notes = changelog.slice(changelog.indexOf(`## [${info.version}]`)).split(/\n## \[/)[0]
fs.writeFileSync(path.join(output, 'release-notes.md'), notes + '\n\n校验与安装：请使用本页 SHA256SUMS、release-manifest.json 和对应源码，参阅 v8 分支的安装教程。\n')
console.log(JSON.stringify({ ok: true, output, version: info.version, publicCommit: manifest.publicCommit, assets: assets.length }))
