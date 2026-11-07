import { createPresetAgent, resumePresetAgent } from './preset-agents.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SOURCE = 'plugin:webnovel-draft-length'
const feedback = result => (result.additionalContexts ?? []).filter(message => message.source.kind === SOURCE)
const data = message => JSON.parse(message.content[0].text.split('\n')[1])

export async function checkDraftLength({ root, book, workspace, ctx, service, check, report, host, execute, toggle, settingsProfile }) {
  const core = await import(pathToFileURL(path.join(root, 'native-write-core.mjs')).href)
  const { LlmAdapter, createUserMessage } = await import(host === undefined ? '@deepseek-ai/dsh-llm' : pathToFileURL(host.entry('@deepseek-ai/dsh-llm')).href)
  core.seedMinDesign(book)
  fs.writeFileSync(path.join(book, '作品契约/契约.md'), core.contractTemplate({ 阅读体验与情绪承诺: {
    state: '已确认', body: '### 章节篇幅\n- 目标汉字数: 4\n- 下限汉字数: 3\n- 上限汉字数: 6',
  } }, { 书id: 'loader-book' }))
  const key = { 卷: 1, 章: 2, 章名: '计数' }
  const directory = path.join(book, '草稿区/草稿/卷01-计数')
  const draft = path.join(directory, '稿1.md')
  const partial = path.join(directory, '稿1.起草中.txt')
  const prose = '# 夜渡\n\n甲𠮷A1。\n\n## 草稿候选事实\n- 事实：候选不计。'
  const text = core.serializeDocument({ 身份: key, 角色: '待审稿', 版本: 1 }, prose)
  fs.mkdirSync(path.join(book, '大纲/卷规划/卷01/章细纲'), { recursive: true })
  fs.writeFileSync(path.join(book, '大纲/卷规划/卷01/章细纲/0002-计数.md'), core.serializeDocument({ 状态: '已确认', 版本: 1 }, '# 章细纲\n## 定位段\n### 章节功能\n完成渡河。'))
  const main = await createPresetAgent(service('agents'), { sessionId: 'length-main', meta: { cwd: workspace } })
  let child = await createPresetAgent(main.agent.ctx.get('agents'), { parentAgent: main.agent, sessionId: 'length-child',
    meta: { cwd: workspace, origin: 'subagent' }, agentOptions: { provider: 'length-fixture', model: 'fixture' } })
  const call = (name, args) => {
    const argumentsJson = JSON.stringify(args)
    return [{ type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'length-call', name, argumentsDelta: argumentsJson },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'length-call', name, arguments: argumentsJson } },
      { type: 'finish', reason: { kind: 'tool-calls' } }]
  }
  const done = [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: '完成' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '完成' } }, { type: 'finish', reason: { kind: 'stop' } }]
  let steps = []
  const seen = []
  class Adapter extends LlmAdapter {
    async * stream(options) {
      seen.push(options)
      const step = steps.shift()
      assert.ok(step, 'unexpected model request')
      for (const chunk of step(options)) yield chunk
    }
  }
  const adapter = new Adapter()
  service('llm').registerAdapter(['length-fixture'], adapter)
  const receipts = options => options.messages.filter(message => message.source?.kind === SOURCE)
  const complete = (context, agent, message) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('draft feedback turn timed out')) }, 10000)
    const off = context.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle') return
      clearTimeout(timer); off(); resolve()
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: message }], source: { kind: 'user' } }))
  })
  await check('字数回执进入实际写稿会话且审读复算一致', async () => {
    steps = [
      () => call('write', { file_path: partial, content: '甲𠮷' }),
      options => {
        assert.equal(receipts(options).length, 1)
        assert.equal(data(receipts(options)[0]).正文统计.汉字数, 2)
        assert.equal(core.scanChapter(book, key).有草稿, false)
        assert.equal(core.nextDraftFileName(book, key), '稿1.md')
        return call('write', { file_path: draft, content: text })
      },
      options => {
        assert.equal(receipts(options).length, 2)
        assert.equal(data(receipts(options).at(-1)).正文统计.汉字数, 4)
        return call('edit', { file_path: draft, old_string: '甲', new_string: '甲乙' })
      },
      options => {
        assert.equal(receipts(options).length, 3)
        assert.equal(data(receipts(options).at(-1)).正文统计.汉字数, 5)
        return done
      },
    ]
    await complete(ctx, child.agent, '按脚本保存并读取反馈。')
    assert.equal(steps.length, 0)
    const review = core.computeReview(book, key)
    assert.equal(review.正文统计.汉字数, 5)
    assert.equal(review.篇幅核对.结果, '范围内')
    assert.ok(main.agent.session.snapshotEvents().every(event => !JSON.stringify(event).includes(SOURCE)))
    report.draftLength = { modelRequests: 4, childReceipts: 3, reviewMatches: true, partialExcluded: true }
  })
  await check('原生失败取消版本保护与主会话回执', async () => {
    const rejected = await execute(main.agent, 'write', { file_path: draft, content: '无观察不可覆盖' })
    assert.equal(rejected.isError, true)
    assert.equal(feedback(rejected).length, 0)
    await execute(main.agent, 'read', { file_path: draft })
    fs.appendFileSync(draft, '\n外部修改')
    const stale = await execute(main.agent, 'edit', { file_path: draft, old_string: '甲乙', new_string: '甲' })
    assert.equal(stale.isError, true)
    assert.equal(feedback(stale).length, 0)
    const other = path.join(directory, '稿2.md')
    const aborted = await execute(main.agent, 'write', { file_path: other, content: '甲乙' }, AbortSignal.abort())
    assert.equal(aborted.isError, true)
    assert.equal(feedback(aborted).length, 0)
    assert.equal(fs.existsSync(other), false)
    const offBlock = main.agent.ctx.on('tools/post-execute', (exec, _result, next) => exec.name === 'write'
      ? { kind: 'block', feedback: [{ type: 'text', text: 'fixture block' }] } : next())
    try {
      const blocked = await execute(main.agent, 'write', { file_path: other, content: '甲乙' })
      assert.equal(blocked.isError, true)
      assert.equal(feedback(blocked).length, 0)
    } finally { offBlock() }
    const direct = await execute(main.agent, 'write', { file_path: path.join(directory, '稿3.md'), content: '甲乙𠮷' })
    assert.equal(direct.isError, false)
    assert.equal(direct.value.after, '甲乙𠮷')
    assert.ok(direct.content.length)
    assert.equal(feedback(direct).length, 1)
    assert.equal(data(feedback(direct)[0]).正文统计.汉字数, 3)
    const controller = new AbortController()
    const offAbort = main.agent.ctx.on('tools/post-execute', (exec, _result, next) => {
      if (exec.name === 'write') controller.abort()
      return next()
    })
    try {
      const during = await execute(main.agent, 'write', { file_path: path.join(directory, '稿4.md'), content: '甲乙' }, controller.signal)
      assert.equal(during.isError, true)
      assert.equal(feedback(during).length, 0)
    } finally { offAbort() }
  })
  await check('隔离草稿的原生写入被拒绝且没有成功字数回执', async () => {
    const q = path.join(book, '.webnovel/quarantine/length-fixture')
    fs.mkdirSync(q, { recursive: true })
    const qFile = path.join(q, 'quarantine.json')
    const original = fs.readFileSync(draft, 'utf8')
    try {
      for (const targets of [[path.relative(book, draft).replaceAll('\\', '/')], null]) {
        const record = JSON.stringify({ id: 'length-fixture', reason: 'fixture conflict', targets,
          location: '.webnovel/quarantine/length-fixture', quarantinedAt: '' })
        fs.writeFileSync(qFile, record)
        const read = await execute(main.agent, 'read', { file_path: draft })
        assert.equal(read.isError, false)
        for (const [name, args] of [
          ['write', { file_path: draft, content: '不能覆盖' }],
          ['edit', { file_path: draft, old_string: '甲乙', new_string: '不能覆盖' }],
          ...(targets === null ? [['write', { file_path: path.join(directory, '稿99.md'), content: '不能新建' }]] : []),
        ]) {
          const result = await execute(main.agent, name, args)
          assert.equal(result.isError, true)
          assert.ok(JSON.stringify(result).includes('隔离'))
          assert.equal(feedback(result).length, 0)
          assert.equal(fs.readFileSync(draft, 'utf8'), original)
          assert.equal(fs.readFileSync(qFile, 'utf8'), record)
        }
        assert.equal(fs.existsSync(path.join(directory, '稿99.md')), false)
      }
      report.draftLength.quarantine = true
    } finally {
      fs.unlinkSync(qFile)
      fs.rmdirSync(q)
    }
  })
  await check('PTC 原生派发只向下一请求附加一次回执', async () => {
    // Only the program execution substrate is a fixture. The tools/PTC bridge,
    // nested policies, deferred contexts and AgentLoop are the real host.
    ctx.provide('ptcRuntime', {
      language: 'typescript', isolation: 'in-process-fixture', executionInstructions: '',
      resolve: request => ({ ...request, cwd: request.cwd ?? workspace, timeoutMs: null }),
      async run(spec) {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
        try {
          const value = await new AsyncFunction(...spec.bindings.map(b => b.global), spec.program)(...spec.bindings.map(b => b.functions))
          return { logs: [], ...(value === undefined ? {} : { value }) }
        } catch (error) { return { logs: [], error: { kind: 'exception', message: String(error) } } }
      },
    })
    const { PtcExecutor } = await import(host ? pathToFileURL(host.entry('@deepseek-ai/dsh-tool-executor-ptc')).href : '@deepseek-ai/dsh-tool-executor-ptc')
    const mode = child.agent.ctx.inject(['tools', 'systemPrompt', 'ptcRuntime'], scope => {
      scope.tools.setExecutor(new PtcExecutor(scope))
    })
    try {
      const countBefore = receipts(seen.at(-1)).length
      const args = { file_path: path.join(directory, '稿5.md'), content: '甲乙𠮷' }
      steps = [() => call('run_code', { code: `await tools.write(${JSON.stringify(args)}); return "saved"`, description: '保存草稿' }),
        options => { assert.equal(receipts(options).length, countBefore + 1); return done }]
      await complete(ctx, child.agent, '通过 PTC 保存一次。')
      assert.equal(steps.length, 0)
      report.draftLength.ptcReceivedOnce = true
    } finally { await mode.dispose() }
  })
  await check('统计监听卸载重载工具重启与会话恢复', async () => {
    await toggle('webnovel', true)
    const noPlugin = await execute(main.agent, 'write', { file_path: path.join(directory, '稿6.md'), content: '甲乙' })
    assert.equal(feedback(noPlugin).length, 0)
    await toggle('webnovel', false)
    const restored = await execute(main.agent, 'write', { file_path: path.join(directory, '稿7.md'), content: '甲乙' })
    assert.equal(feedback(restored).length, 1)
    await child.dispose()
    child = await resumePresetAgent(service('agents'), { resumeSessionId: 'length-child', agentOptions: { provider: 'length-fixture', model: 'fixture' } })
    const resumed = await execute(child.agent, 'write', { file_path: path.join(directory, '稿8.md'), content: '甲乙' })
    assert.equal(feedback(resumed).length, 1)
    await toggle('tools', true)
    await toggle('tools', false)
    const fresh = await createPresetAgent(service('agents'), { sessionId: 'length-after-tools', meta: { cwd: workspace } })
    const afterTools = await execute(fresh.agent, 'write', { file_path: path.join(directory, '稿9.md'), content: '甲乙' })
    assert.equal(feedback(afterTools).length, 1)
    report.draftLength.lifecycle = true
    // Full Host restart verifies the new source in actual persisted history.
    await ctx.fiber.dispose()
    const restarted = await settingsProfile.start('length-restart')
    try {
      restarted.get('llm').registerAdapter(['length-fixture'], adapter)
      const saved = await resumePresetAgent(restarted.get('agents'), { resumeSessionId: 'length-child', agentOptions: { provider: 'length-fixture', model: 'fixture' } })
      steps = [options => { assert.equal(receipts(options).length, 4); return done }]
      await complete(restarted, saved.agent, '恢复后只核对历史。')
      assert.equal(steps.length, 0)
      report.draftLength.historyRestored = true
    } finally { await restarted.fiber.dispose() }
  })
}
