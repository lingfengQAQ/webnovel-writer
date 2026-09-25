import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Exercises the actual Loader, tool pipeline, observation policy, provider and Git. */
export async function checkNativeWrites({ root, book, main, ctx, service, execute, git, check, report }) {
  const core = await import(pathToFileURL(path.join(root, 'native-write-core.mjs')).href)
  const bookId = 'loader-book'
  const writes = []
  const offResult = ctx.on('tools/result', (exec, result) => {
    if (exec.name === 'write' && exec.parent !== undefined) writes.push({ exec, result })
  })
  const read = async (relative, agent = main) => {
    const result = await execute(agent, 'read', { file_path: path.join(book, relative) })
    assert.equal(result.isError, false, JSON.stringify(result))
  }
  const call = async (name, args, agent = main) => {
    const result = await execute(agent, name, { bookId, ...args })
    assert.equal(result.isError, false, JSON.stringify(result))
    return result.value
  }
  const text = relative => fs.readFileSync(path.join(book, relative), 'utf8')
  const put = (relative, content) => {
    fs.mkdirSync(path.dirname(path.join(book, relative)), { recursive: true })
    fs.writeFileSync(path.join(book, relative), content)
  }
  const head = () => git('rev-parse', 'HEAD').trim()
  const contract = { partName: '题材与读者定位', state: '已确认', content: '原生写入确认的新定位' }
  const contractPath = '作品契约/契约.md'
  const skeletonPath = '大纲/故事骨架.md'
  const outline = '# 卷纲\n\n## 叙事结构\n开篇\n\n## 弧线\n成长\n\n## 线索推进\n伏笔\n\n## 卷末兑现\n兑现\n'
  try {
    await check('七类设计文件复用原生观察与 design 提交', async () => {
      const cases = [
        ['novel_update_contract', contractPath, contract, core.contractTemplate({
          '叙事方式与文风基调': { state: '已确认', body: '作者保留的文风约定' },
        }, { 书id: bookId, 扩展字段: '原样保留' })],
        ['novel_update_skeleton', skeletonPath, { 正文: '# 新故事骨架\n' }, core.serializeDocument({ 版本: 2, 父版本: 1, 状态: '已确认', 扩展字段: '原样保留' }, '# 旧骨架')],
        ['novel_update_volume_layout', '大纲/分卷布局.md', { 正文: '# 新分卷布局\n' }, core.serializeDocument({ 版本: 2, 父版本: 1, 状态: '已确认', 扩展字段: '原样保留' }, '# 旧布局')],
        ['novel_confirm_volume_outline', '大纲/卷规划/卷01/卷纲.md', { 卷: 1, 目标: '卷纲', 正文: outline }, '# 旧卷纲\n'],
        ['novel_confirm_volume_outline', '大纲/卷规划/卷01/计划时间线.md', { 卷: 1, 目标: '计划时间线', 正文: '# 新计划时间线\n' }, '# 旧计划时间线\n'],
        ['novel_roll_window', '大纲/卷规划/卷01/近期窗口.md', { 卷: 1, action: '追加', 名称: '新窗口任务' }, '# 近期窗口\n\n- 旧任务 〔可进入〕\n'],
        ['novel_confirm_worldbook_entry', '世界书/人物档案/原生主角.md', { 模块: '人物档案', 名称: '原生主角', 类型: '人物', 性质: '计划', 状态: '已确认', 来源: '作者对谈', 正文: '# 新人物正文\n' }, '# 旧人物正文\n'],
      ]
      for (const [, relative, , content] of cases) put(relative, content)
      git('add', '--', ...cases.map(([, relative]) => relative))
      git('commit', '--quiet', '-m', 'design: native guard fixtures')
      for (const [name, relative, args] of cases) {
        const before = text(relative)
        const beforeHead = head()
        const count = writes.length
        const unread = await call(name, args)
        assert.equal(unread.ok, false, `${name}: ${JSON.stringify(unread)}`)
        assert.match(unread.reason, /has not been read/)
        assert.equal(text(relative), before)
        assert.equal(head(), beforeHead)
        await read(relative)
        const written = await call(name, args)
        assert.equal(written.ok, true, `${name}: ${JSON.stringify(written)}`)
        assert.equal(writes.length, count + 2, name)
        assert.equal(writes.at(-1).result.isError, false, name)
        assert.equal(writes.at(-1).exec.agent, main)
        assert.notEqual(head(), beforeHead)
        assert.match(git('log', '-1', '--format=%s'), /^design:/)
        assert.ok(git('-c', 'core.quotepath=false', 'show', '--name-only', '--format=', 'HEAD').includes(relative))
      }
      assert.match(text(contractPath), /作者保留的文风约定/)
      assert.match(text(contractPath), /书id: loader-book/)
      assert.match(text(contractPath), /扩展字段: 原样保留/)
      for (const relative of [skeletonPath, '大纲/分卷布局.md']) {
        assert.equal(core.parseDocument(text(relative)).data.fields.版本, 3)
        assert.equal(core.parseDocument(text(relative)).data.fields.父版本, 2)
        assert.match(text(relative), /扩展字段: 原样保留/)
      }
      report.nativeWriteGuards = { targets: cases.length, unreadRejected: cases.length, observedCommitted: cases.length }
      const audits = fs.readdirSync(path.join(book, '.webnovel/operations'))
        .map(file => JSON.parse(fs.readFileSync(path.join(book, '.webnovel/operations', file), 'utf8')))
      for (const [, relative] of cases) {
        assert.ok(audits.some(audit => audit.status === 'failed' && audit.targets.includes(relative)), relative)
      }
    })

    await check('作者保存和落盘前并发修改使旧观察失效', async () => {
      await read(contractPath)
      const before = text(contractPath)
      const saved = core.saveAuthorDocument(book, {
        path: contractPath, expectedHash: core.documentHash(before),
        body: core.parseDocument(before).data.body.replace('作者保留的文风约定', '作者刚保存的新文风约定'),
        operationId: 'native-guard-author-save', provenance: { sessionId: main.id, agentId: main.id, toolName: 'author-editor' },
      })
      assert.equal(saved.path, contractPath)
      assert.match(git('log', '-1', '--format=%s'), /^fix:/)
      const authorText = text(contractPath)
      const authorHead = head()
      const args = { ...contract, content: '作者保存后的新定位' }
      const stale = await call('novel_update_contract', args)
      assert.equal(stale.ok, false, JSON.stringify(stale))
      assert.match(stale.reason, /re-read the file/)
      assert.equal(text(contractPath), authorText)
      assert.equal(head(), authorHead)
      await read(contractPath)
      assert.equal((await call('novel_update_contract', args)).ok, true)
      assert.match(text(contractPath), /作者刚保存的新文风约定/)

      const beforeRace = head()
      let raced = false
      const offRace = ctx.on('tools/pre-execute', async (exec, next) => {
        if (!raced && exec.agent === main && exec.name === 'write' && exec.parent !== undefined) {
          raced = true
          fs.appendFileSync(path.join(book, contractPath), '\n作者在准备完成后追加的文字\n')
        }
        return next()
      })
      try {
        const conflict = await call('novel_update_contract', { ...args, content: '竞争写入不得落盘' })
        assert.equal(raced, true)
        assert.equal(conflict.ok, false, JSON.stringify(conflict))
        assert.match(conflict.reason, /re-read the file/)
        assert.match(text(contractPath), /作者在准备完成后追加的文字/)
        assert.doesNotMatch(text(contractPath), /竞争写入不得落盘/)
        assert.equal(head(), beforeRace)
      } finally { offRace() }
    })

    await check('读观察按会话隔离且普通嵌套调用不能绕过门禁', async () => {
      await read(contractPath)
      const independent = await service('agents').create({ sessionId: 'native-independent', meta: { cwd: path.dirname(book) } })
      const before = text(contractPath)
      const beforeHead = head()
      try {
        const unread = await call('novel_update_contract', contract, independent.agent)
        assert.equal(unread.ok, false, JSON.stringify(unread))
        assert.match(unread.reason, /has not been read/)
      } finally { await independent.dispose() }
      for (const [name, args] of [
        ['write', { file_path: path.join(book, contractPath), content: '不应直接覆盖' }],
        ['edit', { file_path: path.join(book, contractPath), old_string: '作者', new_string: '模型' }],
      ]) assert.equal((await execute(main, name, args)).isError, true)
      const offProbe = main.ctx.get('tools').register({
        name: 'untrusted_native_probe', description: 'Test-only nested mutation without a bridge grant',
        parameters: { type: 'object', properties: {} },
        output: {
          schema: { type: 'object', properties: { denied: { type: 'boolean' } }, required: ['denied'] },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        execute: async (_args, exec) => {
          const result = await service('tools').execute({
            agent: main, name: 'write', arguments: { file_path: path.join(book, contractPath), content: '普通嵌套不得写入' },
            callId: 'untrusted-nested-write', rootCallId: exec.rootCallId, parent: exec.token, signal: exec.signal,
          })
          assert.equal(result.isError, true, JSON.stringify(result))
          return { denied: result.isError }
        },
      })
      try {
        const probe = await execute(main, 'untrusted_native_probe', {})
        assert.equal(probe.isError, false, JSON.stringify(probe))
      } finally { offProbe() }
      assert.equal(text(contractPath), before)
      assert.equal(head(), beforeHead)
    })

    await check('原生写入后提交失败可原样重跑且不重复升版', async () => {
      const args = { 正文: '# 提交重试后的骨架\n' }
      await read(skeletonPath)
      const beforeHead = head()
      const version = core.parseDocument(text(skeletonPath)).data.fields.版本
      const gitLock = path.join(book, '.git/index.lock')
      fs.writeFileSync(gitLock, 'fixture lock', { flag: 'wx' })
      try {
        const failed = await call('novel_update_skeleton', args)
        assert.equal(failed.ok, false, JSON.stringify(failed))
        assert.match(failed.reason, /已落盘但未提交/)
        assert.equal(head(), beforeHead)
      } finally { fs.unlinkSync(gitLock) }
      const saved = text(skeletonPath)
      assert.equal(core.parseDocument(saved).data.fields.版本, version + 1)
      assert.equal((await call('novel_update_skeleton', args)).ok, true)
      assert.equal(text(skeletonPath), saved)
      const committed = head()
      assert.notEqual(committed, beforeHead)
      const replay = await call('novel_update_skeleton', args)
      assert.equal(replay.ok, true, JSON.stringify(replay))
      assert.equal(replay.commitState, 'unchanged')
      assert.equal(replay.retryable, false)
      assert.match(replay.message, /无需补提交/)
      assert.equal(text(skeletonPath), saved)
      assert.equal(head(), committed)
    })

    await check('多文件改稿保留事务且不拆成原生单文件写入', async () => {
      const count = writes.length
      const beforeHead = head()
      const input = { 卷: 1, 章: 2, 章名: '事务测试', 角色: '待审稿', 生成模块: '作者手写', 正文: '第一份作者正文。' }
      const first = await call('novel_import_draft', input)
      assert.equal(first.ok, true, JSON.stringify(first))
      const second = await call('novel_import_draft', { ...input, 生成模块: '作者手改', 正文: '第二份作者正文。' })
      assert.equal(second.ok, true, JSON.stringify(second))
      assert.notEqual(first.relPath, second.relPath)
      assert.equal(core.parseDocument(text(first.relPath)).data.fields.角色, '草稿')
      assert.equal(core.parseDocument(text(second.relPath)).data.fields.角色, '待审稿')
      assert.equal(core.parseDocument(text(second.relPath)).data.fields.父版本, 1)
      assert.equal(writes.length, count)
      assert.equal(head(), beforeHead)
      assert.deepEqual(fs.readdirSync(path.join(book, '.webnovel/transactions')), [])
    })
  } finally { offResult() }
}
