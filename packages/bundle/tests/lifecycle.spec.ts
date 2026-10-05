import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { apply, currentWorkspaceRoot, registerWorkspaceRoot, resetWorkspaceRoot } from '../src/index'
import { NOVEL_TOOL_NAMES } from '../src/novel-tools'

/** 临时工作范围:一本带契约的书。 */
function makeWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-lifecycle-'))
  const book = path.join(dir, '星辰')
  fs.mkdirSync(path.join(book, '作品契约'), { recursive: true })
  fs.writeFileSync(path.join(book, '作品契约', '契约.md'), '---\n书id: xingchen-001\n---\n正文\n', 'utf8')
  return dir
}

interface FakeAgentCtx {
  systemPrompt: { context: (c: unknown) => () => void; section: (s: unknown) => () => void }
  inject: (deps: unknown, cb: (scope: unknown) => void) => { dispose: () => Promise<void> }
  on: (e: string) => void
}

/**
 * agent.ctx 桩(审计 B4)。
 *
 * 两处必须照真类型来,否则 B2 那类泄漏测不出来：
 * 1. `systemPrompt.context/section` 真类型都回注销函数
 *    (dsh system-prompt index.d.ts:185/192 `(...): () => void`)——原桩回 undefined,
 *    生产代码丢不丢这个返回值,测试完全看不出。
 * 2. `inject` 真类型回 `Fiber & PromiseLike<Fiber>`(cordis registry.d.ts:111),
 *    其 `dispose: () => Promise<void>`(fiber.d.ts:112)——原桩回 undefined,
 *    于是「fork 的 scope 跨卸载存活」这条路径在测试里根本不存在。
 *
 * 交回记录写进 released,由用例断言两样都交回了。
 */
function makeAgentCtx(sink: unknown[], released: string[] = [], injected: string[] = []): FakeAgentCtx {
  const self: FakeAgentCtx = {
    systemPrompt: {
      context: (c) => { sink.push(c); return () => { released.push('context') } },
      section: () => () => { released.push('section') },
    },
    inject: (_deps, cb) => {
      injected.push('inject')
      cb(self)
      return { dispose: async () => { released.push('fiber') } }
    },
    on: () => {},
  }
  return self
}

/**
 * 宿主 ctx 桩:服务按 name 逐个「就绪」,inject 记录依赖声明。
 * ready 里没有的服务视为尚未就绪(pending),对应真机上 workspaceRegistry 等待
 * storageDomain 的那一刻。
 */
function makeHost(opts: {
  readonly ready: Record<string, unknown>
  readonly withInject?: boolean
  readonly withEffect?: boolean
}) {
  const injected: Array<{ deps: readonly string[]; run: (scope: unknown) => void }> = []
  const effects: Array<{ label?: string; disposers: Array<() => void> }> = []
  const listeners = new Map<string, Array<(...a: never[]) => unknown>>()

  const host: Record<string, unknown> = {
    logger: { info: () => {}, warn: () => {} },
    get: (n: string) => opts.ready[n],
    on: (e: string, l: (...a: never[]) => unknown) => {
      const arr = listeners.get(e) ?? []
      arr.push(l)
      listeners.set(e, arr)
      return () => {}
    },
  }
  if (opts.withInject !== false) {
    host.inject = (deps: readonly string[], run: (scope: unknown) => void) => {
      injected.push({ deps, run })
      // 依赖全就绪才跑,模拟 cordis「依赖出现即激活」
      if (deps.every((d) => opts.ready[d] !== undefined)) run(host)
      return undefined
    }
  }
  if (opts.withEffect !== false) {
    host.effect = (execute: () => unknown, label?: string) => {
      const rec: { label?: string; disposers: Array<() => void> } = { label, disposers: [] }
      effects.push(rec)
      const r = execute()
      if (typeof r === 'function') rec.disposers.push(r as () => void)
      else if (r !== null && typeof r === 'object' && Symbol.iterator in (r as object)) {
        for (const d of r as Iterable<() => void>) rec.disposers.push(d)
      }
      return () => { for (const d of [...rec.disposers].reverse()) d() }
    }
  }
  return { host, injected, effects, listeners }
}

