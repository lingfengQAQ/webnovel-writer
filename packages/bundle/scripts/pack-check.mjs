/** Inspect the actual tarball; never substitute the source files list for release evidence. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { isBuiltin } from 'node:module'
import { build } from 'esbuild'
import { parse } from 'yaml'
import { skills as skillNames, referenceDocs, thinScripts } from './artifact-contract.mjs'
import { packageFiles, checkPublishableManifest } from '../../../scripts/release/tar.mjs'
import { checkCliDependencies } from './build-cli.mjs'
import { checkStandaloneScripts } from './check-standalone-cli.mjs'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const temp = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'scriptor-pack-'))
const run = (exe, args, cwd = temp) => execFileSync(exe, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
let tarball = process.argv[2] && path.resolve(process.argv[2])
if (!tarball) {
  assert.ok(process.env.npm_execpath, 'Run via pnpm pack-check, or pass an existing tarball')
  run(process.execPath, [process.env.npm_execpath, 'pack', '--pack-destination', temp], packageRoot)
  const packed = fs.readdirSync(temp).filter(name => name.endsWith('.tgz'))
  assert.equal(packed.length, 1)
  tarball = path.join(temp, packed[0])
}
// Validate all archive metadata before materializing regular files. No tar links or PAX global overrides.
const extracted = path.join(temp, 'package')
const packedFiles = packageFiles(tarball)
for (const [relative, data] of packedFiles) {
  const target = path.join(extracted, ...relative.split('/'))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, data)
}
const entries = [...packedFiles.keys()].map(file => `package/${file}`)
const read = relative => fs.readFileSync(path.join(extracted, relative), 'utf8')
const manifest = JSON.parse(read('package.json'))
assert.equal(manifest.name, '@linfengqaqtat/dsh-scriptor')
checkPublishableManifest(manifest)
assert.equal(manifest.license, 'GPL-3.0-only')
assert.deepEqual(manifest.dsh.bundle.patch, ['./cordis.patch.yml', './presets/writing.patch.yml'])
assert.equal(manifest.exports['./client'], './lib/client.js')
assert.equal(manifest.exports['./preset'], './lib/preset.js')
assert.deepEqual(parse(read('cordis.patch.yml')), [{ insert: [{ id: 'webnovel', name: manifest.name }] }])
const writing = parse(read('presets/writing.patch.yml'))
assert.equal(writing[0].insert[0].id, 'preset-scriptor')
assert.equal(writing[0].insert[0].config.name, '写作模式')
assert.equal(writing[0].insert[0].config.selectedDefault, undefined)
assert.match(read('lib/preset.js'), /webnovelWriting/)
for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) assert.equal(manifest.scripts?.[hook], undefined)
for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })) {
  assert.ok(!name.startsWith('@webnovel/'), `Unpublished runtime dependency: ${name}`)
  assert.ok(!/^(workspace:|file:|link:)/.test(version), `Local runtime dependency: ${name}`)
}
const scripts = thinScripts.map(([file]) => file)
assert.deepEqual([...packedFiles.keys()].filter(file => file.startsWith('skills/') && file.endsWith('.mjs')).sort(), [...scripts].sort(),
  'Every packaged skill script must have a standalone acceptance scenario')
assert.deepEqual(fs.readdirSync(path.join(extracted, 'skills')).sort(), [...skillNames].sort())
for (const skill of skillNames) {
  const text = read(`skills/${skill}/SKILL.md`)
  assert.equal(parse(text.split('---')[1]).name, skill)
}
const expectedPrompts = [...skillNames.map(skill => `skills/${skill}/SKILL.md`), ...referenceDocs].sort()
assert.deepEqual([...packedFiles.keys()].filter(file => file.startsWith('skills/') && file.endsWith('.md')).sort(), expectedPrompts)
for (const reference of referenceDocs) assert.ok(read(reference).trim(), `Empty dispatch reference: ${reference}`)
for (const script of scripts) assert.match(read(script), /new URL\(['"]\.\.\/\.\.\/\.\.\/lib\/cli\.js['"], import\.meta\.url\)/)
for (const entry of entries) {
  const rel = entry.slice('package/'.length)
  assert.ok(/^(package\.json|README\.md|THIRD_PARTY_NOTICES\.md|licenses\/[^/]+\.txt|LICENSE|cordis\.patch\.yml|presets\/writing\.patch\.yml|lib\/(index|client|preset|cli)\.js|skills\/[\w-]+\/.+\.(md|mjs))$/.test(rel), `Unexpected release file: ${rel}`)
  const text = read(rel)
  assert.ok(!text.includes(path.resolve(packageRoot, '../..')), `Workspace path embedded in ${rel}`)
  assert.ok(!/-----BEGIN .*PRIVATE KEY-----|sk-[A-Za-z0-9]{24,}/.test(text), `Credential in ${rel}`)
  if (!rel.endsWith('.md')) assert.ok(!/file:\/\/[A-Za-z/]*:|[A-Z]:[\\/]wk[\\/]/.test(text), `Local runtime path in ${rel}`)
}
assert.ok(read('LICENSE').includes('GNU GENERAL PUBLIC LICENSE'))
assert.ok(read('THIRD_PARTY_NOTICES.md').includes('Original notices'))
assert.ok(entries.some(entry => entry.startsWith('package/licenses/')))
assert.ok(read('README.md').includes('--from-default-profile web'))
assert.ok(read('lib/client.js').includes(`id: ${JSON.stringify(manifest.name)}`))
const compiled = await build({ entryPoints: [path.join(extracted, 'lib/index.js')], bundle: true, packages: 'external', write: false, metafile: true, platform: 'node', format: 'esm', logLevel: 'silent' })
const imports = [...new Set(Object.values(compiled.metafile.outputs).flatMap(output => output.imports).map(item => item.path))].sort()
for (const name of imports) {
  const packageName = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]
  assert.ok(isBuiltin(name) || manifest.peerDependencies?.[packageName] || manifest.dependencies?.[packageName], `Undeclared packed import: ${name}`)
}
assert.equal(Object.keys(compiled.metafile.inputs).length, 1, 'Packed Host must be self-contained apart from declared peers')
const cli = await build({ entryPoints: [path.join(extracted, 'lib/cli.js')], bundle: true, packages: 'external', write: false, metafile: true, platform: 'node', format: 'esm', logLevel: 'silent' })
checkCliDependencies(cli)
assert.equal(Object.keys(cli.metafile.inputs).length, 1, 'Packed CLI must be self-contained apart from Node builtins')
// Source helpers prepare synthetic files only. The tested processes cannot read them.
const fixture = path.join(temp, 'standalone-book.mjs')
await build({ entryPoints: [path.join(packageRoot, 'tests/fixtures/standalone-book.ts')], outfile: fixture, bundle: true, platform: 'node', format: 'esm', target: 'node22.19', logLevel: 'silent',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'\nconst require = __createRequire(import.meta.url)" },
})
const { createStandaloneBook } = await import(pathToFileURL(fixture).href)
const book = path.join(temp, '书仓 测试')
createStandaloneBook(book)
const standalone = checkStandaloneScripts(extracted, book, path.join(temp, 'cli-report.json'), path.join(packageRoot, 'src/index.ts'))
const report = { package: manifest.name, version: manifest.version, tarball, sha256: createHash('sha256').update(fs.readFileSync(tarball)).digest('hex'), files: entries.length, skills: skillNames.length, scripts: scripts.length, imports, standalone, ok: true }
fs.writeFileSync(path.join(temp, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ...report, report: path.join(temp, 'report.json') }, null, 2))
