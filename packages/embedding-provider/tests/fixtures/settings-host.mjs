import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import * as appBoot from '@deepseek-ai/dsh-app-boot'
import { createSettingsProfile } from '../../../bundle/tests/fixtures/settings-profile.mjs'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

const root = process.argv[2]
const plugin = pathToFileURL(process.argv[3]).href
const requests = []
const server = createServer((req, res) => {
  void (async () => {
    let text = ''
    for await (const part of req) text += part
    const body = JSON.parse(text)
    requests.push({ body, key: req.headers.authorization })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: body.input.map((_text, index) => ({ index, embedding: Array.from({ length: body.dimensions }, (_, i) => i + 1) })) }))
  })().catch(() => res.destroy())
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const credentialsFile = path.join(root, 'credentials.yaml')
const fixture = createSettingsProfile(root, [
  { id: 'config-editor', name: '@deepseek-ai/dsh-config-editor' },
  { id: 'settings', name: '@deepseek-ai/dsh-settings' },
  { id: 'credentials', name: '@deepseek-ai/dsh-credentials-local', config: { path: credentialsFile, watch: false } },
  { id: 'webnovel-embeddings', name: plugin },
], appBoot)
const settingsFile = fixture.profile.patchPath
let ctx
try {
  ctx = await fixture.start('webnovel-embedding-settings-test')
  const settings = ctx.get('settings')
  const credentials = ctx.get('credentials')
  const service = ctx.get('embeddings')
  const namespace = 'webnovel-embeddings'
  assert.equal(service.current(), undefined)
  const descriptor = settings.describe({ redactSecrets: true }).find(item => item.ns === namespace)
  assert.ok(descriptor)
  assert.equal(descriptor.autoGenerate, false)
  assert.ok(JSON.stringify(descriptor.schema).includes('dimensions'))
  assert.equal(requests.length, 0)
  const base = { enabled: true, protocol: 'openai-compatible', baseURL: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture-model', apiKeyEnv: 'WEBNOVEL_TEST_EMBED_KEY' }
  await assert.rejects(settings.update(namespace, base), /维度/)
  await credentials.set(credentialRef(base.apiKeyEnv), 'fixture-native-credential')
  await settings.update(namespace, { ...base, dimensions: 3 })
  const first = service.current()
  assert.equal(first.metadata.dimensions, 3)
  assert.deepEqual(await first.embed([{ text: '合成测试文本' }], 'query'), [[1, 2, 3]])
  assert.equal(requests[0].body.dimensions, 3)
  assert.equal(requests[0].key, 'Bearer fixture-native-credential')
  assert.ok(!fs.readFileSync(settingsFile, 'utf8').includes('fixture-native-credential'))
  assert.ok(!JSON.stringify(settings.describe({ redactSecrets: true })).includes('fixture-native-credential'))
  await settings.update(namespace, { dimensions: 4 })
  await assert.rejects(settings.update(namespace, { dimensions: 5 }, descriptor.revision), { code: 'SETTINGS_CONFLICT' })
  assert.equal(service.current().metadata.dimensions, 4)
  const next = service.current()
  assert.notEqual(next.metadata.revision, first.metadata.revision)
  assert.equal(next.metadata.dimensions, 4)
  await assert.rejects(first.embed([{ text: '旧配置不可再调用' }], 'query'), /配置已变更/)
  await next.embed([{ text: '新配置' }], 'query')
  assert.equal(requests.at(-1).body.dimensions, 4)
  const row = [...ctx.get('loader').entries()].find(entry => entry.options.id === namespace)
  await row.update({ disabled: true }, false, true)
  await ctx.get('loader').await()
  assert.equal(ctx.get('embeddings'), undefined)
  assert.ok(!settings.describe().some(item => item.ns === namespace))
  await row.update({ disabled: false }, false, true)
  await ctx.get('loader').await()
  assert.equal(ctx.get('embeddings').current().metadata.dimensions, 4)
  await settings.update(namespace, { enabled: false })
  assert.equal(ctx.get('embeddings').current(), undefined)
  console.log(JSON.stringify({ nativeSettings: true, dimensionsRequired: true, dimensionsSentAndValidated: true, revisionChanges: true, credentialsIsolated: true, reloadPreservesSettings: true }))
} finally {
  if (ctx) await ctx.fiber.dispose()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
