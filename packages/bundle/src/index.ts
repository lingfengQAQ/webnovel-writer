/**
 * 工作台 bundle（接线入口）。
 *
 * 行为规格：README.md（产品）、docs/book-format.md（格式）、docs/development.md（工程）。
 *
 * 核心功能：
 * - 装机：工作范围注册 + 书房脚手架（workspace）
 * - 书架扫描（bookshelf）
 * - 书架总览注入，选书工具回复书仓近况（status-context，N4 真源推导）
 * - 当前书路径解析（paths）
 * - 文件门禁（gates，N5 接回 gateWriteDraft，N10 ask 策略）
 * - 主 Agent persona 挂载（N6: 只装主 Agent，过滤 subagent）
 *
 * 依赖宿主面（全部经窄声明消费，防止锁死排他 dsh checkout）：
 *   systemPrompt（scoped context/section）、workspaceRegistry、agents、agent/created、
 *   tools/pre-execute。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecutionToken, ToolRuntime } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { attachFileGateToAgent } from './gates'
import { attachDraftLengthFeedbackToAgent } from './draft-length-feedback'
import { attachWorkerPolicyToAgent } from './worker-policy'
import { attachWritingDelegationToAgent, writingRoleOf } from './writing-delegation'
import { isLiveMainAgent, isWritingAgent, writingCapabilityOf, type MainAgentRegistry, type WritingCapability } from './agent-mode'
import { uniqueBookRoot, scanBooks } from './bookshelf'
import { attachStatusToAgent, type SystemPromptLike } from './status-context'
import { canonicalizePath, isFullyQualifiedPath, isInsidePath } from '@webnovel/core'
import { attachPersonaToAgent, type AgentCtxLike } from './persona'
import { createNovelTools, type NovelToolDefinition, type ToolExecContext, type AgentLike } from './novel-tools'
import type { AskFn, EmbeddingProvider } from '@webnovel/core'
import { EditorRequestHub } from './study/editor-requests'
import { attachStudyWeb, notifySaved } from './study/web'
import { StudyService } from './study/service'
import { createNativeWriteBridge, nativeToolRuntime } from './native-write'
export { nativeToolRuntime } from './native-write'
import { BookIndexManager } from './indexing/manager'
import type { SceneProvider, RerankingProvider } from '@webnovel/core'
import { indexFailureMessage } from './indexing/notifications'
import { ReferenceHost } from './reference/host'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import { createIndexAutoPreference } from './preferences-host'
import {
  DEFAULT_WEBNOVEL_PREFERENCES,
  GRAPH_PERSPECTIVES,
  VISUAL_MODES,
  WEBNOVEL_SETTINGS_NAMESPACE,
  hasExplicitAutoIndex,
  normalizeWebnovelPreferences,
  validateWebnovelPreferences,
  type WebnovelPreferencesInput,
} from './preferences'

export const name = 'webnovel-bundle'
export { NOVEL_TOOL_NAMES, NOVEL_CONDITIONAL_TOOL_NAMES, NOVEL_PRODUCTION_TOOL_NAMES } from './tool-catalog'
export {
  WEBNOVEL_SETTINGS_NAMESPACE,
  DEFAULT_WEBNOVEL_PREFERENCES,
  normalizeWebnovelPreferences,
  hasExplicitAutoIndex,
  type WebnovelPreferences,
  type WebnovelPreferencesInput,
  type VisualMode,
  type GraphPerspective,
} from './preferences'

export const PreferenceSchema: z<WebnovelPreferencesInput> = z.object({
  autoIndexOnCommit: z.boolean().description('检索 · 提交后自动更新定稿索引'),
  showVisualTab: z.boolean().default(DEFAULT_WEBNOVEL_PREFERENCES.showVisualTab).description('可视化 · 对话区标签'),
  showLayoutSwap: z.boolean().default(DEFAULT_WEBNOVEL_PREFERENCES.showLayoutSwap).description('工作台 · 布局互换按钮'),
  showIndexGuideCard: z.boolean().default(DEFAULT_WEBNOVEL_PREFERENCES.showIndexGuideCard).description('检索索引 · 引导页卡片'),
  defaultVisualMode: z.union([...VISUAL_MODES]).default(DEFAULT_WEBNOVEL_PREFERENCES.defaultVisualMode).description('可视化 · 默认子视图'),
  defaultGraphPerspective: z.union([...GRAPH_PERSPECTIVES]).default(DEFAULT_WEBNOVEL_PREFERENCES.defaultGraphPerspective).description('人物关系 · 默认视角'),
  defaultGraphShowUnknown: z.boolean().default(DEFAULT_WEBNOVEL_PREFERENCES.defaultGraphShowUnknown).description('人物关系 · 显示时间未标注'),
  defaultGraphShowPlans: z.boolean().default(DEFAULT_WEBNOVEL_PREFERENCES.defaultGraphShowPlans).description('人物关系 · 包括计划'),
})
export const Config = PreferenceSchema.volatile()

/**
 * 保留已有 Host 导出的兼容性；技能脚本从独立 lib/cli.js 加载相同实现。
 */
