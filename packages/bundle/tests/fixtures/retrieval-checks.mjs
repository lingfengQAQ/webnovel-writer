import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { checkAuxiliary } from './auxiliary-checks.mjs'

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

/** Actual Loader + scoped tools + installed embedding plugin + loopback HTTP. */
export async function checkSearch({ root, workspace, main, child, ctx, service, execute, check, toggle, host }) {
  const { credentialRef } = await import(host === undefined ? '@deepseek-ai/dsh-credentials' : pathToFileURL(host.entry('@deepseek-ai/dsh-credentials')).href)
  const bookId = 'loader-search'
  const book = path.join(workspace, '检索验收书')
  const put = (relative, body, base = book) => {
    const file = path.join(base, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, body)
    return file
  }
  put('作品契约/契约.md', `---\n书id: ${bookId}\n---\n# 检索验收书\n`)
  const first = put('定稿/卷01/0001-归家.md', '---\n版本: 7\n角色: 已定稿\n备注: 页眉秘密\n---\n\n归家：林舟回到故乡。\n\n## 草稿候选事实\n- 候选秘密\n')
  put('定稿/卷01/0002-故乡.md', '---\n版本: 1\n角色: 已定稿\n---\n\n他终于重返阔别多年的家园。\n')
  put('草稿区/草稿/稿1.md', '未定稿秘密')
  const git = (...args) => execFileSync('git', args, { cwd: book, encoding: 'utf8', windowsHide: true })
  git('init', '--quiet')
  git('config', 'user.name', 'Search Loader')
  git('config', 'user.email', 'search-loader@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'core.autocrlf', 'false')
  git('add', '.')
  git('commit', '--quiet', '-m', 'fixture')
  const originalHead = git('rev-parse', 'HEAD')
  const originalText = fs.readFileSync(first, 'utf8')
  const requests = []
  let held
  const server = createServer((req, res) => {
    void (async () => {
      let text = ''
      for await (const part of req) text += part
      const body = JSON.parse(text)
      assert.equal(req.url, '/v1/embeddings')
      assert.equal(req.headers.authorization, 'Bearer fixture-search-key')
      requests.push(body)
      if (held) {
        const pause = held
        pause.entered.resolve()
        await pause.release.promise
      }
      if (res.destroyed) return
      res.setHeader('content-type', 'application/json')
      const data = body.input.map((input, index) => ({
        index,
        embedding: Array.from({ length: body.dimensions }, (_, dimension) => dimension === 0 ? 1 : dimension === 1 && input.startsWith('document:\n') && input.includes('归家') ? 0.2 : 0),
      })).reverse()
      res.end(JSON.stringify({ data }))
    })().catch(() => res.destroy())
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const ns = 'webnovel-embeddings'
  const search = async (query = '归家', agent = main, signal) => {
    const result = await execute(agent, 'novel_search_finalized', { bookId, query }, signal)
    assert.equal(result.isError, false, JSON.stringify(result))
    return result.value
  }
  const manage = async (action = 'status') => {
    const result = await execute(main, 'novel_index_manage', { bookId, action })
    assert.equal(result.isError, false, JSON.stringify(result))
    assert.equal(result.value.ok, true, JSON.stringify(result))
    return result.value.index
  }
  const ready = async () => {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const state = await manage()
      if (state.phase === 'ready') return state
      if (state.phase === 'failed') assert.fail(JSON.stringify(state))
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    assert.fail('background index did not finish: ' + JSON.stringify(await manage()))
  }
  const pause = () => { held = { entered: deferred(), release: deferred() }; return held }
  const release = () => { held?.release.resolve(); held = undefined }
  try {
    await check('定稿检索真实权限、关键词与原文定位', async () => {
      const result = await search('林舟')
      assert.equal(result.ok, true, JSON.stringify(result))
      assert.equal(result.mode, 'keyword')
      assert.equal(result.hits.length, 1)
      const hit = result.hits[0]
      assert.equal(hit.absolutePath, first)
      assert.equal(hit.version, 7)
      assert.equal(hit.hash, createHash('sha256').update(originalText).digest('hex'))
      assert.match(hit.来源标注.状态, /未经原文核对/)
      assert.ok(originalText.split('\n').slice(hit.startLine - 1, hit.endLine).join('\n').includes(hit.snippet))
      const read = await execute(main, 'read', { file_path: hit.absolutePath })
      assert.equal(read.isError, false, JSON.stringify(read))
      assert.match(JSON.stringify(read), /林舟回到故乡/)
      assert.equal(requests.length, 0)
      for (const agent of [child, undefined]) {
        for (const name of ['novel_search_finalized', 'novel_index_manage']) {
          const denied = await execute(agent, name, { bookId, query: '归家' })
          assert.equal(denied.isError, true)
          assert.match(JSON.stringify(denied), /UNKNOWN_TOOL/)
        }
      }
      const elsewhere = path.join(root, 'search-other-workspace')
      const otherBook = path.join(elsewhere, '同id书')
      put('作品契约/契约.md', `---\n书id: ${bookId}\n---\n另一工作范围`, otherBook)
      put('定稿/卷01/0001-独立.md', '其他工作区线索', otherBook)
      const other = await service('agents').create({ sessionId: 'loader-search-other', meta: { cwd: elsewhere } })
      try {
        assert.equal((await search('林舟', other.agent)).hits.length, 0)
        assert.equal((await search('其他工作区线索', other.agent)).hits[0].absolutePath, path.join(otherBook, '定稿/卷01/0001-独立.md'))
      } finally { await other.dispose() }
    })

    await check('独立嵌入提供方真实 HTTP 混合检索与配置刷新', async () => {
      await service('credentials').set(credentialRef('WEBNOVEL_SEARCH_TEST_KEY'), 'fixture-search-key')
      await service('settings').update(ns, {
        enabled: true, protocol: 'openai-compatible', baseURL: `http://127.0.0.1:${server.address().port}/v1`,
        model: 'controlled-fixture', dimensions: 3, apiKeyEnv: 'WEBNOVEL_SEARCH_TEST_KEY',
        documentPrefix: 'document:', queryPrefix: 'query:', maxRetries: 0,
      })
      await manage('enable')
      assert.equal((await ready()).generated, 2)
      const result = await search()
      assert.equal(result.mode, 'hybrid', JSON.stringify(result))
      assert.deepEqual(result.hits.map(hit => hit.chapter), [1, 2])
      assert.deepEqual(result.hits.map(hit => hit.matchedBy), [['keyword', 'semantic'], ['semantic']])
      assert.equal(result.index.embedded, 0)
      assert.equal(requests.length, 2)
      assert.ok(requests[0].input.every(text => text.startsWith('document:\n')))
      assert.deepEqual(requests[1].input, ['query:\n归家'])
      assert.ok(!/页眉秘密|候选秘密|未定稿秘密/.test(JSON.stringify(requests)))
      const cached = await search()
      assert.equal(cached.index.embedded, 0)
      assert.equal(cached.index.reused, 2)
      await service('settings').update(ns, { model: 'fixture-next', dimensions: 4 })
      await manage('update')
      assert.equal((await ready()).generated, 2)
      const changed = await search()
      assert.equal(changed.mode, 'hybrid')
      assert.equal(changed.index.embedded, 0)
      assert.equal(changed.index.reused, 2)
      assert.equal(requests.at(-1).dimensions, 4)
      assert.equal(git('rev-parse', 'HEAD'), originalHead)
      assert.equal(fs.readFileSync(first, 'utf8'), originalText)
      assert.equal(git('status', '--porcelain'), '')
    })

    await check('嵌入提供方卸载、晚到与取消不污染缓存', async () => {
      await service('settings').update(ns, { dimensions: 5 })
      const firstPause = pause()
      await manage('update')
      await firstPause.entered.promise
      assert.equal(fs.existsSync(path.join(book, '.webnovel/book.lock')), false)
      assert.equal((await manage('pause')).phase, 'paused')
      release()
      await manage('resume')
      assert.equal((await ready()).generated, 2)
      const retried = await search()
      assert.equal(retried.index.embedded, 0)
      assert.equal(retried.index.reused, 2)
      await service('settings').update(ns, { dimensions: 6 })
      const secondPause = pause()
      await manage('update')
      await secondPause.entered.promise
      await toggle('webnovel-embeddings', true)
      release()
      assert.equal((await search()).mode, 'keyword')
      await toggle('webnovel-embeddings', false)
      await manage('update')
      assert.equal((await ready()).generated, 2)
      const restored = await search()
      assert.equal(restored.mode, 'hybrid')
      assert.equal(restored.index.embedded, 0)
      assert.equal(git('rev-parse', 'HEAD'), originalHead)
      assert.equal(fs.readFileSync(first, 'utf8'), originalText)
    })
    await checkAuxiliary({ book, bookId, main, service, execute, check, manage, ready, toggle, host })
  } finally {
    release()
    await manage('disable')
    await service('settings').update(ns, { enabled: false })
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
