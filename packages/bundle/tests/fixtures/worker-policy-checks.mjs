import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPresetAgent, resumePresetAgent } from './preset-agents.mjs'

const labels = { drafting: '正文起草', polish: '润色', revision: '改稿', review: '审读', settle: '沉淀对账' }
export async function checkWorkerPolicy({ root, book, workspace, ctx, service, check, report, host, execute, toggle, settingsProfile, toolCatalog }) {
  const { LlmAdapter } = await import(host === undefined ? '@deepseek-ai/dsh-llm' : pathToFileURL(host.entry('@deepseek-ai/dsh-llm')).href)
  const { WorkflowObserver, observeWorkflow } = await import(pathToFileURL(path.join(root, 'workflow-observer.mjs')).href)
  const workflow = new WorkflowObserver()
  observeWorkflow(ctx, workflow)
  const cases = new Map()
  const parentNotices = new Map()
  let serial = 0
  let shells = 0
  const offShell = service('tools').register({ name: 'pwsh', description: 'Safe fixture, no real shell',
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: () => { shells++; return 'fixture shell'; } })
  const call = (name, args) => [{ type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: 'worker-call', name, argumentsDelta: JSON.stringify(args) },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'worker-call', name, arguments: JSON.stringify(args) } },
    { type: 'finish', reason: { kind: 'tool-calls' } }]
  const done = [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: '完成' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '完成' } }, { type: 'finish', reason: { kind: 'stop' } }]
  const readOnly = role => role && role !== 'drafting' && role !== 'polish'
  const textOf = message => message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
  const verify = (options, test) => {
    const system = options.messages.filter(message => message.role === 'system').map(textOf).join('\n')
    assert.equal(system.includes('写作子代理执行规约'), test.role !== undefined)
    for (const [role, label] of Object.entries(labels)) assert.equal(system.includes(`【当前角色：${label}】`), test.role === role)
    assert.equal(system.includes('最多一次篇幅调整'), test.role === 'drafting')
    if (test.role) {
      assert.ok(system.includes('字数未核验'))
      for (const name of ['pwsh', 'bash', 'run_code', 'subagent']) assert.equal(options.tools.some(tool => tool.name === name), false)
      assert.equal(options.tools.some(tool => tool.name === 'write'), !readOnly(test.role))
      assert.equal(options.tools.some(tool => tool.name === 'edit'), !readOnly(test.role))
    } else assert.ok(options.tools.some(tool => tool.name === 'pwsh'))
  }
  class Adapter extends LlmAdapter {
    async * stream(options) {
      if (options.sessionId === 'worker-main') {
        for (const message of options.messages) {
          if (message.source?.kind === 'subagent-settled') parentNotices.set(message.source.senderSessionId, textOf(message))
        }
        yield* done
        return
      }
      const task = options.messages.find(message => message.role === 'user' && /\[probe:/.test(textOf(message)))
      const key = /\[probe:([^\]]+)\]/.exec(textOf(task))[1]
      const test = cases.get(key)
      assert.ok(test)
      if (test.role) assert.ok(textOf(task).includes('<!-- scriptor-assignment:v1:{"bookId":"worker-fixture-book","chapter":3} -->'))
      verify(options, test)
      test.requests++
      test.childId = options.sessionId
      if (test.requests === 1) {
        test.entered.resolve()
        if (test.hold) await test.release.promise
        if (test.fail) throw new Error('controlled worker failure')
        for (const chunk of test.role ? call('write', { file_path: test.file, content: '---\n角色: 草稿\n版本: 1\n---\n# 试稿\n甲乙。' }) : call('pwsh', {})) yield chunk
      } else {
        const result = options.messages.filter(message => message.role === 'tool').at(-1)
        assert.equal(result.isError, Boolean(readOnly(test.role)))
        if (test.role && !readOnly(test.role)) assert.ok(options.messages.some(message => message.source?.kind === 'plugin:webnovel-draft-length'))
        for (const chunk of done) yield chunk
      }
    }
  }
  service('llm').registerAdapter(['worker-fixture'], new Adapter())
  const main = await createPresetAgent(service('agents'), { sessionId: 'worker-main', meta: { cwd: workspace },
    agentOptions: { provider: 'worker-fixture', model: 'fixture' } })
  const workflowLog = []
  const workflowAgent = { get status() { return main.agent.status }, session: { header: main.agent.session.header,
    get seq() { return workflowLog.length }, eventAt: index => workflowLog[index] } }
  const novelNames = () => service('tools').schemas(main.agent).map(tool => tool.name).filter(name => name.startsWith('novel_')).sort()
  const startCase = async (role, options = {}) => {
    const key = String(++serial)
    const test = { role, requests: 0, file: path.join(book, `草稿区/草稿/卷01-角色${key}/稿1.md`),
      entered: Promise.withResolvers(), release: Promise.withResolvers(), ...options }
    cases.set(key, test)
    const args = {
      ...(role ? { role, bookId: 'worker-fixture-book', chapter: 3 } : {}), description: '起草润色审读研究（标题不决定权限）',
      prompt: `[probe:${key}] 检查工具可用性并返回。`, ...(options.preset ? { agent_preset: options.preset } : {}),
    }
    // Explicit parent call records; activation events themselves come from the real DSH runtime.
    test.callId = `workflow-${key}`
    workflowLog.push({ type: 'tool/call', time: Date.now(), data: { callId: test.callId, name: role ? 'novel_delegate' : 'subagent', arguments: JSON.stringify(args) } })
    const result = await execute(main.agent, role ? 'novel_delegate' : 'subagent', args)
    workflowLog.push({ type: 'tool/result', time: Date.now(), data: { message: { role: 'tool', toolCallId: test.callId, content: [{ type: 'text', text: JSON.stringify(result.value) }] } } })
    assert.equal(result.isError, false, JSON.stringify(result))
    assert.equal(result.value.kind, 'activation')
    test.childId = result.value.subagentId
    assert.equal(typeof test.childId, 'string')
    return test
  }
  const finishCase = async test => {
    await service('subagents').waitForChildren(main.agent)
    await main.agent.whenIdle()
    assert.equal(test.requests, test.fail ? 1 : 2)
    assert.ok(parentNotices.has(test.childId), 'the parent must receive the final completion notice')
    if (test.fail) assert.match(parentNotices.get(test.childId), /failed before it finished/)
    else assert.match(parentNotices.get(test.childId), /完成/)
    assert.equal(service('agents').get(test.childId), undefined, 'settled children release their live Agent')
    const { role } = test
    if (role) assert.equal(workflow.read(workflowAgent, 'worker-fixture-book').calls.find(call => call.id === test.callId)?.state, test.fail ? 'error' : 'success')
    assert.equal(fs.existsSync(test.file), Boolean(role && !readOnly(role)))
    return test
  }
  const runCase = async (role, options) => finishCase(await startCase(role, options))
  try {
    await check('原生委派按显式角色隔离规则与执行权限', async () => {
      assert.deepEqual(novelNames(), [...toolCatalog.production].sort())
      assert.equal(toolCatalog.business.length, 36)
      assert.equal(toolCatalog.conditional.length, 1)
      assert.equal(new Set(toolCatalog.production).size, 37)
      for (const role of Object.keys(labels)) await runCase(role)
      await runCase(undefined)
      // Same parent, overlapping starts: one role must not leak into its sibling.
      await Promise.all([runCase('drafting'), runCase(undefined), runCase('review')])
      assert.equal(shells, 2)
      await runCase('drafting', { preset: 'standard' })
      await runCase('review', { preset: 'standard' })
      await runCase(undefined, { preset: 'standard' })
      await runCase('review', { fail: true })
      const cancelled = await startCase('drafting', { hold: true })
      await cancelled.entered.promise
      assert.equal(workflow.read(workflowAgent, 'worker-fixture-book').calls.find(call => call.id === cancelled.callId)?.state, 'running')
      service('subagents').interrupt(cancelled.childId, { kind: 'ancestor', agent: main.agent })
      cancelled.release.resolve()
      await service('subagents').waitForChildren(main.agent)
      await main.agent.whenIdle()
      assert.equal(workflow.read(workflowAgent, 'worker-fixture-book').calls.find(call => call.id === cancelled.callId)?.state, 'stopped')
      assert.equal(fs.existsSync(cancelled.file), false)
      assert.match(parentNotices.get(cancelled.childId), /was stopped before it finished/)
      assert.equal((await execute(main.agent, 'pwsh', {})).isError, false)
      const native = service('tools').get('subagent', main.agent)
      const writing = service('tools').get('novel_delegate', main.agent)
      for (const key of Object.keys(native.parameters.properties)) assert.deepEqual(writing.parameters.properties[key], native.parameters.properties[key])
      assert.equal(service('tools').schemas(main.agent).filter(tool => tool.name === 'subagent').length, 1)
      assert.equal((await execute(main.agent, 'novel_delegate', { role: 'research', prompt: '不可创建', description: '非法角色' })).isError, true)
      report.workerPolicy = { explicitRoles: 5, ordinaryUnchanged: true, concurrentSiblings: true, nativeSchemaPreserved: true,
        independentPreset: true, explicitBookChapterPreserved: true, nativeWorkflowLifecycle: true, activationThenCompletion: true, failedCompletion: true, cancelledWithoutWrite: true,
        tools: { business: toolCatalog.business.length, conditional: toolCatalog.conditional.length, registered: novelNames().length } }
    })
    await check('委派工具随原生入口和插件装卸且角色可恢复', async () => {
      await toggle('subagent-tool', true)
      assert.equal(service('tools').get('novel_delegate', main.agent), undefined)
      assert.deepEqual(novelNames(), [...toolCatalog.business].sort())
      await toggle('subagent-tool', false)
      assert.ok(service('tools').get('novel_delegate', main.agent))
      assert.deepEqual(novelNames(), [...toolCatalog.production].sort())
      const test = await startCase('review', { hold: true, preset: 'standard' })
      await test.entered.promise
      assert.equal(test.requests, 1)
      assert.equal(parentNotices.has(test.childId), false, 'startup is not completion')
      const child = service('agents').get(test.childId)
      assert.ok(child)
      await toggle('webnovel', true)
      assert.deepEqual(novelNames(), [])
      const callsBeforeDisable = shells
      await assert.rejects(execute(child, 'pwsh', {}), error => error.code === 'TOOL_EXECUTOR_UNAVAILABLE')
      await assert.rejects(service('systemPrompt').assemble({ agent: child, scope: child }), error => error.code === 'TOOL_EXECUTOR_UNAVAILABLE')
      assert.equal(shells, callsBeforeDisable)
      await toggle('webnovel', false)
      assert.deepEqual(novelNames(), [...toolCatalog.production].sort())
      assert.equal((await execute(child, 'pwsh', {})).isError, true)
      assert.equal((await execute(child, 'write', { file_path: test.file, content: '不应写入' })).isError, true)
      assert.equal((await execute(child, 'read', { file_path: path.join(book, '作品契约/契约.md') })).isError, false)
      const restoredPolicy = await service('systemPrompt').assemble({ agent: child, scope: child })
      assert.ok(restoredPolicy.sections.find(section => section.name === 'webnovel.worker-policy')?.text.includes('【当前角色：审读】'))
      test.release.resolve()
      await finishCase(test)
      await service('sessionPersistence').flush()
      await ctx.fiber.dispose()
      const restarted = await settingsProfile.start('worker-restart')
      try {
        const parent = await resumePresetAgent(restarted.get('agents'), { resumeSessionId: 'worker-main' })
        const saved = await restarted.get('agents').resume({ parentAgent: parent.agent, resumeSessionId: test.childId,
          setup: async scope => { await scope.get('agentPresets').mount(scope, 'standard') },
        })
        const assembly = await restarted.get('systemPrompt').assemble({ agent: saved.agent, scope: saved.agent })
        const section = assembly.sections.find(item => item.name === 'webnovel.worker-policy')
        assert.ok(section.text.includes('【当前角色：审读】'))
        assert.equal(section.text.includes('最多一次篇幅调整'), false)
        assert.equal(restarted.get('tools').schemas(saved.agent).some(tool => tool.name === 'write'), false)
        report.workerPolicy.restoredRole = true
      } finally { await restarted.fiber.dispose() }
    })
  } finally { offShell() }
}
