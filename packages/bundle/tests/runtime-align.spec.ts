/**
 * 真实组合测试（dsh 运行时对齐批，手册 §11/G1 首块）。
 *
 * 不用手搓假 ctx：真实 cordis 运行时＋真实 dsh-tools ToolRuntime＋真实
 * dsh-system-prompt＋真实 dsh-scope（createScope 造 agent scope，agent 对象
 * 即 ScopeKey）＋真实 bundle 插件加载。宿主侧 userQuestions/agents/
 * workspaceRegistry 用极窄 Service stub（真实服务键、真实事件路由）。
 *
 * 覆盖：主 Agent scoped 可见性（E1）、子 Agent restrict 拒绝执行（E2/
 * UNKNOWN_TOOL）、approval 轴 R8 策略、ToolRunContext 透传（agent/signal
 * 到本次裁决）、卸载→重载等价性（B4）。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { ToolRuntime, type ToolRuntime as ToolRuntimeType } from '@deepseek-ai/dsh-tools'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { createScope } from '@deepseek-ai/dsh-scope'
import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import * as os from 'node:os'
import { apply, resetWorkspaceRoot } from '../src'
import { NOVEL_TOOL_NAMES } from '../src/novel-tools'

const roots: string[] = []
afterAll(() => {
  for (const r of roots) {
    try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟 */ }
  }
  resetWorkspaceRoot()
})

/** 极窄 userQuestions stub：真实服务键，捕获请求、按预置答案回。 */
class UserQuestionsStub extends Service {
  static captured: Array<{ questions: ReadonlyArray<{ id: string }>; signal?: AbortSignal; agent?: unknown }> = []
  answer: { answers: Array<{ id: string; selected: string[] }> } = { answers: [] }
  constructor(ctx: Context) { super(ctx, 'userQuestions') }
  ask = async (request: { questions: ReadonlyArray<{ id: string }>; signal?: AbortSignal; agent?: unknown }): Promise<unknown> => {
    UserQuestionsStub.captured.push(request)
    if (request.signal?.aborted) {
      throw Object.assign(new Error('ask aborted'), { code: 'ASK_ABORTED' })
    }
    return this.answer
  }
}

/** 极窄 agents stub：真实服务键，list() 驱动 bundle 的初装路径。 */
class AgentsStub extends Service {
  items: unknown[] = []
  constructor(ctx: Context) { super(ctx, 'agents') }
  list = (): unknown[] => this.items
}

/** 极窄 workspaceRegistry stub：真实服务键，认领测试工作范围。 */
class WorkspaceRegistryStub extends Service {
  constructor(ctx: Context, private readonly workspace: string) { super(ctx, 'workspaceRegistry') }
  list = (): unknown[] => [{ path: this.workspace, title: '测试工作范围' }]
}

interface TestAgent {
  readonly id: string
  ctx: Context
  readonly session?: {
    readonly header?: { readonly origin?: string; readonly cwd?: string }
    append(type: string, data: unknown): unknown
  }
}

interface SessionEvents {
  events: Array<{ type: string; data: unknown }>
}

function mkWorkspace(): string {
  const ws = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'webnovel-align-'))
  roots.push(ws)
  const book = nodePath.join(ws, '测试书')
  fs.mkdirSync(nodePath.join(book, '作品契约'), { recursive: true })
  fs.writeFileSync(
    nodePath.join(book, '作品契约', '契约.md'),
    '---\n书id: test-book\n---\n\n# 作品契约\n\n测试书。\n',
    'utf-8',
  )
  return ws
}

function makeAgent(
  root: Context,
  id: string,
  opts: { parent?: TestAgent; origin?: string; cwd?: string },
): { agent: TestAgent; events: SessionEvents; scope: Awaited<ReturnType<typeof createScope>> } {
  const events: SessionEvents = { events: [] }
  const agent: TestAgent = { id, ctx: undefined as unknown as Context }
  const scope = createScope(root, agent, opts.parent === undefined ? {} : { parent: opts.parent })
  agent.ctx = scope.ctx
  agent.session = {
    header: { ...(opts.origin === undefined ? {} : { origin: opts.origin }), ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }) },
    append: (type: string, data: unknown) => { events.events.push({ type, data }); return undefined },
  }
  return { agent, events, scope }
}

async function loadBundle(root: Context, ws: string, agents: unknown[]): Promise<{ unload: () => Promise<void>; uq: UserQuestionsStub }> {
  await root.plugin(UserQuestionsStub)
  await root.plugin(WorkspaceRegistryStubFactory(ws))
  await root.plugin(AgentsStub)
  const svc = (name: string): unknown => (root as unknown as { get(n: string): unknown }).get(name)
  const agentsStub = svc('agents') as AgentsStub
  agentsStub.items.push(...agents)
  const bundle = await import('../src')
  const fiber = await root.plugin({ name: bundle.name, apply: bundle.apply })
  return {
    uq: svc('userQuestions') as UserQuestionsStub,
    unload: async () => { await fiber.dispose() },
  }
}

