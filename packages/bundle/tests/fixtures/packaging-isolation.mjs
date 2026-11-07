/** Minimal real Loader check under Node permissions; workspace source is unreadable. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const [profile, hostAnchor, blockedSource, reportPath] = process.argv.slice(2)
assert.equal(process.permission.has('fs.read', blockedSource), false)
assert.throws(() => fs.readFileSync(blockedSource), { code: 'ERR_ACCESS_DENIED' })
const require = createRequire(hostAnchor)
const checkEmbedding = process.argv.includes('--embedding')
const packageRequire = checkEmbedding
  ? createRequire(require.resolve('@linfengqaqtat/dsh-scriptor-full/package.json', { paths: [profile] }))
  : createRequire(path.join(profile, 'package.json'))
const packageEntry = packageRequire.resolve('@linfengqaqtat/dsh-scriptor')
const { boot, PluginPackages } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
const resolution = JSON.parse(fs.readFileSync(path.join(profile, 'scriptor-probe-resolution.json'), 'utf8'))
const configPath = path.join(path.dirname(reportPath), 'isolation-loader.json')
const config = [
  { id: 'llm', name: pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href },
  { id: 'session', name: pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href },
  { id: 'agent', name: pathToFileURL(require.resolve('@deepseek-ai/dsh-agent')).href },
  { id: 'system-prompt', name: pathToFileURL(require.resolve('@deepseek-ai/dsh-system-prompt')).href },
  { id: 'tools', name: pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href },
  { id: 'tool-executor-native', name: pathToFileURL(require.resolve('@deepseek-ai/dsh-tool-executor-native')).href },
  { id: 'fs', name: pathToFileURL(require.resolve('@deepseek-ai/dsh-fs-local')).href, config: { cwd: process.cwd() } },
  { id: 'working-directory', name: pathToFileURL(require.resolve('@deepseek-ai/dsh-working-directory')).href },
  { id: 'skills', name: pathToFileURL(require.resolve('@deepseek-ai/dsh-skill')).href },
  { id: 'session-projection', name: pathToFileURL(require.resolve('@deepseek-ai/dsh-session-projection')).href },
  { id: 'agent-loop', name: pathToFileURL(require.resolve('@deepseek-ai/dsh-agent-loop')).href },
  { id: 'webnovel', name: pathToFileURL(packageEntry).href },
  { id: 'agent-preset-registry', name: pathToFileURL(require.resolve('@deepseek-ai/dsh-agent-preset-registry')).href, config: { default: 'scriptor' } },
  { id: 'preset-scriptor', name: pathToFileURL(require.resolve('@deepseek-ai/dsh-agent-preset')).href, config: { id: 'scriptor', name: '写作模式', plugins: [{ id: 'scriptor-agent', name: pathToFileURL(packageRequire.resolve('@linfengqaqtat/dsh-scriptor/preset')).href, isolate: { webnovelWriting: true } }] } },
]
if (checkEmbedding) {
  config.push({ id: 'credentials', name: pathToFileURL(require.resolve('@deepseek-ai/dsh-credentials-local')).href,
    config: { path: path.join(path.dirname(reportPath), 'full-credentials.yaml'), watch: false } })
  for (const [id, subpath] of [['webnovel-embeddings', ''], ['webnovel-scenes', '/scenes'], ['webnovel-reranking', '/reranking'], ['webnovel-graph', '/graph']]) {
    config.push({ id, name: pathToFileURL(packageRequire.resolve(`@linfengqaqtat/dsh-scriptor-retrieval${subpath}`)).href })
  }
}
fs.writeFileSync(configPath, JSON.stringify(config))
const ctx = await boot('packaging-source-isolation', configPath, [], async host => {
  await host.plugin(PluginPackages, { resolution })
})
try {
  assert.equal((await ctx.skills.list({ cwd: process.cwd() })).length, 0)
  // Skills are contributed by the installed writing preset, never by the root Host.
  const writing = await ctx.get('agents').create({ sessionId: 'packaging-writing', meta: { cwd: process.cwd(), agentPreset: 'scriptor' },
    setup: async scope => { await scope.get('agentPresets').mount(scope, 'scriptor') },
  })
  const skills = await ctx.skills.list({ cwd: process.cwd(), scope: writing.agent })
  assert.equal(skills.length, 12)
  for (const skill of skills) {
    const loaded = await ctx.skills.get(skill.name, { cwd: process.cwd(), scope: writing.agent })
    assert.equal(loaded.provider, 'webnovel-bundled')
    assert.ok(loaded.resourceBase.path.startsWith(path.resolve(path.dirname(packageEntry), '..', 'skills') + path.sep))
    assert.ok(loaded.content.length > 100)
  }
  if (checkEmbedding) {
    for (const service of ['embeddings', 'sceneSegmentation', 'reranking', 'graphExtraction']) assert.ok(ctx.get(service), `Full package must load ${service}`)
  }
  fs.writeFileSync(reportPath, JSON.stringify({ ok: true, sourceReadDenied: true, trustedNativeAddons: true, actualLoader: true, skills: skills.length, embeddingLoaded: checkEmbedding && !!ctx.get('embeddings'), graphLoaded: checkEmbedding && !!ctx.get('graphExtraction') }, null, 2) + '\n')
  console.log('Source-blocked installed Host Loader: 12 skills passed')
  await writing.dispose()
  assert.equal((await ctx.skills.list({ cwd: process.cwd() })).length, 0)
} finally { await ctx.fiber.dispose() }
