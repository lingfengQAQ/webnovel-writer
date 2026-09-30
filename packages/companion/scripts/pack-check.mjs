import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { packageFiles, checkPublishableManifest } from '../../../scripts/release/tar.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-pack-'))
let tarball = process.argv[2] && path.resolve(process.argv[2])
if (!tarball) {
  assert.ok(process.env.npm_execpath, 'Run through pnpm pack-check')
  execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--pack-destination', temp], { cwd:root, stdio:'pipe', windowsHide:true })
  tarball = path.join(temp, fs.readdirSync(temp).find(p=>p.endsWith('.tgz')))
}
const files = packageFiles(tarball)
const text = name => { assert.ok(files.has(name), 'Missing ' + name); return files.get(name).toString('utf8') }
const manifest = JSON.parse(text('package.json'))
assert.equal(manifest.name, '@linfengqaqtat/dsh-scriptor-companion')
checkPublishableManifest(manifest)
assert.equal(manifest.exports['./client'], './lib/client.js')
assert.ok(text('cordis.patch.yml').includes("name: '@linfengqaqtat/dsh-scriptor-companion'"))
assert.equal(manifest.dsh.client.platform, 'web')
const allowed = ['package.json','lib/index.js','lib/client.js','assets/manifest.json','cordis.patch.yml','README.md','LICENSE','MEDIA.md'].sort()
assert.deepEqual([...files.keys()].sort(), allowed)
const client = text('lib/client.js')
assert.ok(client.includes(`id: ${JSON.stringify(manifest.name)}`))
assert.ok(!client.includes(root) && !client.includes('v16-dola') && !client.includes('file:///'))
const hashes = [...client.matchAll(/data:[^"']+?;base64,([A-Za-z0-9+/=]+)/g)].map(match => createHash('sha256').update(Buffer.from(match[1],'base64')).digest('hex'))
const media = JSON.parse(text('assets/manifest.json'))
assert.equal(Object.keys(media.assets).length, 10)
for (const asset of [...Object.values(media.assets), media.poster]) assert.ok(hashes.includes(asset.sha256), 'Missing/corrupt embedded media: ' + asset.file)
assert.ok(text('LICENSE').includes('GNU GENERAL PUBLIC LICENSE'))
assert.ok(text('lib/index.js').includes('apply'))
const extracted = path.join(temp,'package')
for (const [relative,data] of files) { const target=path.join(extracted,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data) }
const report = {ok:true,tarball,extracted,bytes:fs.statSync(tarball).size,sha256:createHash('sha256').update(fs.readFileSync(tarball)).digest('hex'),files:files.size,embeddedMedia:hashes.length}
fs.writeFileSync(path.join(temp,'report.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))
