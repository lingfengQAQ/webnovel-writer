import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'

/** Both npm and pinned-source runs use the actual LLM registry, settings, tools and HTTP. */
export async function checkAuxiliary({ book, bookId, main, service, execute, check, manage, ready, toggle, host }) {
  const load = name => import(host ? pathToFileURL(host.entry(name)).href : name)
  const { LlmAdapter } = await load('@deepseek-ai/dsh-llm')
  const { credentialRef } = await load('@deepseek-ai/dsh-credentials')
  let sceneCalls = 0
  class SceneAdapter extends LlmAdapter {
    providerInfo(provider) { return { id: provider, name: '场景验收' } }
    async listModels() { return [{ id: 'scene-fixture', name: '场景验收模型' }] }
    async *stream(options) {
      sceneCalls++
      assert.equal(options.messages.length, 1)
      assert.equal(options.purpose, undefined)
      assert.equal(options.sessionId, undefined)
      const paragraphs = JSON.parse(options.messages[0].content[0].text)
      const text = JSON.stringify({ ends: [paragraphs.length] })
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const unregister = service('llm').registerAdapter(['retrieval-scene-fixture'], new SceneAdapter())
  let rankCalls = 0
  const api = createServer((request, response) => {
    void (async () => {
      let raw = ''
      for await (const chunk of request) raw += chunk
      const input = JSON.parse(raw)
      assert.equal(request.headers.authorization, 'Bearer rerank-fixture-key')
      assert.equal(input.top_n, input.documents.length)
      rankCalls++
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ results: input.documents.map((text, index) => ({ index, relevance_score: text.includes('重返') ? 1 : 0 })).reverse() }))
    })().catch(() => response.destroy())
  })
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
  try {
    await check('宿主场景模型、独立缓存与可选重排完整接线', async checkpoint => {
      checkpoint('enable scene provider')
      const settings = service('settings')
      assert.ok(settings.describe().some(item => item.ns === 'webnovel-scenes'))
      assert.ok(settings.describe().some(item => item.ns === 'webnovel-reranking'))
      assert.equal(service('sceneSegmentation').current(), undefined)
      assert.equal(service('reranking').current(), undefined)
      await settings.update('webnovel-scenes', { enabled: true, provider: 'retrieval-scene-fixture', model: 'scene-fixture', concurrency: 2 })
      assert.ok(service('sceneSegmentation').current() === service('sceneSegmentation').current(), 'scene provider must remain stable without config changes')
      checkpoint('generate scenes')
      await manage('update')
      const state = await ready()
      assert.equal(state.scenes.completed, 2)
      assert.equal(state.scenes.fallback, 0)
      assert.equal(sceneCalls, 2)
      const cachePath = path.join(book, '.webnovel/finalized-scenes.json')
      const cached = fs.readFileSync(cachePath, 'utf8')
      assert.ok(!cached.includes('林舟'))
      checkpoint('rebuild with cached scenes')
      await manage('rebuild')
      await ready()
      assert.equal(sceneCalls, 2)
      assert.equal(fs.readFileSync(cachePath, 'utf8'), cached)
      checkpoint('rescan chapter scenes')
      const reset = await execute(main, 'novel_index_manage', { bookId, action: 'rescan-scenes', chapter: 1 })
      assert.equal(reset.value.ok, true, JSON.stringify(reset))
      await ready()
      assert.equal(sceneCalls, 3)
      checkpoint('enable reranking')
      await service('credentials').set(credentialRef('WEBNOVEL_RERANK_FIXTURE'), 'rerank-fixture-key')
      await settings.update('webnovel-reranking', { enabled: true, endpoint: 'http://127.0.0.1:' + api.address().port + '/rerank',
        model: 'fixture-rerank', apiKeyEnv: 'WEBNOVEL_RERANK_FIXTURE' })
      const defaultRanking = service('reranking').current()
      assert.equal(defaultRanking.metadata.timeoutMs, 30_000)
      checkpoint('update reranking timeout')
      await settings.update('webnovel-reranking', { timeoutMs: 45_000 })
      assert.equal(service('reranking').current().metadata.timeoutMs, 45_000)
      checkpoint('reject retired reranker')
      await assert.rejects(defaultRanking.rerank('旧超时配置', [{ text: '不能发送' }]))
      await assert.rejects(settings.update('webnovel-reranking', { timeoutMs: 120_001 }))
      checkpoint('search with reranking')
      const result = await execute(main, 'novel_search_finalized', { bookId, query: '归家', limit: 1 })
      assert.equal(result.isError, false, JSON.stringify(result))
      assert.equal(result.value.ok, true, JSON.stringify(result))
      assert.equal(result.value.reranking.applied, true)
      assert.equal(result.value.reranking.candidates, 2)
      assert.equal(result.value.hits[0].chapter, 2)
      assert.ok(result.value.hits[0].scene)
      const literal = await execute(main, 'novel_search_finalized', { bookId, query: '林舟', mode: 'keyword' })
      assert.equal(literal.value.mode, 'keyword')
      assert.equal(rankCalls, 1)
      const oldRanking = service('reranking').current()
      checkpoint('unload providers')
      await toggle('webnovel-embeddings', true)
      assert.equal(service('sceneSegmentation'), undefined)
      assert.equal(service('reranking'), undefined)
      await assert.rejects(oldRanking.rerank('旧服务', [{ text: '不能发送' }]))
      checkpoint('reload providers')
      await toggle('webnovel-embeddings', false)
      assert.ok(service('reranking').current())
      assert.equal(service('reranking').current().metadata.timeoutMs, 45_000)
      assert.ok(service('sceneSegmentation').current())
      await manage('update')
      await ready()
      assert.equal(sceneCalls, 3)
    })
  } finally {
    await service('settings').update('webnovel-scenes', { enabled: false })
    await service('settings').update('webnovel-reranking', { enabled: false })
    if (typeof unregister === 'function') unregister()
    api.closeAllConnections()
    await new Promise(resolve => api.close(resolve))
  }
}
