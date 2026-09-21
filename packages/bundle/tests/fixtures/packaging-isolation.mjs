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
const { boot } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
const configPath = path.join(path.dirname(reportPath), 'isolation-loader.json')
const config = [
  { id: 'skills', name: pathToFileURL(require.resolve('@deepseek-ai/dsh-skill')).href },
  { id: 'webnovel', name: pathToFileURL(packageEntry).href },
]
if (checkEmbedding) {
  config.unshift({ id: 'llm', name: pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href })
  config.unshift({ id: 'credentials', name: pathToFileURL(require.resolve('@deepseek-ai/dsh-credentials-local')).href,
    config: { path: path.join(path.dirname(reportPath), 'full-credentials.yaml'), watch: false } })
  config.push({ id: 'embedding', name: pathToFileURL(packageRequire.resolve('webnovel-embedding-provider')).href })
}
fs.writeFileSync(configPath, JSON.stringify(config))
const ctx = await boot('packaging-source-isolation', configPath)
try {
  const skills = await ctx.skills.list({ cwd: process.cwd() })
  assert.equal(skills.length, 10)
  for (const skill of skills) assert.ok((await ctx.skills.get(skill.name)).content.length > 100)
  if (checkEmbedding) assert.ok(ctx.get('embeddings'), 'Full package must load the embedding service')
  fs.writeFileSync(reportPath, JSON.stringify({ ok: true, sourceReadDenied: true, actualLoader: true, skills: skills.length, embeddingLoaded: checkEmbedding && !!ctx.get('embeddings') }, null, 2) + '\n')
  console.log('Source-blocked installed Host Loader: 10 skills passed')
} finally { await ctx.fiber.dispose() }