export { runChecksCli } from './scripts/deterministic-checks'
export { draftLengthCli } from './scripts/draft-length-cli'
/** 影响分析／材料备料／定稿备包／最小导出脚本的 CLI 能力（R21 切割）：只算不写，薄入口经 lib 调用。 */
export { analyzeImpactCli } from './scripts/impact-cli'
export { materialsCli } from './scripts/materials-cli'
export { packCli } from './scripts/pack-cli'
export { exportCli } from './scripts/export-cli'
/** 卷摘要候选脚本的 CLI 能力（任务21, 件一）：只算不写，薄入口经 lib 调用。 */
export { volumeSummaryCli } from './scripts/volume-summary-cli'

/**
 * 工作范围根（装机后由 workspace.ts 存）；未装机为 undefined。
 *
 * 审计 B5：这份状态原先是两个裸模块级变量，只增不减 —— apply 认到之后跨卸载存活，
 * 卸载再重装会继承上一轮的值，宿主换了工作范围也认不到新的；且 `root` 与 `isFallback`
 * 的一致性靠调用点的语句顺序维持。现在收成一个状态对象加一组显式操作：写入只经
 * registerWorkspaceRoot / registerFallbackRoot，清除只经 resetWorkspaceRoot，
 * 卸载由 apply 的 effect 交回（releaseWorkspaceRoot）。
 *
 * isFallback 标记的用途：headless 兜底的 cwd 须可被 workspaceRegistry 的真值覆盖 ——
 * registry 若晚于 apply 就绪（web profile 下它依赖 storageDomain / sessionPersistence），
 * 先占位的 cwd 不能把工作范围永久钉死。
 */
interface WorkspaceRootState {
  root: string | undefined
  /** 当前值是否只是 headless 兜底（进程 cwd），可被 registry 真值覆盖。 */
  isFallback: boolean
}

const workspaceRootState: WorkspaceRootState = { root: undefined, isFallback: false }

export function currentWorkspaceRoot(): string | undefined {
  return workspaceRootState.root
}

/** 认领工作范围真值（registry 路径）；覆盖兜底值。 */
export function registerWorkspaceRoot(root: string): void {
  workspaceRootState.root = canonicalizePath(root)
  workspaceRootState.isFallback = false
}

/** 认领 headless 兜底值（进程 cwd）；标记为可被真值覆盖。 */
function registerFallbackRoot(root: string): void {
  workspaceRootState.root = canonicalizePath(root)
  workspaceRootState.isFallback = true
}

/** 清空工作范围（卸载与测试共用的唯一重置入口）。 */
export function resetWorkspaceRoot(): void {
  workspaceRootState.root = undefined
  workspaceRootState.isFallback = false
}

/** 交回工作范围（仅当仍是本轮认到的那一份，避免踩掉他人后写的值）。 */
function releaseWorkspaceRoot(claimed: string | undefined): void {
  if (claimed !== undefined && workspaceRootState.root === claimed) resetWorkspaceRoot()
}

/**
 * 窄取宿主动态服务。
 *
 * 两条取法都要走：cordis 把服务混成 ctx 上的属性访问器（`ctx.tools`），
 * 而 `ctx.get(name)` 是 reflect 提供的「绕过 inject 要求」的读法
 * （cordis reflect.d.ts:115）。inject 回调收到的 scope 是 Context，属性读法
 * 一定可用；`get` 则在部分宿主表面缺席。任一条取到即算取到，两条都无则 fail-open。
 */
function ctxGet<T>(ctx: Context, name: string): T | undefined {
  const read = (ctx as { get?: (n: string) => unknown }).get
  if (typeof read === 'function') {
    try {
      const value = read.call(ctx, name) as T | undefined
      if (value !== undefined) return value
    } catch { /* 未注入的服务不能用属性访问，否则会抛 without inject。 */ }
  }
  try {
    const direct = (ctx as unknown as Record<string, unknown>)[name]
    return direct === undefined ? undefined : direct as T
  } catch { return undefined }
}

/** 窄 host 面：仅消费 on（事件订阅），避开 cordis 对 keyof Events 的类型约束。 */
interface NarrowHost {
  on?: (event: string, listener: (...args: never[]) => unknown) => unknown
}

/**
 * 依赖反应性面（审计 B6）。
 *
 * `ctx.get()` 在 apply 时刻只取一次快照：`workspaceRegistry` 在其必需依赖
 * （storageDomain / sessionPersistence）未就绪时保持 pending，那一刻取到 undefined
 * 便永不重试。`ctx.inject(deps, setup)` 是持续契约——依赖出现即跑 setup、消失即
 * 去激活，正是这里要的语义（cordis registry.d.ts:185）。
 */
interface ReactiveHost {
  inject?: (deps: readonly string[], setup: (scope: unknown) => void) => unknown
  effect?: (execute: () => unknown, label?: string) => unknown
}

/**
 * 声明依赖并在其就绪时跑 setup；无 inject 表面时退回 `ctx.get` 快照（fail-open）。
 * reactive＝是否走了反应式路径（inject 表面存在即 true，即便依赖尚未就绪——
 * 此刻快照兜底不得再跑，否则会把反应式路径已认领的值冲掉）；fiber＝inject 的
 * Fiber 句柄（dsh 运行时对齐批：保存并纳入所在 step 的 effect disposer——卸载
 * 先撤自身产物，再 dispose 注入 fiber，显式断开持续契约）。fake 宿主 inject 可
 * 返回 undefined，此时 reactive 仍为 true、fiber 为 undefined。
 */