/** WorkspaceRegistryStub 需要每测试不同 workspace，用工厂插件承载。 */
function WorkspaceRegistryStubFactory(workspace: string): new (ctx: Context) => Service {
  return class extends WorkspaceRegistryStub {
    constructor(ctx: Context) { super(ctx, workspace) }
  }
}

async function disposeRoot(root: Context): Promise<void> {
  await (root as unknown as { dispose?: () => unknown }).dispose?.()
}

function schemasOf(tools: ToolRuntimeType, agent: TestAgent): string[] {
  const schemas = tools.schemas(agent) as ReadonlyArray<{ name?: string }>
  return schemas.map((s) => String(s.name ?? ''))
}

async function execTool(tools: ToolRuntimeType, agent: TestAgent, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  return tools.execute({
    callId: `call-${Math.random().toString(36).slice(2)}`,
    name,
    arguments: args,
    agent,
    signal: signal ?? new AbortController().signal,
  } as never)
}

const approveAnswer = (): { answers: Array<{ id: string; selected: string[] }> } => ({ answers: [{ id: '定稿入档', selected: ['批准'] }] })

describe('dsh 运行时对齐:主 Agent scoped 工具面', () => {
  it('主 Agent 可见小说工具全集；未装机且无链路的 scope 不可见，NOVEL_TOOL_NAMES 与注册集一致', async () => {
    resetWorkspaceRoot()
    const ws = mkWorkspace()
    const root = new Context()
    await root.plugin(SystemPrompt)
    await root.plugin(ToolRuntime)

    const main = makeAgent(root, 'main-1', { cwd: ws })
    // 不装机的外部 scope:与 main 无父子链、也不在 agents.list 里——
    // E1 的泄漏分辨:scoped 层注册不得落到全局层(否则任何 scope 都可见)
    const outsider = makeAgent(root, 'outsider-1', {})
    await loadBundle(root, ws, [main.agent])

    const tools = (root as unknown as { get(n: string): unknown }).get('tools') as ToolRuntimeType
    const mainNames = schemasOf(tools, main.agent)
    for (const n of NOVEL_TOOL_NAMES) expect(mainNames).toContain(n)
    expect(mainNames.filter((n) => n.startsWith('novel_'))).toHaveLength(NOVEL_TOOL_NAMES.length)
    expect(schemasOf(tools, outsider.agent).filter((n) => n.startsWith('novel_'))).toEqual([])
    await disposeRoot(root)
  })

  it('子 Agent:继承面被 restrict 收掉;执行小说工具得 UNKNOWN_TOOL isError;主 Agent 不受限', async () => {
    resetWorkspaceRoot()
    const ws = mkWorkspace()
    const root = new Context()
    await root.plugin(SystemPrompt)
    await root.plugin(ToolRuntime)

    const main = makeAgent(root, 'main-2', { cwd: ws })
    const sub = makeAgent(root, 'sub-2', { parent: main.agent, origin: 'subagent', cwd: ws })
    await loadBundle(root, ws, [main.agent, sub.agent])

    const tools = (root as unknown as { get(n: string): unknown }).get('tools') as ToolRuntimeType
    const subNames = schemasOf(tools, sub.agent)
    expect(subNames.filter((n) => NOVEL_TOOL_NAMES.includes(n))).toEqual([])

    // 子 Agent 执行 → 物化 isError,UNKNOWN_TOOL(不 throw)
    const rejected = await execTool(tools, sub.agent, 'novel_select_book', { bookId: 'test-book' })
    const text = JSON.stringify(rejected)
    expect(text).toContain('UNKNOWN_TOOL')
    expect((rejected as { isError?: boolean }).isError).toBe(true)
    const rejectedEditor = await execTool(tools, sub.agent, 'novel_editor_suggest', { requestId: 'abcdef', kind: 'none' })
    expect(JSON.stringify(rejectedEditor)).toContain('UNKNOWN_TOOL')
    expect((rejectedEditor as { isError?: boolean }).isError).toBe(true)

    // 主 Agent 同名调用走真实执行(非 UNKNOWN_TOOL)
    const mainResult = await execTool(tools, main.agent, 'novel_select_book', { bookId: 'test-book' })
    const mainText = JSON.stringify(mainResult)
    expect(mainText).not.toContain('UNKNOWN_TOOL')
    expect(mainText).toContain('test-book')
    // restrict 后主 Agent 面不缩
    expect(schemasOf(tools, main.agent).filter((n) => NOVEL_TOOL_NAMES.includes(n))).toHaveLength(NOVEL_TOOL_NAMES.length)
    await disposeRoot(root)
  })
})

