import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Initial catalog enters via the actual pre-step waterfall and normal user/message events. */
export async function checkMemoryCatalog({ host, ctx, workspace, book, service, execute, check, report, withTurn }) {
  const { LlmAdapter, createUserMessage } = await import(host === undefined
    ? '@deepseek-ai/dsh-llm' : pathToFileURL(host.entry('@deepseek-ai/dsh-llm')).href)
  class CatalogAdapter extends LlmAdapter {
    async *stream() {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: '已读取上下文。' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '已读取上下文。' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const releaseAdapter = service('llm').registerAdapter(['catalog-fixture'], new CatalogAdapter())
  const agentOptions = { provider: 'catalog-fixture', model: 'fixture' }
  const authorDir = path.join(workspace, '书房', '作者记忆')
  const entry = (dir, name, fields, body) => {
    fs.mkdirSync(dir, { recursive: true })
    const head = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')
    fs.writeFileSync(path.join(dir, `${name}.md`), `---\n${head}\n---\n\n${body}\n`)
  }
  const index = (dir, title, rows) => fs.writeFileSync(path.join(dir, '索引.md'), `# ${title}\n\n${rows.map(([n, d]) => `- [${n}](${n}.md) — ${d}`).join('\n')}\n`)
  const memoryText = async (agent, expectedCatalogs = 1) => {
    const assembly = await service('systemPrompt').assemble({ agent, scope: agent })
    assert.equal(assembly.contexts.filter(c => c.name === 'webnovel.memory').length, 0)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error('catalog fixture turn timeout')) }, 10000)
      const off = ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject !== agent || status !== 'idle') return
        clearTimeout(timer); off(); resolve()
      })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: '核对本次上下文。' }], source: { kind: 'user' } }))
    })
    const catalogs = Array.from({ length: agent.session.seq }, (_, i) => agent.session.eventAt(i))
      .filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin:webnovel-memory-catalog')
    assert.equal(catalogs.length, expectedCatalogs)
    return { rendered: catalogs.map(catalog => ({ text: catalog.data.content[0].text })) }
  }
  await check('记忆目录会话开始快照与选书目录', async () => {
    entry(authorDir, '冷开场', { 名称: '冷开场', 描述: '作者偏好 {{冷开场}} 直接入戏', 类: '文风', 标签: '[测试书]', 来源: '对谈', 生成模块: '模型' }, '正文不得进目录。')
    index(authorDir, '作者记忆索引', [['冷开场', '作者偏好 {{冷开场}} 直接入戏']])
    const created = await service('agents').create({ sessionId: 'loader-memory', meta: { cwd: workspace }, agentOptions })
    const agent = created.agent
    try {
      const first = await memoryText(agent)
      assert.equal(first.rendered.length, 1)
      const text = first.rendered[0].text
      assert.match(text, /【作者记忆目录】会话开始时/)
      assert.match(text, /- 冷开场 — 作者偏好 \{\{冷开场\}\} 直接入戏｜类：文风/)
      assert.ok(text.includes(path.join(authorDir, '索引.md')), text)
      assert.doesNotMatch(text, /正文不得进目录/)
      const delegated = await service('agents').create({ parentAgent: agent, sessionId: 'loader-memory-child', meta: { cwd: workspace }, agentOptions })
      try { await memoryText(delegated.agent, 0) } finally { await delegated.dispose() }
      // 本轮新增记忆：同一 agent 的快照不变；普通查询与记忆写入都不改目录
      entry(authorDir, '后来才写', { 名称: '后来才写', 描述: '会话中途新增', 类: '决策', 标签: '[测试书]', 来源: '对谈', 生成模块: '模型' }, 'x')
      index(authorDir, '作者记忆索引', [['冷开场', '作者偏好 {{冷开场}} 直接入戏'], ['后来才写', '会话中途新增']])
      const recorded = await withTurn(agent, () => execute(agent, 'novel_record_memory', { bookId: 'loader-book', 名称: '工具写入', 描述: '经工具写入的条目', 类: '决策', 标签: ['测试书'], 来源: '对谈', 正文: 'x' }))
      assert.equal(recorded.value.ok, true, JSON.stringify(recorded))
      const again = await memoryText(agent)
      assert.equal(again.rendered[0].text, text)
      assert.doesNotMatch(text, /后来才写|工具写入/)
      // 选书：结果附本书目录（选书时快照）；普通查询不附
      entry(path.join(book, '本书记忆'), '不写系统', { 名称: '不写系统', 类: '决策', 状态: '已确认', 来源: '定稿/卷01/0001-开篇.md', 裁决记录: '作者批准' }, '全书无系统面板。')
      index(path.join(book, '本书记忆'), '本书记忆索引', [['不写系统', '类：决策｜来源：定稿/卷01/0001-开篇.md']])
      const selected = await withTurn(agent, () => execute(agent, 'novel_select_book', { bookId: 'loader-book' }))
      assert.equal(selected.value.ok, true, JSON.stringify(selected))
      assert.match(selected.value.记忆目录, /【本书记忆目录】选书时/)
      assert.match(selected.value.记忆目录, /- 不写系统 — （缺描述）｜类：决策/)
      assert.ok(selected.value.记忆目录.includes(path.join(book, '本书记忆', '索引.md')))
      assert.doesNotMatch(selected.value.记忆目录, /全书无系统面板/)
      const status = await withTurn(agent, () => execute(agent, 'novel_get_story_status', { bookId: 'loader-book' }))
      assert.equal(status.value.ok, true)
      assert.equal(status.value.记忆目录, undefined)
      assert.equal((await memoryText(agent)).rendered[0].text, text)
      // 新会话：重新取得初始目录，含中途新增的条目
      const fresh = await service('agents').create({ sessionId: 'loader-memory-fresh', meta: { cwd: workspace }, agentOptions })
      try {
        const freshText = (await memoryText(fresh.agent)).rendered[0].text
        assert.match(freshText, /- 后来才写 — 会话中途新增/)
        assert.match(freshText, /- 工具写入 — 经工具写入的条目/)
        assert.notEqual(freshText, text)
      } finally { await fresh.dispose() }
      report.memoryCatalog = { nativeMessage: true, literalBraces: true, snapshotFixedWithinAgent: true, delegatedCatalogAbsent: true, selectBookCatalog: true, statusWithoutCatalog: true, freshAgentRereads: true, initialCatalogChars: Array.from(text).length }
    } finally { await created.dispose(); releaseAdapter() }
  })
}
