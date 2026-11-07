import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createSettingsProfile } from '../../../bundle/tests/fixtures/settings-profile.mjs'
import { loadSourceHost } from '../../../bundle/scripts/dsh-source.mjs'

const root = process.argv[2], plugin = pathToFileURL(process.argv[3]).href
const host = process.env.WEBNOVEL_DSH_SOURCE ? loadSourceHost(process.env.WEBNOVEL_DSH_SOURCE) : undefined
const load = name => import(host ? pathToFileURL(host.entry(name)).href : name)
const appBoot = await load('@deepseek-ai/dsh-app-boot'), { LlmAdapter } = await load('@deepseek-ai/dsh-llm')
const rows = [
  { id: 'config-editor', name: '@deepseek-ai/dsh-config-editor' },
  { id: 'settings', name: '@deepseek-ai/dsh-settings' },
  { id: 'llm', name: '@deepseek-ai/dsh-llm' },
  { id: 'webnovel-graph', name: plugin },
].map(row => host && row.name.startsWith('@deepseek-ai/') ? { ...row, name: pathToFileURL(host.entry(row.name)).href } : row)
const fixture = createSettingsProfile(root, rows, appBoot)
let calls = 0
class Adapter extends LlmAdapter {
  providerInfo(id) { return { id, name: '图谱验收模型' } }
  async listModels() { return [{ id: 'graph-fixture', name: '图谱验收模型' }] }
  async resolveModel(provider, model) { return { provider, id: model, name: model, defaultMaxTokens: 24576 } }
  async *stream(options) {
    calls++
    assert.equal(options.purpose, undefined); assert.equal(options.sessionId, undefined)
    assert.equal(options.messages.length, 1); assert.equal(options.maxTokens, 24576)
    assert.match(options.system, /不凭共现/)
    const value = JSON.parse(options.messages[0].content[0].text)
    assert.equal(value.text, '甲帮助了乙。')
    const text = JSON.stringify({ relations: [{ from: 'a', to: 'b', relation: '帮助', qualifier: 'asserted', quote: value.text }] })
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
let ctx
try {
  ctx = await fixture.start('graph-model-settings')
  const settings = ctx.get('settings'), service = ctx.get('graphExtraction')
  assert.ok(service); assert.equal(ctx.get('embeddings'), undefined); assert.equal(service.current(), undefined)
  ctx.get('llm').registerAdapter(['graph-route'], new Adapter())
  const initial = settings.describe().find(item => item.ns === 'webnovel-graph')
  assert.equal(initial.autoGenerate, false)
  await assert.rejects(settings.update('webnovel-graph', { enabled: true }))
  await settings.update('webnovel-graph', { enabled: true, provider: 'graph-route', model: 'graph-fixture' })
  const first = service.current()
  assert.equal(service.current(), first)
  assert.equal(first.metadata.maxOutputTokens, undefined)
  assert.equal(first.metadata.maxInputChars, undefined)
  const input = { sourceKind: 'world-append', fields: { 状态: '已成事实' }, text: '甲帮助了乙。', entities: [{ id: 'a', label: '甲', aliases: [] }, { id: 'b', label: '乙', aliases: [] }] }
  assert.equal((await first.extract(input)).data.relations[0].quote, input.text)
  await assert.rejects(settings.update('webnovel-graph', { timeoutMs: 20000 }, initial.revision), { code: 'SETTINGS_CONFLICT' })
  await settings.update('webnovel-graph', { timeoutMs: 40000 })
  await assert.rejects(first.extract(input))
  const row = [...ctx.get('loader').entries()].find(entry => entry.options.id === 'webnovel-graph')
  await row.update({ disabled: true }, false, true); await ctx.get('loader').await()
  assert.equal(ctx.get('graphExtraction'), undefined)
  await row.update({ disabled: false }, false, true); await ctx.get('loader').await()
  assert.equal(ctx.get('graphExtraction').current().metadata.timeoutMs, 40000)
  assert.ok(fs.readFileSync(fixture.profile.patchPath, 'utf8').includes('40000'))
  assert.equal(calls, 1)
  console.log(JSON.stringify({ independentOfEmbeddings: true, nativeLlm: true, sourceChecked: true, revisionConflict: true, restoredSettings: true }))
} finally { if (ctx) await ctx.fiber.dispose() }
