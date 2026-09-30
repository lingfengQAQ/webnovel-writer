import * as fs from 'node:fs'
import * as path from 'node:path'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

/** Synthetic API and controls exist only inside the isolated browser test profile. */
export async function attachIndexFixture(ctx, root, report, persist, { seed = true } = {}) {
  const book = path.join(root, '验收作品甲')
  const stats = { requests: 0, successes: 0, failures: 0, documents: 0, mode: 'ok', holdAfter: null }
  const pending = new Set()
  let failNext = 0
  const respond = (res, body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)) }
  const send = (res, body) => {
    if (res.destroyed) return
    stats.successes++
    stats.documents += body.input.length
    respond(res, { data: body.input.map((_input, index) => ({ index, embedding: [1, 0, 0.5] })).reverse() })
    report.indexApi = { ...stats }; persist()
  }
  const api = createServer((req, res) => {
    void (async () => {
      let text = ''
      for await (const part of req) text += part
      const body = JSON.parse(text)
      if (req.url === '/v1/rerank') {
        report.rerankRequests = (report.rerankRequests ?? 0) + 1
        respond(res, { results: body.documents.map((_text, index) => ({ index, relevance_score: 1 / (index + 1) })) })
        persist()
        return
      }
      stats.requests++
      if (stats.mode === 'auth' || failNext > 0) {
        if (failNext > 0) failNext--
        stats.failures++; res.statusCode = stats.mode === 'auth' ? 401 : 503
        if (res.statusCode === 503) res.setHeader('retry-after', '2')
        respond(res, { error: { message: 'Synthetic acceptance failure' } })
      } else if (stats.mode === 'hold' && stats.holdAfter !== null && stats.successes >= stats.holdAfter) {
        const entry = { res, body }; pending.add(entry)
        res.once('close', () => pending.delete(entry))
      } else send(res, body)
      report.indexApi = { ...stats }; persist()
    })().catch(() => res.destroy())
  })
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
  report.rerankEndpoint = 'http://127.0.0.1:' + api.address().port + '/v1/rerank'
  await ctx.credentials.set(credentialRef('WEBNOVEL_RERANK_API_KEY'), 'synthetic-rerank-key')
  persist()
  ctx.effect(() => () => {
    api.closeAllConnections()
    return new Promise(resolve => api.close(resolve))
  }, 'index acceptance API')
  if (seed) {
    for (let number = 3; number <= 7; number++) {
      const file = path.join(book, `定稿/卷01/${String(number).padStart(4, '0')}-索引验收.md`)
      fs.writeFileSync(file, `---\n版本: 1\n角色: 已定稿\n---\n第${number}章的独立测试正文，书信、渡口和归航。\n`)
    }
    fs.writeFileSync(path.join(book, '.gitignore'), '草稿区/\n.webnovel/\n')
  }
  const git = (...args) => execFileSync('git', args, { cwd: book, encoding: 'utf8', windowsHide: true })
  if (!fs.existsSync(path.join(book, '.git'))) {
    git('init', '--quiet'); git('config', 'user.name', 'Browser Index Test'); git('config', 'user.email', 'browser-index@example.invalid')
    git('config', 'commit.gpgsign', 'false'); git('config', 'core.autocrlf', 'false')
    git('add', '.'); git('commit', '--quiet', '-m', 'fixture')
  }
  await ctx.credentials.set(credentialRef('WEBNOVEL_BROWSER_EMBED_KEY'), 'fixture-only-key')
  await ctx.settings.update('webnovel-embeddings', { enabled: true, protocol: 'openai-compatible', baseURL: `http://127.0.0.1:${api.address().port}/v1`,
    model: 'local-index-fixture', dimensions: 3, batchSize: 1, maxRetries: 0, apiKeyEnv: 'WEBNOVEL_BROWSER_EMBED_KEY' })
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/__index-fixture', handler: async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const mode = url.searchParams.get('mode')
    if (mode && ['ok', 'hold', 'retry', 'auth'].includes(mode)) {
      stats.mode = mode === 'retry' ? 'ok' : mode
      if (mode === 'retry') failNext = 1
      stats.holdAfter = mode === 'hold' ? stats.successes + Number(url.searchParams.get('after') ?? 2) : null
      if (mode !== 'hold') { for (const entry of pending) send(entry.res, entry.body); pending.clear() }
    }
    if (url.searchParams.get('action') === 'commit') {
      const file = path.join(book, '定稿/卷01/0003-索引验收.md')
      fs.appendFileSync(file, `\n外部提交补充 ${Date.now()}。\n`)
      git('add', '.'); git('commit', '--quiet', '-m', 'external index update')
    }
    report.indexApi = { ...stats }; persist()
    respond(res, { ...stats, held: pending.size, root: book })
  } }), 'index acceptance controls')
}
