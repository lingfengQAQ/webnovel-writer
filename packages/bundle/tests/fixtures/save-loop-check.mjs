import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export async function checkSaveLoop({ root, book, workspace, ctx, service, git, check, report, host }) {
  const { LlmAdapter, createUserMessage } = await import(host === undefined ? '@deepseek-ai/dsh-llm' : pathToFileURL(host.entry('@deepseek-ai/dsh-llm')).href)
  await check('保存后的重复空操作终止且下一轮可修改', async () => {
    await service('workspaceRegistry').create(workspace)
    const core = await import(pathToFileURL(path.join(root, 'native-write-core.mjs')).href)
    const relative = '作品契约/契约.md'
    const partName = '创作禁区与不可妥协项'
    fs.writeFileSync(path.join(book, relative), core.contractTemplate({ [partName]: { state: '已确认', body: '不扩展支线' } }, { 书id: 'loader-book', 版本: 1 }))
    git('add', relative)
    git('commit', '--quiet', '-m', 'design: save loop baseline')
    const study = new core.StudyService(workspace)
    const ref = { space: 'book:loader-book', path: relative }
    const original = study.read(ref)
    const saved = study.save(ref, original.hash, original.body.replace('不扩展支线', '不扩展支线。'), { sessionId: 'save-loop' }, 'save-loop-punctuation')
    assert.equal(saved.commit, 'saved')
    const savedHead = git('rev-parse', 'HEAD')
    const call = (id, name, args) => {
      const argumentsJson = JSON.stringify(args)
      return [
        { type: 'block-start', index: 0, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsJson },
        { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsJson } },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ]
    }
    const done = [
      { type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: '修改完成。' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '修改完成。' } }, { type: 'finish', reason: { kind: 'stop' } },
    ]
    let mode = 'repeat'
    let turnRequests = 0
    let requests = 0
    let substantiveNotificationSeen = false
    const downstream = '大纲/故事骨架.md'
    class RepeatingAdapter extends LlmAdapter {
      async * stream(options) {
        requests++
        turnRequests++
        assert.ok(turnRequests <= 5, 'repeated design operation did not conclude the real turn')
        if (mode === 'inspect') {
          const input = JSON.stringify(options.messages)
          substantiveNotificationSeen ||= input.includes('不再以复仇为目标') && input.includes('说明影响与待作者决定项')
          const text = '已核对契约和故事骨架：主角不再以复仇为目标，旧骨架仍包含复仇安排，需作者决定调整范围；未修改下游。'
          const chunks = turnRequests === 1 ? call(`inspect-read-${requests}`, 'read', { file_path: path.join(book, relative) })
            : turnRequests === 2 ? call(`inspect-downstream-${requests}`, 'read', { file_path: path.join(book, downstream) })
            : [
                { type: 'block-start', index: 0, blockType: 'text' },
                { type: 'text-delta', index: 0, text },
                { type: 'block-end', index: 0, block: { type: 'text', text } },
                { type: 'finish', reason: { kind: 'stop' } },
              ]
          for (const chunk of chunks) yield chunk
          return
        }
        const chunks = turnRequests === 1 ? call(`read-${requests}`, 'read', { file_path: path.join(book, relative) })
          : mode === 'continue' && turnRequests > 2 ? done
          : call(`design-${requests}`, 'novel_update_contract', {
            bookId: 'loader-book', partName, state: '已确认',
            content: mode === 'repeat' ? '不扩展支线。' : '不扩展支线，也不改变主角原则。',
            summary: `不同摘要 ${requests}`,
          })
        for (const chunk of chunks) yield chunk
      }
    }
    service('llm').registerAdapter(['save-loop-fixture'], new RepeatingAdapter())
    const handle = await service('agents').create({ sessionId: 'save-loop', meta: { cwd: workspace }, agentOptions: { provider: 'save-loop-fixture', model: 'fixture' } })
    try {
      const complete = async message => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { off(); reject(new Error('save loop turn did not reach idle')) }, 15000)
        const off = ctx.on('agent/status', ({ agent, status }) => {
          if (agent !== handle.agent || status !== 'idle') return
          clearTimeout(timer); off(); resolve()
        })
        handle.agent.followup(message)
      })
      await complete(createUserMessage({ content: [{ type: 'text', text: core.savedMessage(saved) }], source: { kind: 'plugin:webnovel' } }))
      const results = handle.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
      assert.equal(turnRequests, 3, 'one native read and two unchanged design calls must terminate the loop: ' + JSON.stringify(results.map(event => event.data.message)))
      assert.equal(git('rev-parse', 'HEAD'), savedHead, 'no extra commit after an author save')
      assert.equal(study.read(ref).body, saved.document.body)
      const events = () => handle.agent.session.snapshotEvents()
      const firstResults = events().filter(event => event.type === 'tool/result').map(event => JSON.stringify(event.data.message))
      assert.ok(firstResults.some(result => result.includes('本轮已停止')))
      assert.ok(!events().some(event => event.type === 'tool/call' && event.data.name === 'novel_roll_window'))
      mode = 'continue'; turnRequests = 0
      await complete(createUserMessage({ content: [{ type: 'text', text: '再补一条：不改变主角原则，确认更新。' }], source: { kind: 'user' } }))
      assert.equal(turnRequests, 3, 'a new user turn can read, change the design and report completion')
      assert.notEqual(git('rev-parse', 'HEAD'), savedHead)
      assert.ok(study.read(ref).body.includes('不改变主角原则'))
      report.saveLoop = { repeatedTurnRequests: 3, totalRequests: requests, noExtraCommit: true, nextTurnChanged: true, model: 'scripted protocol fixture' }
      // Exercise substantive author saves separately from the no-op stop condition.
      fs.mkdirSync(path.dirname(path.join(book, downstream)), { recursive: true })
      const beforeDownstream = core.serializeDocument({ 来源引用: [relative + '@1'] }, '# 故事骨架\n主角计划复仇。\n')
      fs.writeFileSync(path.join(book, downstream), beforeDownstream)
      git('add', downstream); git('commit', '--quiet', '-m', 'design: downstream fixture')
      const current = study.read(ref)
      const substantive = study.save(ref, current.hash, current.body.replace('不扩展支线，也不改变主角原则。', '主角不再以复仇为目标。'), { sessionId: 'save-loop' }, 'save-substantive')
      assert.equal(substantive.commit, 'saved')
      const impact = core.analyzeImpact(book, relative)
      assert.ok(impact.references.some(item => item.relPath === downstream), 'actual source references identify the affected design')
      const inspectionHead = git('rev-parse', 'HEAD')
      const beforeSeq = handle.agent.session.seq
      mode = 'inspect'; turnRequests = 0
      await complete(createUserMessage({ content: [{ type: 'text', text: core.savedMessage(substantive) }], source: { kind: 'plugin:webnovel' } }))
      const inspectionEvents = events().slice(beforeSeq)
      const reads = inspectionEvents.filter(event => event.type === 'tool/call')
      assert.equal(turnRequests, 3)
      assert.deepEqual(reads.map(event => event.data.name), ['read', 'read'])
      assert.equal(inspectionEvents.filter(event => event.type === 'tool/result').length, 2)
      assert.ok(!inspectionEvents.some(event => event.type === 'tool/result' && event.data.message.isError))
      assert.ok(substantiveNotificationSeen, 'substantive difference and reporting instructions reach the model')
      assert.equal(git('rev-parse', 'HEAD'), inspectionHead)
      assert.equal(study.read(ref).body, substantive.document.body)
      assert.equal(fs.readFileSync(path.join(book, downstream), 'utf8'), beforeDownstream)
      report.saveInspection = { notificationReceived: true, nativeReadCalls: 2, impactReferences: impact.references.map(item => item.relPath), noAutomaticWrites: true, model: 'scripted protocol fixture; not a model-compliance measurement' }
    } finally { await handle.dispose() }
  })
}
