import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

async function checkSchemaGreeting({ workspace, main, service, host }) {
  const { LlmAdapter, createUserMessage } = await import(host ? pathToFileURL(host.entry('@deepseek-ai/dsh-llm')).href : '@deepseek-ai/dsh-llm')
  const { assertObjectJsonSchema, jsonSchemaToTs } = await import(host ? pathToFileURL(host.entry('@deepseek-ai/dsh-tools')).href : '@deepseek-ai/dsh-tools')
  let requests = 0
  class SchemaAdapter extends LlmAdapter {
    async *stream(options) {
      requests++
      assert.ok(JSON.stringify(options.messages).includes('你好'))
      const tools = options.tools.filter(tool => tool.name.startsWith('novel_'))
      const references = tools.filter(tool => tool.name.startsWith('novel_reference_'))
      assert.deepEqual(references.map(tool => tool.name).sort(), ['novel_reference_analyze', 'novel_reference_query', 'novel_reference_report', 'novel_reference_source'])
      for (const tool of tools) assert.equal(tool.parameters.type, 'object', tool.name)
      for (const tool of references) {
        assertObjectJsonSchema(tool.parameters)
        assert.notEqual(jsonSchemaToTs(tool.parameters), 'unknown', tool.name)
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: '你好，工具参数校验通过。' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '你好，工具参数校验通过。' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const offAdapter = service('llm').registerAdapter(['reference-schema-fixture'], new SchemaAdapter())
  const handle = await service('agents').create({ sessionId: 'reference-schema-greeting', meta: { cwd: workspace }, agentOptions: { provider: 'reference-schema-fixture', model: 'fixture' } })
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error('schema greeting did not finish')) }, 10000)
      const off = handle.agent.ctx.on('agent/status', ({ agent, status }) => {
        if (agent !== handle.agent || status !== 'idle') return
        clearTimeout(timer); off(); resolve()
      })
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } }))
    })
    const events = handle.agent.session.snapshotEvents()
    assert.equal(events.filter(event => event.type === 'turn/end').at(-1).data.reason.kind, 'completed')
    assert.equal(requests, 1)
    assert.ok(!events.some(event => event.type === 'tool/call'))
  } finally {
    await handle.dispose()
    if (typeof offAdapter === 'function') offAdapter()
  }
}

export async function checkReferences({ workspace, main, service, execute, check, host }) {
  await check('参考小说真实文件服务、配置模型与私有原文边界', async () => {
    await checkSchemaGreeting({ workspace, main, service, host })
    const { LlmAdapter } = await import(host ? pathToFileURL(host.entry('@deepseek-ai/dsh-llm')).href : '@deepseek-ai/dsh-llm')
    let calls = 0
    class Adapter extends LlmAdapter {
      providerInfo(id) { return { id, name: '参考库测试服务' } }
      async *stream(options) {
        calls++
        assert.equal(options.messages.length, 1)
        assert.equal(options.tools, undefined)
        assert.equal(options.sessionId, undefined)
        assert.equal(options.provider, 'reference-fixture')
        const input = JSON.parse(options.messages[0].content[0].text)
        assert.ok(input.text.includes('原文私密标记'))
        const text = JSON.stringify({ evidence: [], observations: [], hypotheses: [], openQuestions: ['这里只验证宿主接线，不代表分析质量。'], mechanisms: [] })
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    const off = service('llm').registerAdapter(['reference-fixture'], new Adapter())
    const filename = path.join(workspace, '自造参考.txt')
    const original = '第一章 测试\n原文私密标记，只由本测试构造。'
    fs.writeFileSync(filename, original)
    const previous = main.session.requestHeader()
    main.session.append('request/header', { header: { config: { provider: 'reference-fixture', model: 'fixture' } }, reason: 'initial' })
    const results = []
    const call = async (name, args) => {
      const result = await execute(main, name, args)
      assert.equal(result.isError, false, JSON.stringify(result))
      results.push(result.value)
      return result.value
    }
    try {
      const preview = await call('novel_reference_source', { action: 'preview', filename })
      assert.equal(preview.ok, true, JSON.stringify(preview))
      const imported = await call('novel_reference_source', { action: 'import', filename, expectedSourceHash: preview.sourceHash,
        metadata: { title: '自造参考', author: '测试', edition: '1', acquiredFrom: '自行编写', allowedUses: '测试', basis: '自行编写', basisKind: 'user-declaration' } })
      assert.equal(imported.ok, true, JSON.stringify(imported))
      const plan = await call('novel_reference_analyze', { action: 'plan', sourceId: imported.sourceId, ranges: 'all' })
      assert.equal(plan.ok, true, JSON.stringify(plan))
      const args = { action: 'run', sourceId: imported.sourceId, planId: plan.planId }
      assert.equal((await call('novel_reference_analyze', args)).code, 'processing-required')
      assert.equal(calls, 0)
      assert.equal((await call('novel_reference_analyze', { ...args, allowProcessing: true })).fullBookEligible, true)
      await call('novel_reference_analyze', args)
      assert.equal(calls, 1)
      assert.equal(JSON.stringify(results).includes('原文私密标记'), false)
      const machine = path.join(workspace, '书房/参考书', imported.sourceId, '.analysis/manifest.json')
      const read = await execute(main, 'read', { file_path: machine })
      assert.equal(read.isError, true)
      assert.equal((await execute(main, 'read', { file_path: path.relative(workspace, machine) })).isError, true)
      const report = await call('novel_reference_report', { action: 'build', sourceId: imported.sourceId })
      assert.equal(report.fullBookComplete, true)
      fs.writeFileSync(filename, original.replace('私密', '变化'))
      const changed = await call('novel_reference_source', { action: 'check', sourceId: imported.sourceId })
      assert.equal(changed.changed, true)
      assert.equal((await call('novel_reference_analyze', args)).ok, false)
      assert.equal(calls, 1)
      fs.writeFileSync(filename, original)
      await call('novel_reference_source', { action: 'delete', sourceId: imported.sourceId })
      assert.equal(fs.readFileSync(filename, 'utf8'), original)
      assert.equal(fs.existsSync(path.dirname(path.dirname(machine))), false)
    } finally {
      if (typeof off === 'function') off()
      if (previous) main.session.append('request/header', { header: previous, reason: 'change' })
    }
  })
}