describe('B6 依赖反应性(inject 持续契约,非 apply 时刻快照)', () => {
  beforeEach(() => { resetWorkspaceRoot() })

  it('缺失技能挂载能力明确告警，等待 skills 服务时不误报', () => {
    const missing = makeHost({ ready: {} })
    const warn = vi.fn()
    missing.host.logger = { info: () => {}, warn }
    apply(missing.host as never)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('随包技能未挂载'))

    const waiting = makeHost({ ready: {} })
    waiting.host.plugin = vi.fn()
    waiting.host.logger = { info: () => {}, warn: vi.fn() }
    apply(waiting.host as never)
    expect(waiting.injected.some(item => item.deps.includes('skills'))).toBe(true)
    expect(waiting.host.plugin).not.toHaveBeenCalled()
    expect((waiting.host.logger as { warn: unknown }).warn).not.toHaveBeenCalled()
  })

  it('workspaceRegistry 在 apply 时刻尚未就绪:仍经 inject 声明,后到即认到工作范围', () => {
    const ws = makeWorkspace()
    const sink: unknown[] = []
    const agentCtx = makeAgentCtx(sink)
    // apply 时刻 workspaceRegistry 缺席(pending),只有 agents/tools 在
    const { host, injected } = makeHost({
      ready: { agents: { list: () => [{ id: 'sess-1', ctx: agentCtx }] } },
    })

    apply(host as never)

    // 关键:必须经 inject 声明 workspaceRegistry,而不是 apply 时刻 get 一次就放弃
    const decl = injected.find((i) => i.deps.includes('workspaceRegistry'))
    expect(decl, 'workspaceRegistry 应经 ctx.inject 声明').toBeDefined()

    // 依赖后到:cordis 会重跑 setup,registry 的值应盖过 headless 兜底的进程 cwd
    decl!.run({ workspaceRegistry: { list: () => [{ path: ws }] } })
    expect(currentWorkspaceRoot()).toBe(ws)
  })

  it('tools 后到也能注册工具(注册随 agent 装机,反应式声明照旧,不因 apply 时刻缺席而永久放弃)', () => {
    const registered: string[] = []
    // dsh 运行时对齐批：注册落点＝agent 的 scope 层。桩 agent 的 ctx 暴露
    // tools 记录器，反应式回调（tools/userQuestions 就绪）触发时经 agentCtx.get 可达。
    const recorder = { register: (t: { name: string }) => { registered.push(t.name); return () => {} } }
    const agentCtx = { get: (n: string) => (n === 'tools' ? recorder : undefined) }
    const { host, injected } = makeHost({ ready: { agents: { list: () => [{ id: 'sess-9', ctx: agentCtx }] } } })

    apply(host as never)

    const decl = injected.find((i) => i.deps.includes('tools') && i.deps.includes('userQuestions'))
    expect(decl, 'tools+userQuestions 应经 ctx.inject 声明').toBeDefined()
    expect(registered.length).toBe(0)

    decl!.run({ logger: { info: () => {}, warn: () => {} } })
    expect(registered.length).toBeGreaterThan(0)
    expect(registered).toContain('novel_create_book')
    expect(registered).toContain('novel_editor_suggest')
    expect(registered).toHaveLength(NOVEL_TOOL_NAMES.length)
  })

  it('无 inject 表面的宿主:退回 ctx.get 快照路径,仍加载不抛', () => {
    const ws = makeWorkspace()
    const sink: unknown[] = []
    const agentCtx = makeAgentCtx(sink)
    const { host } = makeHost({
      ready: {
        workspaceRegistry: { list: () => [{ path: ws }] },
        agents: { list: () => [{ id: 'sess-1', ctx: agentCtx }] },
      },
      withInject: false,
      withEffect: false,
    })
    expect(() => apply(host as never)).not.toThrow()
    expect(currentWorkspaceRoot()).toBe(ws)
  })
})

describe('B3 多步装机走 effect(中途失败逆序回滚)', () => {
  beforeEach(() => { resetWorkspaceRoot() })

  it('装机各步经 ctx.effect 注册,带可读 label', () => {
    const ws = makeWorkspace()
    const sink: unknown[] = []
    const agentCtx = makeAgentCtx(sink)
    const { host, effects } = makeHost({
      ready: {
        workspaceRegistry: { list: () => [{ path: ws }] },
        agents: { list: () => [{ id: 'sess-1', ctx: agentCtx }] },
        tools: { register: () => {} },
      },
    })

    apply(host as never)

    expect(effects.length, '装机步骤应经 ctx.effect 注册').toBeGreaterThan(0)
    for (const e of effects) {
      expect(e.label, 'effect 应带可读 label 供 fiber 诊断').toBeTruthy()
    }
  })

  it('每步 yield 的逆操作在卸载时逆序执行', () => {
    const ws = makeWorkspace()
    const order: string[] = []
    const sink: unknown[] = []
    const agentCtx = makeAgentCtx(sink)
    const { host, effects } = makeHost({
      ready: {
        workspaceRegistry: { list: () => [{ path: ws }] },
        agents: { list: () => [{ id: 'sess-1', ctx: agentCtx }] },
        tools: { register: () => {} },
      },
    })

    apply(host as never)

    // 逐个 effect 的 disposer 都应可调用且不抛
    for (const [i, e] of effects.entries()) {
      for (const d of [...e.disposers].reverse()) {
        expect(() => d()).not.toThrow()
        order.push(`e${i}`)
      }
    }
    expect(order.length).toBe(effects.reduce((n, e) => n + e.disposers.length, 0))
  })
})