describe('dsh 运行时对齐:ToolRunContext 透传与作者裁决', () => {
  it('agent/signal 传入本次裁决，不附加会话记录', async () => {
    resetWorkspaceRoot()
    UserQuestionsStub.captured = []
    const ws = mkWorkspace()
    const root = new Context()
    await root.plugin(SystemPrompt)
    await root.plugin(ToolRuntime)

    const main = makeAgent(root, 'main-3', { cwd: ws })
    const { unload, uq } = await loadBundle(root, ws, [main.agent])
    uq.answer = approveAnswer()

    const tools = (root as unknown as { get(n: string): unknown }).get('tools') as ToolRuntimeType
    const controller = new AbortController()
    // 定稿入档:裁决发生在一切落盘检查之前,最小书即可走到 askAuthor
    const result = await execTool(tools, main.agent, 'novel_settle_chapter', {
      bookId: 'test-book', 卷: 1, 章: 1, 章名: '第一章', summary: '测试',
    }, controller.signal)

    // 裁决请求捕获:agent 与 signal 全量透传
    expect(UserQuestionsStub.captured.length).toBeGreaterThanOrEqual(1)
    const captured = UserQuestionsStub.captured[0]!
    expect(captured.signal).toBe(controller.signal)
    expect((captured.agent as { id?: string } | undefined)?.id).toBe('main-3')

    expect(main.events!.events).toEqual([])
    void result
    await unload()
    await disposeRoot(root)
  })

  it('作者退回仍拒绝入档，不附加会话记录', async () => {
    resetWorkspaceRoot()
    UserQuestionsStub.captured = []
    const ws = mkWorkspace()
    const root = new Context()
    await root.plugin(SystemPrompt)
    await root.plugin(ToolRuntime)

    const main = makeAgent(root, 'main-4', { cwd: ws })
    const { unload, uq } = await loadBundle(root, ws, [main.agent])
    // 作者退回:有效答案但决定=已退回
    uq.answer = { answers: [{ id: '定稿入档', selected: ['退回'] }] }
    const tools = (root as unknown as { get(n: string): unknown }).get('tools') as ToolRuntimeType

    const rejected = await execTool(tools, main.agent, 'novel_settle_chapter', {
      bookId: 'test-book', 卷: 1, 章: 1, 章名: '第一章', summary: '测试',
    })
    expect(main.events!.events).toEqual([])
    expect(JSON.stringify(rejected)).toContain('未获作者批准')

    await unload()
    await disposeRoot(root)
  })
})

describe('dsh 运行时对齐:子 Agent 审批策略与卸载重载等价性', () => {
  it('卸载→工具面撤销;重载→新装等价;子 Agent 重载后仍被封', async () => {
    resetWorkspaceRoot()
    const ws = mkWorkspace()
    const root = new Context()
    await root.plugin(SystemPrompt)
    await root.plugin(ToolRuntime)

    const main = makeAgent(root, 'main-5', { cwd: ws })
    const sub = makeAgent(root, 'sub-5', { parent: main.agent, origin: 'subagent', cwd: ws })
    const { unload } = await loadBundle(root, ws, [main.agent, sub.agent])

    const tools = (root as unknown as { get(n: string): unknown }).get('tools') as ToolRuntimeType
    const before = schemasOf(tools, main.agent).filter((n) => NOVEL_TOOL_NAMES.includes(n))
    expect(before).toHaveLength(NOVEL_TOOL_NAMES.length)

    // 卸载:插件 effect 逆操作撤销 scoped 注册
    await unload()
    expect(schemasOf(tools, main.agent).filter((n) => NOVEL_TOOL_NAMES.includes(n))).toEqual([])

    // 重载:stub 服务仍在 root 上,只重装 bundle 本体;agents.list 初装路径对既有主 Agent 重装
    const bundle = await import('../src')
    await root.plugin({ name: bundle.name, apply: bundle.apply })
    const after = schemasOf(tools, main.agent).filter((n) => NOVEL_TOOL_NAMES.includes(n))
    expect(after).toHaveLength(NOVEL_TOOL_NAMES.length)
    expect([...after].sort()).toEqual([...before].sort())

    // 重载后子 Agent 仍被封(初装路径对子 Agent 重挂 restrict)
    expect(schemasOf(tools, sub.agent).filter((n) => NOVEL_TOOL_NAMES.includes(n))).toEqual([])
    const subRejected = await execTool(tools, sub.agent, 'novel_select_book', { bookId: 'test-book' })
    expect(JSON.stringify(subRejected)).toContain('UNKNOWN_TOOL')
    await disposeRoot(root)
  })
})