interface FiberLike {
  dispose?(): unknown | Promise<unknown>
}

function withServices(
  ctx: Context,
  deps: readonly string[],
  setup: (scope: Context) => void,
): { reactive: boolean; fiber?: FiberLike } {
  const host = ctx as unknown as ReactiveHost
  if (typeof host.inject !== 'function') return { reactive: false }
  try {
    const fiber = host.inject(deps, (scope) => { setup((scope ?? ctx) as Context) })
    return {
      reactive: true,
      fiber: typeof fiber === 'object' && fiber !== null ? (fiber as FiberLike) : undefined,
    }
  } catch {
    return { reactive: false }
  }
}

/** 把一步装机登记为可回滚 effect；无 effect 表面时直接执行（fail-open）。 */
function step(ctx: Context, label: string, execute: () => void | (() => void)): void {
  const host = ctx as unknown as ReactiveHost
  if (typeof host.effect !== 'function') {
    execute()
    return
  }
  host.effect(() => {
    const undo = execute()
    return typeof undo === 'function' ? undo : () => {}
  }, label)
}

/** 显式书id → 书仓根（无会话上下文的全局兜底）。 */
export function bookRootOfBookId(bookId: string): string | undefined {
  const root = currentWorkspaceRoot()
  if (root === undefined) return undefined
  return uniqueBookRoot(root, bookId)
}

/**
 * 会话所附工作区的根（D10 修正，2026-09-05）：web 宿主注册表可有多条（作者的其他工作区），
 * 全局认领「注册表第一条」会与宿主会话所附工作区脱钩——工具解析不到书、门禁围错根。
 * dsh 的机械结论（R12）：workspaceRoot 由调用会话的不可变 cwd 派生——本插件的
 * 书解析/门禁/状态注入一律优先用会话 cwd，全局认领只作无会话上下文的兜底。
 */
export function agentWorkspaceRoot(agent: AgentLike | undefined): string | undefined {
  const cwd = agent?.session?.header?.cwd
  // dsh 运行时对齐批(2026-09-06):会话 cwd canonical 化——别名路径/盘符大小写/
  // `\\?\` 形态与后续门禁、书架扫描共用同一比较形态。
  if (typeof cwd === 'string' && cwd !== '') {
    return isFullyQualifiedPath(cwd) ? canonicalizePath(cwd) : undefined
  }
  return currentWorkspaceRoot()
}

/** 会话根 → 书仓（按会话解析；无会话走全局兜底）。 */
export function bookRootOfBookIdFor(bookId: string, agent: AgentLike | undefined): string | undefined {
  const root = agentWorkspaceRoot(agent)
  if (root === undefined) return undefined
  return uniqueBookRoot(root, bookId)
}

/** 子路径判定(dsh 运行时对齐批:canonical 化后比较,junction/盘符大小写别名不再误判)。 */
function inside(root: string, target: string): boolean {
  return isInsidePath(root, target)
}

/**
 * 认领工作范围（唯一来源是 workspaceRegistry —— 它自己就把记录存在存储领域里，
 * 我们不另存一份，2026-09-01 审计甲2）。可重入：依赖后到时再跑一次即认到。
 */
function claimWorkspaceRoot(
  registry: { readonly list: () => ReadonlyArray<unknown> } | undefined,
): string | undefined {
  if (registry === undefined) return undefined
  if (currentWorkspaceRoot() !== undefined && !workspaceRootState.isFallback) return undefined
  let existing: ReadonlyArray<unknown> = []
  try {
    existing = registry.list()
  } catch {
    existing = []
  }
  if (existing.length === 0) return undefined
  const root = (existing[0] as { readonly path?: string }).path
  if (typeof root !== 'string' || root === '') return undefined
  registerWorkspaceRoot(root)
  return currentWorkspaceRoot()
}

/**
 * 退回进程工作目录作为工作范围（headless 兜底）。
 *
 * 仅在 workspaceRegistry 缺席时使用：该服务只被 dsh-host-apiproxy / dsh-web-app 依赖,
 * headless profile 不装它。取到目录即认领,与 registry 路径共用 releaseWorkspaceRoot 交回。
 */
function claimProcessCwd(): string | undefined {
  if (currentWorkspaceRoot() !== undefined) return undefined
  let cwd: string
  try {
    cwd = process.cwd()
  } catch {
    return undefined
  }
  if (cwd === '') return undefined
  registerFallbackRoot(cwd)
  return currentWorkspaceRoot()
}

/** 工具执行内可见的 agent ctx 窄读面：机会性读取走 `ctx.get`（B6；属性访问在
 *  未声明 inject 的 ctx 上会抛「cannot get property without inject」）。 */
function agentCtxGet<T>(agent: AgentLike | undefined, name: string): T | undefined {
  const agentCtx = agent?.ctx as unknown as Record<string, unknown> | undefined
  if (agentCtx === undefined) return undefined
  const get = agentCtx['get']
  if (typeof get === 'function') {
    try { return get.call(agentCtx, name) as T } catch { return undefined }
  }
  const direct = agentCtx[name]
  return direct === undefined ? undefined : direct as T
}