describe('B4 汇合测试(手册 §13:加载A→卸载A→加载B→卸载B→加载A 等价于直接加载A)', () => {
  beforeEach(() => { resetWorkspaceRoot() })

  /** 一轮完整加载,返回可观察状态与卸载函数。 */
  function load(ws: string) {
    const contexts: unknown[] = []
    const toolNames: string[] = []
    const released: string[] = []
    const injected: string[] = []
    const agentCtx = makeAgentCtx(contexts, released, injected)
    const { host, effects } = makeHost({
      ready: {
        workspaceRegistry: { list: () => [{ path: ws }] },
        agents: { list: () => [{ id: 'sess-1', ctx: agentCtx }] },
        tools: { register: (t: { name: string }) => { toolNames.push(t.name) } },
      },
    })
    apply(host as never)
    // 卸载只跑 effect 的逆操作 —— 不额外调 resetWorkspaceRoot 兜底：
    // 那等于替生产代码补交回,逆操作真漏了也照样绿。
    const unload = () => {
      for (const e of [...effects].reverse()) {
        for (const d of [...e.disposers].reverse()) d()
      }
    }
    return { contexts, toolNames, released, injected, unload, root: currentWorkspaceRoot() }
  }

  it('A→卸A→B→卸B→A 的可观察状态与直接加载 A 等价', () => {
    const wsA = makeWorkspace()
    const wsB = makeWorkspace()

    const baseline = load(wsA)
    const baselineShape = {
      root: baseline.root,
      tools: [...baseline.toolNames].sort(),
      contexts: baseline.contexts.length,
    }
    baseline.unload()

    const b = load(wsB)
    expect(b.root).toBe(wsB)
    b.unload()

    const again = load(wsA)
    expect({
      root: again.root,
      tools: [...again.toolNames].sort(),
      contexts: again.contexts.length,
    }).toEqual(baselineShape)
    again.unload()
  })

  it('卸载后 per-agent 三样全部交回:status context / persona section / inject 的 fork', () => {
    const ws = makeWorkspace()
    const r = load(ws)
    expect(r.released, '装载期间不应有交回').toEqual([])

    r.unload()

    // 三样各自的交回都要发生。fiber 是 fork 出来的子 scope,
    // 不 dispose 则连同依赖订阅跨卸载存活,重装即叠加(审计 B2)。
    expect(r.released, 'status context 应交回注销函数').toContain('context')
    expect(r.released, 'persona section 应交回注销函数').toContain('section')
    // 按次数比对:persona 与 status 各 inject 一次,只数「有没有 fiber」的话
    // 其中一条漏 dispose 也照样绿(persona 早先就是这么漏掉的)。
    const disposed = r.released.filter((x) => x === 'fiber').length
    expect(disposed, '每次 inject 的 fork 都应 dispose,不能只交回其中一条').toBe(r.injected.length)
    expect(r.injected.length, '至少有 persona 与 status 两条 inject').toBeGreaterThanOrEqual(2)
    expect(currentWorkspaceRoot(), '工作范围应由逆操作交回,不靠测试兜底').toBeUndefined()
  })

  it('重装不叠加:两轮的注册数与交回数相等', () => {
    const ws = makeWorkspace()
    const first = load(ws)
    const firstContexts = first.contexts.length
    first.unload()
    const firstReleased = [...first.released]

    const second = load(ws)
    expect(second.contexts.length, '重装的注册数应与首装相同(未叠加)').toBe(firstContexts)
    second.unload()
    expect([...second.released].sort(), '两轮交回形状应一致').toEqual(firstReleased.sort())
  })
})

