/** Isolated browser acceptance fixture. Never loaded by the production profile. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import { attachIndexFixture } from './index-browser-extension.mjs'
import { seedGraphFixture } from './graph-data.mjs'

export const name = 'webnovel-browser-acceptance'
export const inject = ['agents', 'agentLoop', 'sessionPersistence', 'workspaceRegistry', 'llm', 'sessionController', 'webServer', ...(process.env.WEBNOVEL_INDEX_CHECK ? ['embeddings', 'settings', 'credentials'] : [])]

export async function apply(ctx) {
  const root = process.env.WEBNOVEL_BROWSER_WORKSPACE
  const reportPath = process.env.WEBNOVEL_BROWSER_REPORT
  if (!root || !path.isAbsolute(root) || !reportPath) throw new Error('Missing isolated browser acceptance paths')
  const put = (relative, text) => {
    const target = path.join(root, relative)
    if (fs.existsSync(target)) return
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text)
  }
  const longText = '林舟在渡口停下脚步。潮声越过石阶，信封上的字迹依然清晰。\n\n'.repeat(35)
  for (const [book, id] of [['验收作品甲', 'acceptance-a'], ['验收作品乙', 'acceptance-b']]) {
    put(`${book}/作品契约/契约.md`, `---\n书id: ${id}\n版本: 1\n---\n# ${book}\n\n浏览器验收临时作品。\n`)
    put(`${book}/大纲/故事骨架.md`, '---\n版本: 1\n---\n# 故事骨架\n\n一封来信改变了渡口的日常。\n')
    put(`${book}/草稿区/草稿/卷01-来信/稿1.md`, `---\n身份:\n  卷: 1\n  章: 1\n  章名: 来信\n版本: 1\n父版本: null\n角色: 待审稿\n选定: true\n---\n# 来信\n\n${longText}`)
    put(`${book}/定稿/卷01/0002-归航.md`, '---\n身份:\n  卷: 1\n  章: 2\n  章名: 归航\n角色: 已定稿\n版本: 1\n---\n# 归航\n\n已定稿的原文，只读验证。\n')
  }
  seedGraphFixture(path.join(root, '验收作品甲'))
  put('书房/知识库/写作笔记.md', '# 写作笔记\n\n共享资料的原始内容。\n')
  put('书房/作者记忆/偏好.md', '# 作者偏好\n\n保留作者自己的句子。\n')
  const report = { requests: 0, savesReceived: 0, indexErrorsReceived: 0, complete: 0, customEvents: 0 }
  const persist = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  // Settings writes await Loader settlement in DSH 0.1.7. Do not await them from
  // this plugin's apply: that would keep the very Loader settlement they need pending.
  const indexReady = (process.env.WEBNOVEL_INDEX_CHECK ? attachIndexFixture(ctx, root, report, persist) : Promise.resolve())
    .then(() => true).catch(error => { report.fixtureError = String(error); persist(); return false })
  class AcceptanceAdapter extends LlmAdapter {
    providerInfo(provider) { return { id: provider, name: '本地验收提供方' } }
    async listModels() { return [{ id: 'fixture', name: '本地验收' }] }
    async * stream(options) {
      report.requests++
      if (options.system?.includes('你为小说原文识别连续场景')) {
        const paragraphs = JSON.parse(options.messages[0].content[0].text)
        const text = JSON.stringify({ ends: [paragraphs.length] })
        report.sceneRequests = (report.sceneRequests ?? 0) + 1
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        persist()
        return
      }
      const messages = JSON.stringify(options.messages)
      if (messages.includes('作者通过书房编辑器保存了文档')) report.savesReceived++
      if (messages.includes('后台检索索引需要处理')) report.indexErrorsReceived++
      const document = new URL(`http://127.0.0.1:${ctx.webServer.port}/`)
      document.searchParams.set('webnovel', JSON.stringify({ sessionId: 'webnovel-browser-acceptance', ref: { space: 'book:acceptance-a', path: '草稿区/草稿/卷01-来信/稿1.md' } }))
      const text = '浏览器验收会话。\n\n[打开原文](<' + document + '>)\n\n保存通知已进入本次原生对话。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      persist()
    }
  }
  ctx.llm.registerAdapter(['webnovel-acceptance'], new AcceptanceAdapter())
  const workspace = await ctx.workspaceRegistry.create(root, 'S5 临时验收书房')
  const sessionId = 'webnovel-browser-acceptance'
  const exists = (await ctx.sessionPersistence.list()).some(snapshot => snapshot.header.id === sessionId)
  const options = { provider: 'webnovel-acceptance', model: 'fixture' }
  const handle = exists ? await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions: options })
    : await ctx.agents.create({ sessionId, meta: { cwd: root, title: 'S5 书房验收' }, agentOptions: options })
  const off = ctx.on('agent/status', ({ agent, status }) => {
    if (agent !== handle.agent || status !== 'idle') return
    report.complete++
    report.customEvents = Array.from({ length: agent.session.seq }, (_, index) => agent.session.eventAt(index)).filter(event => event.type.startsWith('novel/')).length
    persist()
  })
  if (!exists) await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { done(); reject(new Error('Acceptance session did not finish')) }, 10000)
    const done = ctx.on('agent/status', ({ agent, status }) => {
      if (agent !== handle.agent || status !== 'idle') return
      clearTimeout(timer); done(); resolve()
    })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '打开验收作品，验证文档链接。' }], source: { kind: 'user' } }))
  })
  await ctx.sessionPersistence.flush()
  await workspace.attachSession(sessionId)
  await ctx.sessionController.rename({ sessionId, title: process.env.WEBNOVEL_INDEX_CHECK ? 'S6 后台索引验收' : 'S5 书房验收' })
  const secondRoot = path.join(root, '另一工作范围')
  fs.mkdirSync(secondRoot, { recursive: true })
  const secondWorkspace = await ctx.workspaceRegistry.create(secondRoot, 'S5 空工作范围')
  const secondId = 'webnovel-browser-second'
  const secondExists = (await ctx.sessionPersistence.list()).some(snapshot => snapshot.header.id === secondId)
  const second = secondExists ? await ctx.agents.resume({ resumeSessionId: secondId, agentOptions: options })
    : await ctx.agents.create({ sessionId: secondId, meta: { cwd: secondRoot, title: 'S5 会话隔离验收' }, agentOptions: options })
  // DSH 0.1.7 restores the most recent workspace on load and ADOPTS an empty-log
  // session in it as its blank "新会话", which displaces the fixture's title and
  // lets the probe's named lookup find nothing. One real turn makes this session
  // non-blank, so the title it was renamed to below is what the list renders.
  if (!secondExists) await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { done(); reject(new Error('Second acceptance session did not finish')) }, 10000)
    const done = ctx.on('agent/status', ({ agent, status }) => {
      if (agent !== second.agent || status !== 'idle') return
      clearTimeout(timer); done(); resolve()
    })
    second.agent.followup(createUserMessage({ content: [{ type: 'text', text: '确认这个工作范围是空的。' }], source: { kind: 'user' } }))
  })
  await ctx.sessionPersistence.flush()
  await secondWorkspace.attachSession(secondId)
  await ctx.sessionController.rename({ sessionId: secondId, title: 'S5 会话隔离验收' })
  persist()
  void indexReady.then(ready => { report.ready = ready; persist() })
  ctx.on('dispose', () => { off(); return Promise.all([handle.dispose(), second.dispose()]) })
}
