import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { baseline, loadSourceHost } from '../../scripts/dsh-source.mjs'
import { checkNativeWrites } from './native-write-checks.mjs'
import { checkReliability } from './reliability-checks.mjs'
import { checkMemoryCatalog } from './memory-catalog-checks.mjs'
import { checkMaterialSupplements } from './material-supplement-checks.mjs'
import { checkMinimalExport } from './export-checks.mjs'
import { checkSearch } from './retrieval-checks.mjs'

const root = path.resolve(process.argv[2])
const bundleUrl = pathToFileURL(path.resolve(process.argv[3])).href
const workspace = path.join(root, 'workspace')
const require = createRequire(import.meta.url)
const host = process.env.WEBNOVEL_DSH_SOURCE === undefined ? undefined : loadSourceHost(process.env.WEBNOVEL_DSH_SOURCE)
const { boot } = await import(host === undefined ? '@deepseek-ai/dsh-app-boot' : pathToFileURL(host.entry('@deepseek-ai/dsh-app-boot')).href)
const expectedVersion = host?.version ?? baseline.registry.version
const report = { node: process.version, checks: {}, versions: {}, baseline: { version: expectedVersion, sourceCommit: host?.commit ?? null, kind: host === undefined ? 'npm' : 'source' } }
const check = async (name, fn) => {
  report.running = name
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
  try {
    await fn()
    report.checks[name] = { ok: true }
  } catch (error) {
    report.checks[name] = { ok: false, error: error.stack ?? String(error) }
  }
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
}