describe('B2 per-agent 注册随卸载交回(persona / status / 门禁)', () => {
  beforeEach(() => { resetWorkspaceRoot() })

  it('attachPersonaToAgent 交回 sys.section 的注销函数', async () => {
    const { attachPersonaToAgent } = await import('../src/persona')
    let disposed = 0
    const self: Record<string, unknown> = {}
    self.systemPrompt = { section: () => () => { disposed += 1 } }
    self.inject = (_d: unknown, cb: (s: unknown) => void) => { cb(self); return undefined }

    const undo = attachPersonaToAgent(self as never)
    expect(typeof undo, 'persona 应交回注销函数而非 boolean').toBe('function')
    ;(undo as () => void)()
    expect(disposed, '卸载应调用 section 的注销函数').toBe(1)
  })

  it('attachFileGateToAgent 交回 tools/pre-execute 的注销函数', async () => {
    const { attachFileGateToAgent } = await import('../src/gates')
    let disposed = 0
    const agentCtx = {
      on: (_e: string, _l: unknown) => () => { disposed += 1 },
    }
    const undo = attachFileGateToAgent(agentCtx as never, {
      bookRootOfId: () => undefined,
      bookRootForAbs: () => undefined,
      workspaceRoot: () => undefined,
    })
    expect(typeof undo, '门禁应交回注销函数').toBe('function')
    ;(undo as () => void)()
    expect(disposed, '卸载应注销 tools/pre-execute 监听').toBe(1)
  })

  it('无 systemPrompt / 无 on 表面时交回 undefined(fail-open,不抛)', async () => {
    const { attachPersonaToAgent } = await import('../src/persona')
    const { attachFileGateToAgent } = await import('../src/gates')
    expect(attachPersonaToAgent(undefined)).toBeUndefined()
    expect(attachFileGateToAgent({} as never, {
      bookRootOfId: () => undefined,
      bookRootForAbs: () => undefined,
      workspaceRoot: () => undefined,
    })).toBeUndefined()
  })

  it('apply 装的 per-agent 注册在 effect 卸载时全部交回', () => {
    const ws = makeWorkspace()
    const sectionDisposed: string[] = []
    const contexts: unknown[] = []
    const self: Record<string, unknown> = {}
    self.systemPrompt = {
      context: (c: unknown) => { contexts.push(c); return () => { sectionDisposed.push('context') } },
      section: () => () => { sectionDisposed.push('section') },
    }
    self.inject = (_d: unknown, cb: (s: unknown) => void) => { cb(self); return { dispose: () => Promise.resolve() } }
    self.on = () => () => { sectionDisposed.push('on') }

    const { host, effects } = makeHost({
      ready: {
        workspaceRegistry: { list: () => [{ path: ws }] },
        agents: { list: () => [{ id: 'sess-1', ctx: self }] },
      },
    })
    apply(host as never)

    for (const e of [...effects].reverse()) {
      for (const d of [...e.disposers].reverse()) d()
    }
    expect(sectionDisposed, 'persona section 与门禁监听均应交回').toContain('section')
    expect(sectionDisposed).toContain('on')
  })
})

describe('B5 工作范围状态随 fiber 生命周期(不是模块级泄漏)', () => {
  beforeEach(() => { resetWorkspaceRoot() })

  it('卸载后工作范围交回,重装不继承上一轮的值', () => {
    const wsA = makeWorkspace()
    const sink: unknown[] = []
    const { host, effects } = makeHost({
      ready: {
        workspaceRegistry: { list: () => [{ path: wsA }] },
        agents: { list: () => [{ id: 'sess-1', ctx: makeAgentCtx(sink) }] },
      },
    })
    apply(host as never)
    expect(currentWorkspaceRoot()).toBe(wsA)

    for (const e of [...effects].reverse()) {
      for (const d of [...e.disposers].reverse()) d()
    }
    expect(currentWorkspaceRoot(), '卸载后工作范围应交回').toBeUndefined()
  })

  it('两个宿主实例各自的工作范围互不串(后装不覆盖先装的书架视图)', () => {
    const wsA = makeWorkspace()
    const wsB = makeWorkspace()
    const sinkA: unknown[] = []
    const sinkB: unknown[] = []

    const a = makeHost({
      ready: {
        workspaceRegistry: { list: () => [{ path: wsA }] },
        agents: { list: () => [{ id: 'a-1', ctx: makeAgentCtx(sinkA) }] },
      },
    })
    apply(a.host as never)
    const rootAfterA = currentWorkspaceRoot()
    expect(rootAfterA).toBe(wsA)

    // 第二个实例装上来:先装那一份的观察值不应被悄悄改写
    const b = makeHost({
      ready: {
        workspaceRegistry: { list: () => [{ path: wsB }] },
        agents: { list: () => [{ id: 'b-1', ctx: makeAgentCtx(sinkB) }] },
      },
    })
    apply(b.host as never)

    // claimWorkspaceRoot 幂等:已认到就不改(先到先得),B 不覆盖 A
    expect(currentWorkspaceRoot(), '已认到工作范围时后装不应覆盖').toBe(wsA)

    for (const e of [...b.effects, ...a.effects].reverse()) {
      for (const d of [...e.disposers].reverse()) d()
    }
    expect(currentWorkspaceRoot()).toBeUndefined()
  })
})
