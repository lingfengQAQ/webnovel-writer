import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { writeNotices } from '../notices.mjs'

test('notices find the named owner above a nested package.json and preserve original text', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptor-notices-'))
  const dependency = path.join(root, 'node_modules/example')
  const output = path.join(root, 'output')
  const input = path.join(dependency, 'dist/index.js')
  fs.mkdirSync(path.dirname(input), { recursive: true })
  fs.mkdirSync(path.join(output, 'lib'), { recursive: true })
  try {
    fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }))
    fs.writeFileSync(path.join(dependency, 'LICENSE'), 'Original copyright and permission text')
    fs.writeFileSync(path.join(dependency, 'dist/package.json'), '{"type":"module"}')
    fs.writeFileSync(input, 'export const value = 1')
    const builds = [{ metafile: { inputs: { [input]: {} } } }]
    writeNotices(output, builds)
    assert.ok(fs.readFileSync(path.join(output, 'licenses/example--1.0.0.txt'), 'utf8').includes('Original copyright and permission text'))
    fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({ name: 'example', version: '1.0.0', license: 'UNLICENSED' }))
    assert.throws(() => writeNotices(output, builds), /Review bundled license/)
    fs.unlinkSync(path.join(dependency, 'LICENSE'))
    fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({ name: 'saxes', version: '6.0.0', license: 'ISC' }))
    writeNotices(output, builds)
    assert.match(fs.readFileSync(path.join(output, 'licenses/saxes--6.0.0.txt'), 'utf8'), /Copyright \(c\) Isaac Z. Schlueter/)
    fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({ name: 'saxes', version: '7.0.0', license: 'ISC' }))
    assert.throws(() => writeNotices(output, builds), /No original license file/)
    fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({ name: '@antv/event-emitter', version: '0.1.3', license: 'MIT' }))
    writeNotices(output, builds)
    const declaration = fs.readFileSync(path.join(output, 'licenses/antv__event-emitter--0.1.3.txt'), 'utf8')
    assert.match(declaration, /Original npm metadata declares MIT/)
    assert.match(declaration, /Permission is hereby granted/)
    assert.match(declaration, /not an upstream copyright notice/)
    assert.match(fs.readFileSync(path.join(output, 'THIRD_PARTY_NOTICES.md'), 'utf8'), /Declaration and license terms/)
    fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({ name: '@antv/event-emitter', version: '0.1.3', license: 'ISC' }))
    assert.throws(() => writeNotices(output, builds), /License declaration mismatch/)
    fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({ name: '@antv/event-emitter', version: '0.1.4', license: 'MIT' }))
    assert.throws(() => writeNotices(output, builds), /No original license file/)
  } finally {
    const remove = directory => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const target = path.join(directory, entry.name); if (entry.isDirectory()) remove(target); else fs.unlinkSync(target) } fs.rmdirSync(directory) }
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
    remove(root)
  }
})
