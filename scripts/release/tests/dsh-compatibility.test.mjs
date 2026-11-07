import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { checkDshCompatibility, dshBaseline } from '../dsh-compatibility.mjs'

const require = createRequire(new URL('../../../packages/bundle/package.json', import.meta.url))
const { evaluatePluginCompatibility } = require('@deepseek-ai/dsh-app-boot')
const manifest = JSON.parse(fs.readFileSync(new URL('../../../packages/bundle/package.json', import.meta.url), 'utf8'))

test('DSH official prerelease matching permits the supported series and excludes the next minor', () => {
  for (const version of ['0.2.2-rc.1', '0.2.2-rc.2', '0.2.2', '0.2.3-alpha.1', '0.2.3-rc.1', '0.2.99']) {
    assert.equal(evaluatePluginCompatibility(manifest, {}, version), undefined, version)
  }
  for (const version of ['0.2.1-rc.3', '0.2.2-alpha.3', '0.2.2-rc.0', '0.3.0-alpha.1', '0.3.0', '1.0.0']) {
    assert.ok(evaluatePluginCompatibility(manifest, {}, version), version)
  }
  assert.equal(evaluatePluginCompatibility(manifest, {}, dshBaseline.registry.version), undefined)
})

test('all four artifacts share compatibility while SDK development dependencies stay exact', () => {
  for (const name of ['bundle', 'meta', 'embedding-provider', 'companion']) {
    checkDshCompatibility(JSON.parse(fs.readFileSync(new URL(`../../../packages/${name}/package.json`, import.meta.url), 'utf8')))
  }
  assert.throws(() => checkDshCompatibility({ ...manifest, engines: { ...manifest.engines, dsh: dshBaseline.registry.version } }), /range/)
  assert.throws(() => checkDshCompatibility({ ...manifest, peerDependencies: { ...manifest.peerDependencies, '@deepseek-ai/dsh-tools': '*' } }), /drift/)
  assert.throws(() => checkDshCompatibility({ ...manifest, devDependencies: { ...manifest.devDependencies, '@deepseek-ai/dsh-tools': dshBaseline.compatibility.range } }), /pinned/)
})