/** Exact live identity first, then the ownership contract exposed by this host. */
function isMainAgent(agent: AgentLike): boolean {
  const registry = agentCtxGet<MainAgentRegistry>(agent, 'agents')
  if (typeof registry?.get === 'function') return isLiveMainAgent(agent, registry)
  return agent.session?.header?.origin !== 'subagent'
}

/** dsh ToolRunContext 到窄投影 ToolExecContext 的全字段透传（运行时对齐批）。 */
interface DshToolExec {
  readonly agent?: unknown
  readonly name?: string
  readonly arguments?: unknown
  readonly callId?: string
  readonly rootCallId?: string
  readonly token?: ToolExecutionToken
  readonly parent?: symbol
  readonly signal?: AbortSignal
  deferContext?(context: unknown): void
  concludeTurn?(): void
}

function toExecContext(exec: DshToolExec): ToolExecContext {
  return {
    agent: exec.agent as unknown as AgentLike | undefined,
    name: exec.name,
    arguments: exec.arguments,
    callId: exec.callId,
    rootCallId: exec.rootCallId,
    token: exec.token,
    parent: exec.parent,
    signal: exec.signal,
    deferContext: exec.deferContext?.bind(exec),
    concludeTurn: exec.concludeTurn?.bind(exec),
  }
}