const profile = [
  { id: 'llm', name: '@deepseek-ai/dsh-llm' },
  { id: 'session', name: '@deepseek-ai/dsh-session' },
  { id: 'agent', name: '@deepseek-ai/dsh-agent' },
  { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt' },
  { id: 'tools', name: '@deepseek-ai/dsh-tools' },
  { id: 'skills', name: '@deepseek-ai/dsh-skill' },
  { id: 'session-projection', name: '@deepseek-ai/dsh-session-projection' },
  { id: 'agent-loop', name: '@deepseek-ai/dsh-agent-loop' },
  { id: 'approval', name: '@deepseek-ai/dsh-user-approval', config: { policy: 'ask' } },
  { id: 'user-questions', name: '@deepseek-ai/dsh-user-questions' },
  { id: 'fs', name: '@deepseek-ai/dsh-fs-local', config: { cwd: workspace } },
  { id: 'fs-observation-policy', name: '@deepseek-ai/dsh-fs-observation-policy' },
  { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
  { id: 'storage', name: '@deepseek-ai/dsh-storage' },
  { id: 'storage-json', name: '@deepseek-ai/dsh-storage-json', config: { root: path.join(root, 'storage') } },
  { id: 'storage-domain', name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json' } },
  { id: 'persistence', name: '@deepseek-ai/dsh-session-persistence-jsonl', config: { root: path.join(root, 'sessions'), compression: 'none' } },
  { id: 'workspace', name: '@deepseek-ai/dsh-workspace' },
  { id: 'settings', name: '@deepseek-ai/dsh-settings-file', config: { path: path.join(root, 'settings.yaml'), watch: false } },
  { id: 'credentials', name: '@deepseek-ai/dsh-credentials-local', config: { path: path.join(root, 'credentials.yaml'), watch: false } },
  { id: 'embedding', name: pathToFileURL(path.join(root, 'embedding-provider.mjs')).href },
  { id: 'webnovel', name: bundleUrl },
]
const configPath = path.join(root, 'cordis.yml')
const configuredProfile = host === undefined ? profile : profile.map(row => row.name.startsWith('@deepseek-ai/')
  ? { ...row, name: pathToFileURL(host.entry(row.name)).href }
  : row)
fs.writeFileSync(configPath, JSON.stringify(configuredProfile, null, 2))
const book = path.join(workspace, '测试书')
fs.mkdirSync(path.join(book, '作品契约'), { recursive: true })
fs.writeFileSync(path.join(book, '作品契约', '契约.md'), '---\n书id: loader-book\n---\n\n# 测试书\n')
const chapter = path.join(book, '定稿', '卷01', '0001-开篇.md')
fs.mkdirSync(path.dirname(chapter), { recursive: true })
fs.writeFileSync(chapter, '---\n身份:\n  卷: 1\n  章: 1\n  章名: 开篇\n角色: 已定稿\n版本: 1\n---\n\n原定稿正文。\n')
fs.writeFileSync(path.join(book, '.gitignore'), '草稿区/\n.webnovel/\n')
const git = (...args) => execFileSync('git', args, { cwd: book, encoding: 'utf8', windowsHide: true })
git('init', '--quiet')
git('config', 'user.name', 'Loader Test')
git('config', 'user.email', 'loader-test@example.invalid')
git('config', 'commit.gpgsign', 'false')
git('config', 'core.autocrlf', 'false')
git('add', '.')
git('commit', '--quiet', '-m', 'ch: fixture')

const ctx = await boot('webnovel-loader-test', configPath)
const service = name => ctx.get(name)
const schemas = agent => service('tools').schemas(agent).map(tool => tool.name).filter(name => name.startsWith('novel_')).sort()
let sequence = 0
const execute = (agent, name, args, signal = new AbortController().signal) => service('tools').execute({
  agent, name, arguments: args, signal, callId: `loader-call-${++sequence}`,
})
const events = agent => Array.from({ length: agent.session.seq }, (_, index) => agent.session.eventAt(index))
const entry = id => [...service('loader').entries()].find(item => item.options.id === id)
const presentation = async agent => {
  const assembled = await service('systemPrompt').assemble({ agent, scope: agent })
  return {
    persona: assembled.sections.filter(section => section.name === 'deployment:persona-prefix'),
    status: assembled.contexts.filter(context => context.name === 'webnovel.status'),
  }
}
const toggle = async (id, disabled) => {
  await entry(id).update({ disabled }, false, true)
  await service('loader').await()
}
let turn = 0
const withTurn = async (agent, action) => {
  const number = ++turn
  agent.session.append('turn/start', { turn: number })
  try { return await action() }
  finally { agent.session.append('turn/end', { turn: number, reason: { kind: 'completed' } }) }
}
const retconArgs = { bookId: 'loader-book', 卷: 1, 章: 1, 章名: '开篇', 更正后正文: '取消后不得出现的正文。', 摘要: 'Loader cancellation probe' }

try {
  await check('真实 Loader 与基线版本', async () => {
    for (const row of profile.filter(row => row.name.startsWith('@deepseek-ai/dsh-'))) {
      const metadata = host === undefined ? require(`${row.name}/package.json`) : host.get(row.name).metadata
      report.versions[metadata.name] = metadata.version
      assert.equal(metadata.version, expectedVersion)
    }
    assert.equal(entry('webnovel').options.name, bundleUrl)
    for (const name of ['agents', 'agentLoop', 'sessions', 'sessionProjections', 'userQuestions', 'approval', 'workspaceRegistry']) assert.ok(service(name), name)
    await service('workspaceRegistry').create(workspace)
  })

  const main = (await service('agents').create({ sessionId: 'loader-main', meta: { cwd: workspace } })).agent
  const child = (await main.ctx.get('agents').create({
    parentAgent: main, sessionId: 'loader-child', meta: { cwd: workspace, origin: 'subagent', parentSession: main.id, delegationDepth: 1 },
  })).agent
  report.identities = { main: main.id, child: child.id, sessionFormat: main.session.header.version, runtimeRoots: service('agents').roots().map(agent => agent.id) }

  await check('主 Agent 工具与全局隔离', async () => {
    assert.equal(main.session.header.version, host === undefined ? baseline.registry.sessionFormat : baseline.source.sessionFormat)
    assert.equal(schemas(main).length, 26)
    assert.deepEqual(schemas(undefined), [])
    const result = await execute(main, 'novel_select_book', { bookId: 'loader-book' })
    assert.equal(result.value.ok, true, JSON.stringify(result))
    assert.match(result.value.message, /【当前书】/)
    assert.equal(typeof result.value.近况, 'string')
    assert.ok(result.value.近况.length > 0)
  })
  await check('子 Agent 工具拒绝与真实 never 策略', async () => {
    assert.deepEqual(schemas(child), [])
    const result = await execute(child, 'novel_select_book', { bookId: 'loader-book' })
    assert.equal(result.isError, true)
    assert.match(JSON.stringify(result), /UNKNOWN_TOOL/)
    assert.equal(service('approval').overrideOf(child.session), 'never')
  })
  await check('真实问答拒绝受委派调用', async () => {
    await assert.rejects(service('userQuestions').ask({ agent: child, questions: [{ id: 'test', question: '继续？' }] }), { code: 'DELEGATED_CALLER' })
  })
  await check('作者裁决与本次调用绑定', async () => {
    let seen
    const off = ctx.on('user-questions/request', async request => {
      seen = request
      return { answers: request.questions.map(question => ({ id: question.id, selected: ['退回'] })) }
    })
    try {
      const result = await execute(main, 'novel_settle_chapter', { bookId: 'loader-book', 卷: 1, 章: 1, 章名: '开篇', summary: '测试' })
      assert.match(JSON.stringify(result), /未获作者批准/)
      assert.equal(seen.agent, main)
      assert.ok(seen.signal instanceof AbortSignal)
    } finally { off() }
  })
  await check('随包技能发现、资源、覆盖优先级与卸载重载', async () => {
    const skills = () => service('skills').list({ cwd: workspace, scope: main })
    const names = (await skills()).map(skill => skill.name).sort()
    assert.equal(names.length, 10)
    for (const name of names) {
      const skill = await service('skills').get(name, { cwd: workspace, scope: main })
      assert.equal(skill.provider, 'webnovel-bundled')
      assert.ok(skill.content.length > 100)
      assert.ok(skill.resourceBase.path.startsWith(path.join(root, 'skills')))
    }
    const local = path.join(workspace, '.agents', 'skills', names[0])
    fs.mkdirSync(local, { recursive: true })
    fs.writeFileSync(path.join(local, 'SKILL.md'), `---\nname: ${names[0]}\ndescription: 本地覆盖验收\n---\n本地技能覆盖。\n`)
    const filesystem = await import(host === undefined ? '@deepseek-ai/dsh-skill-filesystem' : pathToFileURL(host.entry('@deepseek-ai/dsh-skill-filesystem')).href)
    const localProvider = ctx.plugin(filesystem, { providerName: 'acceptance-local' })
    await localProvider
    assert.equal((await service('skills').get(names[0], { cwd: workspace, scope: main })).provider, 'acceptance-local')
    await localProvider.dispose()
    await toggle('webnovel', true)
    assert.equal((await skills()).length, 0)
    await toggle('webnovel', false)
    assert.deepEqual((await skills()).map(skill => skill.name).sort(), names)
    await toggle('skills', true)
    await toggle('skills', false)
    assert.deepEqual((await skills()).map(skill => skill.name).sort(), names)
  })
  await check('Loader 卸载重载等价', async () => {
    const before = schemas(main)
    const prompt = await presentation(main)
    const hostPrompt = await presentation(undefined)
    assert.equal(prompt.persona.length, 1)
    assert.equal(prompt.status.length, 1)
    const row = entry('webnovel')
    await row.update({ disabled: true }, false, true)
    await service('loader').await()
    let absentTools
    let absentPrompt
    try {
      absentTools = schemas(main)
      absentPrompt = await presentation(main)
    } finally {
      await row.update({ disabled: false }, false, true)
      await service('loader').await()
    }
    assert.deepEqual(absentTools, [])
    assert.deepEqual(absentPrompt, hostPrompt)
    assert.deepEqual(schemas(main), before)
    assert.deepEqual(schemas(child), [])
    assert.deepEqual(await presentation(main), prompt)
  })
  await check('运行时归属优先于历史 origin', async () => {
    const unmarked = await main.ctx.get('agents').create({ parentAgent: main, sessionId: 'loader-unmarked-child', meta: { cwd: workspace } })
    const restoredRoot = await service('agents').create({ sessionId: 'loader-lineage-root', meta: { cwd: workspace, origin: 'subagent', parentSession: main.id } })
    try {
      assert.ok(!service('agents').roots().includes(unmarked.agent))
      assert.ok(service('agents').roots().includes(restoredRoot.agent))
      assert.deepEqual(schemas(unmarked.agent), [])
      assert.equal(schemas(restoredRoot.agent).length, 26)
      assert.equal(service('approval').overrideOf(unmarked.agent.session), 'never')
      assert.notEqual(service('approval').overrideOf(restoredRoot.agent.session), 'never')
    } finally {
      await unmarked.dispose()
      await restoredRoot.dispose()
    }
  })
  await check('同一会话恢复后重新装机', async () => {
    const previous = await service('agents').create({ sessionId: 'loader-resume', meta: { cwd: workspace } })
    assert.equal(schemas(previous.agent).length, 26)
    await service('sessionPersistence').flush()
    await previous.dispose()
    const resumed = await service('agents').resume({ resumeSessionId: 'loader-resume' })
    try {
      assert.equal(schemas(resumed.agent).length, 26)
      assert.match((await presentation(resumed.agent)).status[0].text, /【工作区总览】/)
    }
    finally { await resumed.dispose() }
  })
  await check('问答依赖卸载与重载', async () => {
    await toggle('user-questions', true)
    const whileMissing = schemas(main)
    await toggle('user-questions', false)
    assert.deepEqual(whileMissing, [])
    assert.equal(schemas(main).length, 26)
    assert.deepEqual(schemas(child), [])
  })
  await check('审批依赖晚到仍拒绝子 Agent', async () => {
    await toggle('approval', true)
    const late = await main.ctx.get('agents').create({ parentAgent: main, sessionId: 'loader-late-child', meta: { cwd: workspace, origin: 'subagent' } })
    await toggle('approval', false)
    let asked = 0
    const off = ctx.on('approval/request', async () => { asked++; return 'allowed-once' })
    try {
      const outcome = await withTurn(late.agent, () => service('approval').request({ agent: late.agent, toolName: 'write' }))
      assert.equal(outcome, 'rejected')
      assert.equal(asked, 0)
      assert.equal(service('approval').overrideOf(late.agent.session), 'never')
    } finally { off(); await late.dispose() }
  })
  await check('真实文件工具动作授权与审计', async () => {
    const destination = path.join(root, 'outside-approved.md')
    let asked = 0
    const off = ctx.on('approval/request', async request => {
      asked++
      assert.equal(request.agent, main)
      return 'allowed-once'
    })
    try {
      const result = await withTurn(main, () => execute(main, 'write', { file_path: destination, content: 'approved once' }))
      assert.equal(result.isError, false, JSON.stringify(result))
      assert.equal(fs.readFileSync(destination, 'utf8'), 'approved once')
      assert.equal(asked, 1)
      const audit = events(main).filter(event => event.type === 'approval/asked' || event.type === 'approval/decided').slice(-2)
      assert.equal(audit[0].data.toolName, 'write')
      assert.equal(audit[1].data.outcome, 'allowed-once')
      assert.equal(audit[0].data.id, audit[1].data.id)
      const before = fs.readFileSync(chapter, 'utf8')
      const denied = await execute(main, 'write', { file_path: chapter, content: 'forbidden' })
      assert.equal(denied.isError, true)
      assert.equal(fs.readFileSync(chapter, 'utf8'), before)
    } finally { off() }
  })
  await check('文件动作预取消与等待中取消', async () => {
    const destination = path.join(root, 'outside-cancelled.md')
    let called = 0
    let entered
    let answer
    const waiting = new Promise(resolve => { entered = resolve })
    const off = ctx.on('approval/request', async () => {
      called++
      entered()
      return await new Promise(resolve => { answer = resolve })
    })
    try {
      const cancelled = new AbortController()
      cancelled.abort()
      await withTurn(main, () => execute(main, 'write', { file_path: destination, content: 'cancelled' }, cancelled.signal))
      assert.equal(called, 0)
      assert.equal(fs.existsSync(destination), false)
      const controller = new AbortController()
      const pending = withTurn(main, () => execute(main, 'write', { file_path: destination, content: 'cancelled' }, controller.signal))
      await waiting
      controller.abort()
      answer('allowed-once')
      const result = await pending
      assert.equal(result.isError, true)
      assert.equal(fs.existsSync(destination), false)
      assert.equal(events(main).filter(event => event.type === 'approval/decided').at(-1).data.outcome, 'cancelled')
    } finally { off() }
  })
  await check('作者裁决预取消与迟到批准', async () => {
    const before = fs.readFileSync(chapter, 'utf8')
    const head = git('rev-parse', 'HEAD')
    let called = 0
    let entered
    let answer
    const waiting = new Promise(resolve => { entered = resolve })
    const off = ctx.on('user-questions/request', async request => {
      called++
      entered()
      await new Promise(resolve => { answer = resolve })
      return { answers: request.questions.map(question => ({ id: question.id, selected: ['批准'] })) }
    })
    try {
      const cancelled = new AbortController()
      cancelled.abort()
      await execute(main, 'novel_apply_retcon', retconArgs, cancelled.signal)
      assert.equal(called, 0)
      assert.equal(fs.readFileSync(chapter, 'utf8'), before)
      const controller = new AbortController()
      const pending = execute(main, 'novel_apply_retcon', retconArgs, controller.signal)
      await waiting
      controller.abort()
      answer()
      await pending
      assert.equal(fs.readFileSync(chapter, 'utf8'), before)
      assert.equal(git('rev-parse', 'HEAD'), head)
    } finally { off() }
  })
  await check('工作区注册、别名与非法 cwd', async () => {
    const registry = service('workspaceRegistry')
    const registered = await registry.resolveByPath(workspace)
    assert.ok(registered)
    const alias = path.join(root, 'workspace-alias')
    fs.symlinkSync(workspace, alias, 'junction')
    try {
      assert.equal((await registry.resolveByPath(alias)).id, registered.id)
      const agent = await service('agents').create({ sessionId: 'loader-alias', meta: { cwd: alias } })
      try {
        const result = await execute(agent.agent, 'novel_select_book', { bookId: 'loader-book' })
        assert.equal(result.value.ok, true, JSON.stringify(result))
      } finally { await agent.dispose() }
    } finally { fs.unlinkSync(alias) }
    await assert.rejects(service('agents').create({ sessionId: 'loader-relative', meta: { cwd: 'relative/path' } }))
    const unowned = path.join(root, 'unowned')
    fs.mkdirSync(unowned)
    assert.equal(await registry.resolveByPath(unowned), undefined)
    await assert.rejects(registry.resolveByPath(path.join(root, 'missing')))
  })
  await check('裁决服务失败不写真源', async () => {
    for (const [name, args] of [
      ['novel_apply_retcon', retconArgs],
      ['novel_settle_chapter', { bookId: 'loader-book', 卷: 1, 章: 1, 章名: '开篇', summary: 'no provider' }],
    ]) {
      const before = fs.readFileSync(chapter, 'utf8')
      const result = await execute(main, name, args)
      assert.equal(result.isError, true)
      assert.match(JSON.stringify(result), /NO_PROVIDER/)
      assert.equal(fs.readFileSync(chapter, 'utf8'), before)
    }
  })
  await check('真实提案与补偿提交', async () => {
    const proposal = await execute(main, 'novel_record_proposal', {
      bookId: 'loader-book', 域: '吃书补偿', 类型: '事实更正', 内容: '更正开篇事实', 来源: 'Loader 验收', 影响分析: '已定稿命中：开篇；未定稿下游：无。',
    })
    assert.equal(proposal.value.ok, true)
    const decided = await execute(main, 'novel_resolve_proposal', { bookId: 'loader-book', 提案编号: proposal.value.编号, 决定: '通过', 裁决记录: '验收答复器批准本次测试更正' })
    assert.equal(decided.value.ok, true)
    let authorQuestions = 0
    let actionQuestions = 0
    const offAction = ctx.on('approval/request', async () => { actionQuestions++; return 'allowed-once' })
    const offAuthor = ctx.on('user-questions/request', async request => {
      authorQuestions++
      return { answers: request.questions.map(question => ({ id: question.id, selected: ['批准'] })) }
    })
    try {
      const result = await withTurn(main, () => execute(main, 'novel_apply_retcon', { ...retconArgs, 提案编号: proposal.value.编号, 更正后正文: '作者批准的更正正文。', 摘要: 'Loader 真实补偿验收' }))
      assert.equal(result.value.ok, true, JSON.stringify(result))
      assert.equal(authorQuestions, 1)
      assert.match(fs.readFileSync(chapter, 'utf8'), /作者批准的更正正文/)
      assert.match(git('log', '-1', '--format=%s'), /^retcon:/)
      assert.ok(fs.existsSync(path.join(book, result.value.补偿事件)))
      report.axes = { retconAuthorQuestions: authorQuestions, retconActionQuestions: actionQuestions }
    } finally { offAction(); offAuthor() }
  })
  await checkNativeWrites({ root, book, main, ctx, service, execute, git, check, report })
  await checkReliability({ root, book, main, ctx, service, execute, git, check, report, withTurn })
  await checkMemoryCatalog({ host, ctx, workspace, book, service, execute, check, report, withTurn })
  await checkMaterialSupplements({ root, workspace, main, execute, check, report, withTurn })
  await checkMinimalExport({ root, workspace, check, report })
  await checkSearch({ root, workspace, main, child, ctx, service, execute, check, toggle, host })
  await check('工作区依赖重启交回旧根', async () => {
    const bundle = await import(bundleUrl)
    for (const name of ['workspace-next', 'workspace-final']) {
      const next = path.join(root, name)
      fs.mkdirSync(next)
      await service('workspaceRegistry').create(next)
      await toggle('workspace', true)
      await toggle('workspace', false)
      assert.equal(bundle.currentWorkspaceRoot(), fs.realpathSync.native(next))
    }
  })
  await check('原生文件工具对子 Agent 的边界', async () => {
    const denied = await execute(child, 'write', { file_path: chapter, content: '不应覆盖定稿' })
    assert.equal(denied.isError, true)
    const outside = path.join(root, 'child-outside.md')
    const rejected = await withTurn(child, () => execute(child, 'write', { file_path: outside, content: '不应获批' }))
    assert.equal(rejected.isError, true)
    assert.equal(fs.existsSync(outside), false)
    const read = await execute(child, 'read', { file_path: chapter })
    assert.equal(read.isError, false, JSON.stringify(read))
    report.nativeFileBoundary = { sourceWriteDenied: true, childApprovalRejected: true, sourceReadStillVisible: true, sandboxBackend: 'fs-local (no OS sandbox)' }
  })
  await check('工具服务重启后重新装机', async () => {
    await toggle('tools', true)
    assert.equal(service('agents').list().length, 0)
    await toggle('tools', false)
    const fresh = await service('agents').create({ sessionId: 'loader-after-tools', meta: { cwd: workspace } })
    const delegated = await fresh.agent.ctx.get('agents').create({ parentAgent: fresh.agent, sessionId: 'loader-after-tools-child', meta: { cwd: workspace, origin: 'subagent' } })
    try {
      assert.equal(schemas(fresh.agent).length, 26)
      assert.deepEqual(schemas(delegated.agent), [])
      assert.equal((await presentation(fresh.agent)).status.length, 1)
      assert.equal((await execute(fresh.agent, 'novel_select_book', { bookId: 'loader-book' })).value.ok, true)
    } finally { await delegated.dispose(); await fresh.dispose() }
  })
  await check('原生对话恢复后继续', async () => {
    const { LlmAdapter, createUserMessage } = await import(host === undefined
      ? '@deepseek-ai/dsh-llm' : pathToFileURL(host.entry('@deepseek-ai/dsh-llm')).href)
    const textResponse = text => [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text },
      { type: 'block-end', index: 0, block: { type: 'text', text } },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const callResponse = (id, name, args) => {
      const argumentsJson = JSON.stringify(args)
      return [
        { type: 'block-start', index: 0, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsJson },
        { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsJson } },
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ]
    }
    const script = [
      callResponse('native-select', 'novel_select_book', { bookId: 'loader-book' }),
      callResponse('native-settle', 'novel_settle_chapter', { bookId: 'loader-book', 卷: 1, 章: 1, 章名: '开篇', summary: '原生上下文恢复测试' }),
      textResponse('已读取近况；作者退回定稿，等待继续。'),
      textResponse('收到继续，沿用前文处理。'),
    ]
    class ScriptedAdapter extends LlmAdapter {
      requests = []
      async * stream(options) {
        this.requests.push(options)
        const chunks = script.shift()
        assert.ok(chunks, 'unexpected model request')
        for (const chunk of chunks) yield chunk
      }
    }
    const adapter = new ScriptedAdapter()
    const options = { provider: 'loader-native', model: 'fixture' }
    const completeTurn = async (context, agent, text) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { off(); reject(new Error('native turn did not finish')) }, 10_000)
        const off = context.on('agent/status', ({ agent: subject, status }) => {
          if (subject !== agent || status !== 'idle') return
          clearTimeout(timer)
          off()
          resolve()
        })
        agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      })
      assert.equal(events(agent).filter(event => event.type === 'turn/end').at(-1).data.reason.kind, 'completed')
    }
    service('llm').registerAdapter(['loader-native'], adapter)
    // Another provider changes its runtime context between model steps. The memory catalog
    // must not be repeated just because the host emits a new combined runtime snapshot.
    service('systemPrompt').context({ name: 'acceptance.changed-context', order: 999, text: () => `验收状态${adapter.requests.length}` })
    let authorQuestions = 0
    ctx.on('user-questions/request', async request => {
      authorQuestions++
      return { answers: request.questions.map(question => ({ id: question.id, selected: ['退回'] })) }
    })
    const previous = await service('agents').create({ sessionId: 'loader-native-resume', meta: { cwd: workspace }, agentOptions: options })
    await completeTurn(ctx, previous.agent, '继续写《测试书》，保留原生上下文标记。')
    assert.equal(authorQuestions, 1)
    assert.equal(adapter.requests.length, 3)
    // 15A：作者记忆目录只在第一次模型输入的快照里出现一次；同会话后续请求沿用历史，不重复注入
    const snapshotMessages = request => request.messages.filter(message => message.role === 'user'
      && (message.content ?? []).some(part => part.type === 'text' && part.text.includes('【作者记忆目录】会话开始时')))
    const catalogHits = adapter.requests.map(request => snapshotMessages(request).length)
    assert.deepEqual(catalogHits, [1, 1, 1], JSON.stringify(catalogHits))
    assert.equal(snapshotMessages(adapter.requests[0])[0].source?.form, 'snapshot')
    assert.equal(snapshotMessages(adapter.requests[0])[0].source?.plugin, 'webnovel-memory-catalog')
    assert.match(JSON.stringify(adapter.requests[0].messages), /- 冷开场 — 作者偏好 \{\{冷开场\}\} 直接入戏/)
    assert.match(JSON.stringify(adapter.requests[1].messages), /【本书记忆目录】选书时/)
    assert.ok(events(previous.agent).some(event => event.type === 'tool/result'))
    assert.ok(events(previous.agent).every(event => !event.type.startsWith('novel/')))
    await ctx.fiber.dispose()

    const restoredHost = await boot('webnovel-native-resume', configPath)
    try {
      restoredHost.get('llm').registerAdapter(['loader-native'], adapter)
      const restored = await restoredHost.get('agents').resume({ resumeSessionId: 'loader-native-resume', agentOptions: options })
      await completeTurn(restoredHost, restored.agent, '继续')
      assert.equal(adapter.requests.length, 4)
      const history = JSON.stringify(adapter.requests.at(-1).messages)
      assert.match(history, /保留原生上下文标记/)
      assert.match(history, /loader-book/)
      assert.match(history, /近况/)
      assert.match(history, /未获作者批准/)
      assert.match(history, /继续/)
      // The plugin recognizes its already delivered ordinary message; changed runtime
      // context in the restored Host does not append another author catalog.
      assert.equal(snapshotMessages(adapter.requests.at(-1)).length, 1)
      assert.equal(adapter.requests.at(-1).messages.filter(message => JSON.stringify(message).includes('【本书记忆目录】选书时')).length, 1)
      assert.ok(events(restored.agent).every(event => !event.type.startsWith('novel/')))
      report.nativeContinuation = { restored: true, previousUserText: true, bookAndProgress: true, priorToolOutcome: true, customEvents: 0 }
    } finally { await restoredHost.fiber.dispose() }
  })
} finally {
  await ctx.fiber.dispose()
  delete report.running
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
