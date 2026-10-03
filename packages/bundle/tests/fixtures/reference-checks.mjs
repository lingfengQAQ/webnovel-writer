import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export async function checkReferences({ workspace, main, service, execute, check, host }) {
  await check('参考小说真实文件服务、配置模型与私有原文边界', async () => {
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