export function apply(ctx: Context, entry?: ReturnType<typeof Config> | WebnovelPreferencesInput) {
  ctx.logger.info('工作台插件已加载（webnovel bundle）')
  // 预设在隔离上下文里重启，事件到不了宿主；由宿主服务上的 refresh 重算已有会话。
  let refreshInstalledAgents = async (): Promise<void> => {}
  const writingHost = {
    active: true as const,
    refresh(): Promise<void> { return refreshInstalledAgents() },
  }
  if (typeof ctx.provide === 'function') ctx.provide('webnovelHost', writingHost)
  // 每会话 agent 装机状态与工具注册产物（effect 可回滚：undo 清空）。
  const installedAgents = new Map<string, AgentLike>()
  const installedModes = new Map<string, WritingCapability | undefined>()
  const installedRoles = new Map<string, ReturnType<typeof writingRoleOf>>()
  const agentToolOffs = new Map<string, Array<() => void>>()
  const agentRestrictOffs = new Map<string, () => void>()
  let toolKit: { defs: NovelToolDefinition[]; askFn: AskFn | undefined } | undefined
  let nativeBridge: ReturnType<typeof createNativeWriteBridge> | undefined
  const referenceHost = new ReferenceHost({
    fs: agent => agentCtxGet<FileSystem>(agent, 'fs'),
    llm: agent => agentCtxGet<LlmRuntime>(agent, 'llm'),
    settings: agent => agentCtxGet<SettingsForms>(agent, 'settings'),
  })
  step(ctx, 'webnovel:reference', () => {
    const off = typeof ctx.on === 'function' ? ctx.on('llm/adapters-updated', () => referenceHost.changed()) : undefined
    return () => { if (typeof off === 'function') off(); referenceHost.close() }
  })
  const readRawPreferences = (): unknown => {
    if (entry && typeof (entry as { get?: unknown }).get === 'function') {
      try {
        const current = (entry as { get(): unknown }).get()
        if (hasExplicitAutoIndex(current)) return current
      } catch { /* fall through */ }
    } else if (hasExplicitAutoIndex(entry)) {
      return entry
    }
    return undefined
  }
  const autoPreference = createIndexAutoPreference(() => ctxGet<SettingsForms>(ctx, 'settings'), readRawPreferences)
  const indexing = new BookIndexManager({
    getProvider: () => {
      const service = typeof ctx.get === 'function' ? ctx.get('embeddings') as { current(): EmbeddingProvider | undefined } | undefined : undefined
      return service?.current()
    },
    getSceneProvider: () => (typeof ctx.get === 'function' ? ctx.get('sceneSegmentation') as { current(): SceneProvider | undefined } | undefined : undefined)?.current(),
    getGraphProvider: () => (typeof ctx.get === 'function' ? ctx.get('graphExtraction') as { current(): import('@webnovel/core').GraphModelProvider | undefined } | undefined : undefined)?.current(),
    autoPreference,
    workspaces: () => {
      const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') as { list(): readonly { path?: string }[] } | undefined : undefined
      return [...(typeof registry?.list === 'function' ? registry.list() : []).flatMap(workspace => workspace.path ? [workspace.path] : []),
        ...[...installedAgents.values()].filter(agent => isMainAgent(agent) && isWritingAgent(agent)).flatMap(agent => { const root = agentWorkspaceRoot(agent); return root ? [root] : [] })]
    },
    notify: (book, notice) => {
      const registry = typeof ctx.get === 'function' ? ctx.get('agents') as { get(id: string): AgentLike | undefined } | undefined : undefined
      const agent = notice.sessionId === undefined ? undefined : registry?.get(notice.sessionId)
      if (!agent || !isMainAgent(agent) || !isWritingAgent(agent) || !agent.session?.header || typeof (agent as { followup?: unknown }).followup !== 'function') return false
      if (bookRootOfBookIdFor(book.bookId, agent) !== book.root) return false
      return notifySaved(agent as Parameters<typeof notifySaved>[0], indexFailureMessage(book, notice)).notification === 'delivered'
    },
  })
  step(ctx, 'webnovel:indexing', () => () => indexing.close())
  step(ctx, 'webnovel:preferences', () => {
    const host = ctx as unknown as NarrowHost
    const offs: Array<() => void> = []
    if (typeof host.on === 'function') {
      const offValidate = host.on('internal/config', ((fiber: unknown, next: () => unknown) => {
        const raw = next()
        if (fiber === (ctx as { fiber?: unknown }).fiber) validateWebnovelPreferences(raw)
        return raw
      }) as never)
      if (typeof offValidate === 'function') offs.push(offValidate as () => void)
      const offVolatile = host.on('loader/volatile-update', (() => {
        void indexing.refresh()
      }) as never)
      if (typeof offVolatile === 'function') offs.push(offVolatile as () => void)
      const offDoc = host.on('settings/document-updated', ((ns: unknown) => {
        if (ns === WEBNOVEL_SETTINGS_NAMESPACE) void indexing.refresh()
      }) as never)
      if (typeof offDoc === 'function') offs.push(offDoc as () => void)
    }
    const settingsReg = withServices(ctx, ['settings'], (scope) => {
      const settings = ctxGet<{ configure?: (presentation: { auto: boolean }, owner?: unknown) => () => void }>(scope, 'settings')
      if (typeof settings?.configure !== 'function') return
      step(scope, 'webnovel:settings-presentation', () => {
        try {
          return settings.configure!({ auto: false }, (ctx as { fiber?: unknown }).fiber)
        } catch {
          return undefined
        }
      })
    })
    return () => {
      for (const off of offs.reverse()) off()
      void settingsReg.fiber?.dispose?.()
    }
  })
  const editorRequests = new EditorRequestHub()
  attachStudyWeb(ctx, indexing, editorRequests)

  /** 就绪时建一次工具集（裁决通道取自宿主 userQuestions；缺则 askFn undefined，
   *  沉淀 fail-closed——裁决 14）。依赖出现由 inject 反应式驱动。 */
  function ensureToolKit(scope: Context): void {
    if (toolKit !== undefined) return
    const questions = ctxGet<{ readonly ask?: AskFn }>(scope, 'userQuestions')
    const askFn = typeof questions?.ask === 'function' ? questions.ask.bind(questions) : undefined
    const runtime = ctxGet<ToolRuntime>(scope, 'tools')
    nativeBridge = runtime !== undefined && typeof runtime.execute === 'function' ? createNativeWriteBridge(nativeToolRuntime(scope)) : undefined
    const bridge = nativeBridge
    step(scope, 'native-write', () => () => { bridge?.dispose() })
    toolKit = {
      askFn,
      defs: createNovelTools({
        referenceHost,
        workspaceRoot: (agent) => agentWorkspaceRoot(agent),
        bookRootOfBookId: (bookId, agent) => bookRootOfBookIdFor(bookId, agent),
        askFn,
        nativeWrite: bridge?.write,
        // 测试/走查专用工具(seed 占位设计)只在显式开启时注册,作者环境看不到
        testTools: process.env['WEBNOVEL_TEST_TOOLS'] === '1',
        editorRequests,
        embeddingProvider: agent => agent === undefined ? undefined : agentCtxGet<{ current(): EmbeddingProvider | undefined }>(agent, 'embeddings')?.current(),
        rerankingProvider: agent => agent === undefined ? undefined : agentCtxGet<{ current(): RerankingProvider | undefined }>(agent, 'reranking')?.current(),
        indexManage: (bookId, action, agent, chapter) => {
          const workspace = agentWorkspaceRoot(agent)
          if (!workspace) throw new Error('当前主会话没有有效工作范围')
          const book = new StudyService(workspace).indexBook('book:' + bookId)
          return action === 'status' ? indexing.status(book) : indexing.control(book, action, agent.session?.header?.id ?? agent.id, chapter)
        },
      }),
    }
  }

  /** 主 Agent scoped 注册（E1/E2 落码）：经 agent 的 scope 层注册，对该 agent
   *  与其后代可见，兄弟 agent 不可见；off 收进 agentToolOffs 随插件卸载撤销。 */
  function registerToolsInto(agent: AgentLike): boolean {
    if (!isWritingAgent(agent)) return false
    if (toolKit === undefined) return false
    if (agentToolOffs.has(agent.id)) return true
    const registry = agentCtxGet<ToolRuntime>(agent, 'tools')
    if (registry === undefined || typeof registry.register !== 'function') return false
    const offs: Array<() => void> = []
    for (const tool of toolKit.defs) {
      const off = registry.register({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        output: tool.output,
        execute: async (args, exec) => tool.execute(args as Record<string, unknown>, toExecContext(exec)),
      })
      if (typeof off === 'function') offs.push(off)
    }
    agentToolOffs.set(agent.id, offs)
    ctx.logger.info(`[webnovel-bundle] 已为主控（${agent.id}）scoped 注册 ${toolKit.defs.length} 个业务工具${toolKit.askFn === undefined ? '（裁决通道缺失，定稿沉淀不可用）' : ''}。`)
    return true
  }

  /** 撤销全部 scoped 注册与 restrict（幂等；重复 off 对 cordis 是 no-op）。 */
  function disposeAllAgentTools(): void {
    for (const offs of agentToolOffs.values()) {
      for (const off of offs.reverse()) { try { off() } catch { /* 幂等清理 */ } }
    }
    agentToolOffs.clear()
    for (const off of agentRestrictOffs.values()) { try { off() } catch { /* 幂等清理 */ } }
    agentRestrictOffs.clear()
  }

  /** 子 Agent restrict（E2）：deny 名单须是子 Agent 当前可见面的已知名字，
   *  工具尚未注册到祖先层时 restrict 会抛「未知名字」——此时返回 false，
   *  由第三步反应式驱动在工具面就绪后重挂（registerAllInstalled 尾部）。 */
  function restrictNovelToolsInto(agent: AgentLike): boolean {
    if (!isWritingAgent(agent) && writingRoleOf(agent) === undefined) return false
    if (toolKit === undefined) return false
    if (agentRestrictOffs.has(agent.id)) return true
    const tools = agentCtxGet<{ restrict?: (filter: { deny?: readonly string[] }) => () => void }>(agent, 'tools')
    if (typeof tools?.restrict !== 'function') return false
    try {
      // deny 取实际注册集:走查开启的测试工具同样对子 Agent 不可见,未注册的名字不进名单
      const offRestrict = tools.restrict({ deny: toolKit.defs.map((tool) => tool.name) })
      if (typeof offRestrict === 'function') agentRestrictOffs.set(agent.id, offRestrict)
      return true
    } catch (err) {
      ctx.logger.warn(`[webnovel-bundle] 子代理工具 restrict 暂不可挂（${agent.id}）：${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  // 第一步：认领工作范围。经 inject 声明而非 apply 时刻快照（审计 B6）——
  // workspaceRegistry 在其必需依赖（storageDomain / sessionPersistence）不可用时保持
  // pending，快照那一刻取到 undefined 便永不重试，工作范围就永远认不到（dsh
  // workspace.zh.md 明言「持久化这一依赖不可用时插件保持 pending，而不是把这种不可用
  // 误当作空历史」）。
  step(ctx, 'webnovel:workspace-root', () => {
    let claimed: string | undefined
    const reg = withServices(ctx, ['workspaceRegistry'], (scope) => {
      step(scope, 'webnovel:workspace-generation', () => {
        const generation = claimWorkspaceRoot(ctxGet(scope, 'workspaceRegistry'))
        if (generation !== undefined) claimed = generation
        return () => { releaseWorkspaceRoot(generation) }
      })
    })
    if (!reg.reactive) claimed = claimWorkspaceRoot(ctxGet(ctx, 'workspaceRegistry'))
    // headless 兜底：workspaceRegistry 只被 dsh-host-apiproxy / dsh-web-app 依赖,
    // 是 web profile 独有服务。headless 下它永不出现,inject 的 setup 永不执行,
    // 上面两条都认不到 —— 工作范围永远为空,状态注入返回空串被组装侧过滤,总览静默缺席
    // （2026-09-01 真机实证）。照 dsh 自己 launchEnvironmentOf 的形状退回进程默认。
    if (currentWorkspaceRoot() === undefined) claimed = claimProcessCwd()
    return () => {
      releaseWorkspaceRoot(claimed)
      void reg.fiber?.dispose?.()
    }
  })

  // 第二步：agent 出现时按需安装 status context 与文件门禁（per-agent scoped）。
  // 每个 agent 的注册都把注销函数收进 attached，随本步 effect 逆操作一起交回（审计 B2）。
  step(ctx, 'webnovel:agent-attach', () => {
    const host = ctx as unknown as NarrowHost
    if (typeof host.on !== 'function') return
    let open = true
    const subscriptions: Array<() => void> = []
    const attachments = new Map<string, Array<() => void | Promise<void>>>()
    const detachJobs = new Set<Promise<void>>()
    const detachAgent = (agent: AgentLike): Promise<void> => {
      if (installedAgents.get(agent.id) !== agent) return Promise.resolve()
      installedAgents.delete(agent.id)
      installedModes.delete(agent.id)
      installedRoles.delete(agent.id)
      const offs = [
        ...(agentToolOffs.get(agent.id) ?? []),
        ...(attachments.get(agent.id) ?? []),
        ...(agentRestrictOffs.has(agent.id) ? [agentRestrictOffs.get(agent.id)!] : []),
      ]
      agentToolOffs.delete(agent.id)
      agentRestrictOffs.delete(agent.id)
      attachments.delete(agent.id)
      const pending: Array<Promise<unknown>> = []
      for (const off of offs.reverse()) {
        try {
          const result = off()
          if (result !== undefined && typeof (result as Promise<unknown>).then === 'function') pending.push(result as Promise<unknown>)
        } catch (err) {
          ctx.logger.warn(`[webnovel-bundle] Agent 卸载失败（${agent.id}）：${err instanceof Error ? err.message : String(err)}`)
        }
      }
      const job = Promise.all(pending).then(() => undefined, (err: unknown) => {
        ctx.logger.warn(`[webnovel-bundle] Agent 卸载失败（${agent.id}）：${err instanceof Error ? err.message : String(err)}`)
      })
      detachJobs.add(job)
      void job.finally(() => detachJobs.delete(job))
      return job
    }
    const installFor = (agent: AgentLike, disableWriting = false): void => {
      if (!open) return
      const capability = disableWriting ? undefined : writingCapabilityOf(agent)
      const isSubagent = !isMainAgent(agent)
      const role = disableWriting || !isSubagent ? undefined : writingRoleOf(agent)
      const agentId = agent.id
      const agentCtx = agent.ctx as (Context & { readonly systemPrompt?: SystemPromptLike }) | undefined
      if (agentCtx === undefined) return
      // 幂等：agent/created 与 agents.list() 初装可能重叠；卸载重装时 map 已清空。
      const previous = installedAgents.get(agentId)
      const previousMode = installedModes.get(agentId)?.mode ?? 'plain'
      const nextMode = capability?.mode ?? 'plain'
      if (previous === agent && previousMode === nextMode && installedRoles.get(agentId) === role) return
      if (previous !== undefined) void detachAgent(previous)
      installedAgents.set(agentId, agent)
      installedModes.set(agentId, capability)
      installedRoles.set(agentId, role)
      const attached: Array<() => void | Promise<void>> = []
      attachments.set(agentId, attached)

      // origin 是持久化历史；服务按当前活体归属区分主控与受委派者。
      // D10：本 agent 会话所附工作区根（会话 cwd 优先，全局认领兜底）。
      const rootOf = (): string | undefined => agentWorkspaceRoot(agent)
      if (capability !== undefined && !isSubagent) {
        const workspace = rootOf()
        if (workspace) indexing.addWorkspace(workspace)
        // 主 Agent persona（轻适配：scoped shadow deployment:persona-prefix，不压 dsh 原生指引段）。
        // 每件挂载独立容错（运行时对齐批）：单件失败只 warn，不中断装机序列、不拖垮工具/门禁。
        try {
          const offPersona = attachPersonaToAgent(agentCtx as unknown as AgentCtxLike, undefined, { logger: ctx.logger })
          if (offPersona !== undefined) attached.push(offPersona)
        } catch (err) {
          ctx.logger.warn(`[webnovel-bundle] persona 挂载失败（${agentId}）：${err instanceof Error ? err.message : String(err)}`)
        }
        // 书架总览——经 agent.ctx 挂 scoped systemPrompt.context。
        try {
          const offStatus = attachStatusToAgent(agentCtx, { workspaceRoot: rootOf })
          if (offStatus !== undefined) attached.push(offStatus)
        } catch (err) {
          ctx.logger.warn(`[webnovel-bundle] 状态注入挂载失败（${agentId}）：${err instanceof Error ? err.message : String(err)}`)
        }
        // 主 Agent scoped 工具注册（toolKit 未就绪时由第三步反应式补装）。
        registerToolsInto(agent)
        const offDelegation = attachWritingDelegationToAgent(agent)
        if (offDelegation !== undefined) attached.push(offDelegation)
      } else if (isSubagent && (capability !== undefined || role !== undefined)) {
        // 子 Agent 运行时全封（E2＋R8，运行时对齐批）：
        // ① tools.restrict({deny}) 收掉小说工具继承面；原生工具面由预设和角色策略分配；
        //    工具面未就绪时由第三步反应式补挂；
        // ② 原生 subagent 在委派时固定审批策略；插件不再改写会话策略；
        // ③ userQuestions 由 dsh 原生 DELEGATED_CALLER 拒绝，无需插件处理。
        restrictNovelToolsInto(agent)
        const offWorker = role === undefined ? undefined : attachWorkerPolicyToAgent(agent, role)
        if (offWorker !== undefined) attached.push(offWorker)
      }

      // 文件门禁（无论主 Agent 还是子 Agent 均挂载门禁，确保写入边界）
      const offGate = attachFileGateToAgent(agentCtx as unknown as { readonly on?: (event: string, listener: (...args: never[]) => unknown) => unknown }, {
        trustedNativeWrite: (exec) => nativeBridge?.allows(exec) === true,
        bookRootOfId: (bookId) => {
          const root = rootOf()
          if (root === undefined) return undefined
          return uniqueBookRoot(root, bookId)
        },
        bookRootForAbs: (abs) => {
          const root = rootOf()
          if (root === undefined) return undefined
          return scanBooks(root).find((b) => inside(b.root, abs))?.root
        },
        workspaceRoot: rootOf,
        managedWorkspaces: () => {
          const registry = ctxGet<{ list(): readonly { path?: string }[] }>(ctx, 'workspaceRegistry')
          return registry?.list().flatMap(workspace => workspace.path ? [workspace.path] : []) ?? []
        },
        resolveTarget: async (target, exec) => {
          const caller = exec.agent as AgentLike | undefined
          const filesystem = agentCtxGet<FileSystem>(caller, 'fs')
          if (filesystem === undefined) return undefined
          const policy = filesystem.sandboxMode === undefined ? undefined
            : agentCtxGet<{ resolve(input: { session?: unknown }): { workspaceRoot: string } }>(caller, 'sandboxPolicy')
          if (filesystem.sandboxMode !== undefined && policy === undefined) throw new Error('文件沙箱策略尚未就绪')
          const directories = agentCtxGet<{ ensure(agent: unknown, signal?: AbortSignal): Promise<string> }>(caller, 'workingDirectory')
          if (directories === undefined || caller === undefined) throw new Error('DSH 工作目录服务尚未就绪')
          const cwd = await directories.ensure(caller, exec.signal)
          const resolved = await filesystem.resolve(target, {
            cwd, ...(exec.signal === undefined ? {} : { signal: exec.signal }),
          })
          return isFullyQualifiedPath(resolved.displayPath) ? canonicalizePath(resolved.displayPath) : undefined
        },
      })
      if (offGate === undefined) ctx.logger.warn(`[webnovel-bundle] 文件门禁未挂载（${agentId}）。`)
      else attached.push(offGate)
      const offLength = capability === undefined && role === undefined ? undefined : attachDraftLengthFeedbackToAgent(agentCtx as unknown as Parameters<typeof attachDraftLengthFeedbackToAgent>[0], {
        agent, workspaceRoot: rootOf, warn: message => ctx.logger.warn(message),
      })
      if (offLength !== undefined) attached.push(offLength)
    }
    refreshInstalledAgents = async () => {
      if (!open) return
      for (const agent of [...installedAgents.values()]) installFor(agent)
      await Promise.all(detachJobs)
    }

    const offCreated = host.on('agent/created', ((payload: { readonly agent?: AgentLike }) => {
      const agent = payload?.agent
      if (agent !== undefined) installFor(agent)
    }) as never)
    if (typeof offCreated === 'function') subscriptions.push(offCreated as () => void)
    const offDisposed = host.on('agent/disposed', ((payload: { readonly agent?: AgentLike }) => {
      if (payload?.agent !== undefined) detachAgent(payload.agent)
    }) as never)
    if (typeof offDisposed === 'function') subscriptions.push(offDisposed as () => void)

    // 初装：现有 agents（同样经 inject 声明，agents 后到亦能补装）。
    const attachExisting = (scope: Context): void => {
      const agents = ctxGet<{ readonly list: () => ReadonlyArray<unknown> }>(scope, 'agents')
      if (agents === undefined) return
      for (const a of agents.list() as ReadonlyArray<AgentLike>) installFor(a)
    }
    const offPreset = host.on('agent-preset/selected', ((sessionId: string) => {
      for (const agent of [...installedAgents.values()]) {
        if (agent.id === sessionId || agent.session?.header?.id === sessionId) installFor(agent)
      }
    }) as never)
    if (typeof offPreset === 'function') subscriptions.push(() => offPreset())
    const offCapability = host.on('webnovel/writing-capability-updated', (() => {
      for (const agent of [...installedAgents.values()]) installFor(agent)
    }) as never)
    if (typeof offCapability === 'function') subscriptions.push(() => offCapability())
    const presetReg = withServices(ctx, ['agentPresets'], scope => {
      attachExisting(scope)
      step(scope, 'webnovel:preset-generation', () => () => {
        for (const agent of [...installedAgents.values()]) installFor(agent, true)
      })
    })
    const agentsReg = withServices(ctx, ['agents'], attachExisting)
    if (!agentsReg.reactive) attachExisting(ctx)

    return async () => {
      open = false
      refreshInstalledAgents = async () => {}
      for (const off of subscriptions.reverse()) off()
      await Promise.all([...installedAgents.values()].map(agent => detachAgent(agent)))
      await Promise.all(detachJobs)
      disposeAllAgentTools()
      await agentsReg.fiber?.dispose?.()
      await presetReg.fiber?.dispose?.()
    }
  })

  // 第三步：小说工具集构建＋主 Agent scoped 注册的反应式驱动（E1：不再根注册）。
  // tools/userQuestions 后到即建 kit 并对已装机主 Agent 补注册；每个工具的注销
  // 收进 agentToolOffs，随本步 effect 逆操作（以及 agent-attach 的兜底清理）交回。
  step(ctx, 'webnovel:tools-register', () => {
    const registerAllInstalled = (scope: Context): void => {
      // 注册落在 Agent scope，须显式归还给本次依赖生命周期；依赖重启重建工具集。
      step(scope, 'webnovel:tools-generation', () => {
        ensureToolKit(scope)
        refreshInstalledAgents()
        for (const agent of installedAgents.values()) {
          if (isMainAgent(agent)) registerToolsInto(agent)
        }
        // 工具面就绪后再挂子 Agent restrict（deny 名单须可见）。
        for (const agent of installedAgents.values()) {
          if (!isMainAgent(agent)) restrictNovelToolsInto(agent)
        }
        return () => {
          disposeAllAgentTools()
          toolKit = undefined
        }
      })
    }
    const toolsReg = withServices(ctx, ['tools', 'userQuestions'], registerAllInstalled)
    if (!toolsReg.reactive) registerAllInstalled(ctx)
    return () => {
      disposeAllAgentTools()
      void toolsReg.fiber?.dispose?.()
    }
  })

  refreshInstalledAgents()

  // 第四步：环境自检（有书时总览可用）。
  step(ctx, 'webnovel:self-check', () => {
    const root = currentWorkspaceRoot()
    if (root === undefined) return
    const books = scanBooks(root)
    ctx.logger.info(`[webnovel-bundle] 工作范围已注册：${root}（${books.length} 本书）`)
  })
  void indexing.refresh()
}
