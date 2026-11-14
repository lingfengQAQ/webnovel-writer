import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-subagent'
import { recordOf, resultState, toolStages, type WorkflowCall, type WorkflowView } from './workflow-types'

export interface WorkflowAgent {
  readonly session: { readonly seq?: number; readonly eventAt?: Session['eventAt']; readonly header?: { readonly id?: string; readonly parentSession?: string; readonly origin?: string } }
  readonly status?: string
}
interface LogEvent { type: string; data: unknown; time: number }
interface ChildSettlement { time: number; reason?: string }
interface Cursor { seq: number; calls: Map<string, WorkflowCall>; approvals: Map<string, string>; settlements: Map<string, ChildSettlement>; turnOpen: boolean }
export interface WorkflowChildCut {
  readonly parentId?: string
  readonly active: boolean
  readonly waiting?: boolean
  readonly ended?: number
  readonly reason?: string
}
export type WorkflowChildReader = (childId: string, settledAt: number | undefined, signal?: AbortSignal) => Promise<WorkflowChildCut | undefined>
export type WorkflowChildResolver = (parent: WorkflowAgent, name: string, signal?: AbortSignal) => Promise<string | undefined>
const roleStages: Readonly<Record<string, WorkflowCall['stage']>> = { drafting: 'draft', polish: 'polish', revision: 'revise', review: 'review', settle: 'settle' }
/** A disposable read cache of native records, never a business state store. */
export class WorkflowObserver {
  private readonly cursors = new WeakMap<object, Cursor>()
  private readonly executing = new WeakMap<object, Set<string>>()
  private readonly asking = new WeakMap<object, number>()
  private readonly activations = new Map<string, { runId: string; parentId?: string; state: 'running' | 'success' | 'stopped' | 'error' | 'attention'; started: number; ended?: number; reason?: string }>()

  startChild(id: string, runId: string, parentId?: string): void {
    // novel_delegate creates a new Session. Later activations of that Session
    // belong to follow-ups, and must not replace this dispatch's first epoch.
    if (!this.activations.has(id)) this.activations.set(id, { runId, parentId, state: 'running', started: Date.now() })
  }
  endChild(id: string, runId: string, reason: string, parentId?: string): void {
    const active = this.activations.get(id)
    if (active && (active.runId !== runId || parentId !== undefined && active.parentId !== undefined && active.parentId !== parentId)) return
    this.activations.set(id, { runId, parentId: parentId ?? active?.parentId, ...childEnd(reason), started: active?.started ?? 0, ended: Date.now(), reason })
    if (this.activations.size > 500) for (const [key, value] of this.activations) { if (value.ended) this.activations.delete(key); if (this.activations.size <= 400) break }
  }
  waiting(agent: object): boolean { return (this.asking.get(agent) ?? 0) > 0 }
  async readWithChildren(agent: WorkflowAgent, bookId: string, readChild: WorkflowChildReader | undefined, signal?: AbortSignal, resolveChild?: WorkflowChildResolver): Promise<WorkflowView> {
    const previous = this.cursors.get(agent.session)?.seq ?? 0
    const before = previous > (agent.session.seq ?? 0) ? 0 : previous
    const view = this.read(agent, bookId)
    const remaining = Math.max(0, 5000 - (view.asOf - before))
    for (const call of view.calls) {
      signal?.throwIfAborted()
      const cursor = this.cursors.get(agent.session), original = cursor?.calls.get(call.id)
      if (!call.activationId && call.activationName && resolveChild) {
        try { call.activationId = await resolveChild(agent, call.activationName, signal) } catch { signal?.throwIfAborted() }
        if (original && call.activationId) original.activationId = call.activationId
        if (agent.session.seq !== cursor?.seq) return this.read(agent, bookId, remaining)
      }
      if (!call.activationId || call.ended !== undefined && call.state !== 'unknown') continue
      // A completion notice can precede the first asynchronous name lookup.
      const settlement = cursor?.settlements.get(call.activationId)
      if (call.settledAt === undefined && settlement !== undefined && settlement.time >= call.started) {
        Object.assign(call, { settledAt: settlement.time, ended: settlement.time, state: 'unknown' })
        if (original) Object.assign(original, call)
      }
      const observed = this.observedChild(call, agent.session.header?.id, settlement)
      if (observed) Object.assign(call, observed)
      if (call.lifecycleVerified) { if (original) Object.assign(original, call); continue }
      if (!readChild) continue
      let child: WorkflowChildCut | undefined
      try { child = await readChild(call.activationId, call.settledAt, signal) } catch { signal?.throwIfAborted() }
      if (agent.session.seq !== cursor?.seq) return this.read(agent, bookId, remaining)
      if (!child || !agent.session.header?.id || child.parentId !== agent.session.header.id) continue
      if (settlement?.reason && settlement.time >= call.started) {
        Object.assign(call, childEnd(settlement.reason), { ended: settlement.time, lifecycleVerified: true })
        if (original) Object.assign(original, call)
      }
      else if (observed?.state === 'running') {
        if (child.waiting) Object.assign(call, { state: 'waiting', summary: '后台角色正在等待答复。' })
      }
      else if (child.ended !== undefined && child.ended >= call.started && child.reason) {
        Object.assign(call, childEnd(child.reason), { ended: child.ended, lifecycleVerified: true })
        if (original) Object.assign(original, call)
      }
      else if (child.active && !call.settledAt) Object.assign(call, { state: child.waiting ? 'waiting' : 'running', ended: undefined,
        summary: child.waiting ? '后台角色正在等待答复。' : '后台角色正在执行，独立于主控当前轮次。' })
    }
    return { ...view, active: view.active || view.calls.some(call => call.background && call.ended === undefined && ['running', 'waiting'].includes(call.state)),
      waiting: view.waiting || view.calls.some(call => call.background && call.state === 'waiting') }
  }

  private observedChild(call: WorkflowCall, parentId: string | undefined, settlement?: ChildSettlement): WorkflowCall | undefined {
    const observed = call.activationId ? this.activations.get(call.activationId) : undefined
    if (!observed || !parentId || observed.parentId !== parentId) return undefined
    const initial = observed.started >= call.started && call.receiptAt !== undefined && observed.started <= call.receiptAt
    // Teardown can fail after the execution result used by the notice. The
    // matched initial lifecycle is stronger evidence than a successful notice.
    if (initial && observed.ended !== undefined) return { ...call, state: observed.state, ended: observed.ended,
      lifecycleVerified: true, summary: childEnd(observed.reason ?? '').summary }
    // A native settlement reason belongs to the original dispatch even when
    // its notice is claimed after a later activation of the same Session.
    if (settlement?.reason && settlement.time >= call.started) return { ...call, ...childEnd(settlement.reason),
      settledAt: settlement.time, ended: settlement.time, lifecycleVerified: true }
    if (!initial || call.settledAt !== undefined) return undefined
    return { ...call, state: observed.state, ended: observed.ended,
      ...(observed.ended === undefined ? {} : { lifecycleVerified: true }),
      summary: observed.state === 'running' ? '后台角色正在执行，独立于主控当前轮次。' : childEnd(observed.reason ?? '').summary }
  }

  enter(agent: object, id: string): () => void {
    const active = this.executing.get(agent) ?? new Set<string>()
    this.executing.set(agent, active); active.add(id)
    return () => { active.delete(id) }
  }
  ask(agent: object): () => void {
    this.asking.set(agent, (this.asking.get(agent) ?? 0) + 1)
    return () => this.asking.set(agent, Math.max(0, (this.asking.get(agent) ?? 1) - 1))
  }

  read(agent: WorkflowAgent, bookId: string, budget = 5000): WorkflowView {
    const total = agent.session.seq
    const read = agent.session.eventAt
    if (total === undefined || !read) return { available: false, active: false, syncing: false, asOf: 0, calls: [], otherActive: 0, waiting: false }
    let cursor = this.cursors.get(agent.session)
    if (!cursor || cursor.seq > total) {
      cursor = { seq: 0, calls: new Map(), approvals: new Map(), settlements: new Map(), turnOpen: false }; this.cursors.set(agent.session, cursor)
    }
    // Incremental and bounded per request; cold histories continue on the next poll.
    const end = Math.min(total, cursor.seq + budget)
    for (; cursor.seq < end; cursor.seq++) {
      const event = read.call(agent.session, cursor.seq as SessionSeq)
      if (event) this.apply(cursor, event)
    }
    const active = agent.status === 'running' && cursor.turnOpen && end === total
    const executing = this.executing.get(agent) ?? new Set<string>()
    const asking = active && (this.asking.get(agent) ?? 0) > 0
    const staged = [...cursor.calls.values()].filter(call => call.stage && call.ended === undefined && executing.has(call.id))
    const calls = [...cursor.calls.values()].map(call => {
      if (call.activationId || call.activationName) {
        if (call.lifecycleVerified && call.ended !== undefined) return { ...call }
        const observed = this.observedChild(call, agent.session.header?.id, call.activationId ? cursor.settlements.get(call.activationId) : undefined)
        if (observed) {
          if (observed.ended !== undefined) Object.assign(call, observed)
          return observed
        }
        return { ...call, state: 'unknown' as const, summary: call.settledAt ? '后台任务已结束，结算结果待核对。' : '已派发后台任务，运行状态待核对。' }
      }
      if (call.ended !== undefined) return { ...call }
      const approvedWait = [...cursor.approvals.values()].includes(call.id)
      const state = !active ? 'unknown' : approvedWait || asking && staged.length === 1 && staged[0]?.id === call.id ? 'waiting' : executing.has(call.id) ? 'running' : 'preparing'
      return { ...call, state, summary: !active ? '暂无可确认的运行状态。' : state === 'waiting' ? '等待作者答复。' : state === 'running' ? '正在执行本次操作。' : '调用已请求，等待执行。' } satisfies WorkflowCall
    })
    return { available: true, active: active || calls.some(call => call.background && call.ended === undefined && call.state === 'running'), syncing: end < total, asOf: end, calls: calls.filter(call => call.bookId === bookId).slice(-80),
      otherActive: calls.filter(call => call.ended === undefined && call.bookId === undefined && (active || call.background && call.state === 'running')).length,
      waiting: asking || active && cursor.approvals.size > 0 }
  }

  private apply(cursor: Cursor, event: LogEvent): void {
    const data = recordOf(event.data)
    if (event.type === 'turn/start') cursor.turnOpen = true
    if (event.type === 'turn/end') {
      cursor.turnOpen = false; cursor.approvals.clear()
      for (const call of cursor.calls.values()) if (call.ended === undefined && !call.activationId && !call.activationName) {
        call.ended = event.time; call.state = 'unknown'; call.summary = '本轮已结束，未找到匹配结果。'
      }
    }
    if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start') {
      const id = event.type === 'tool/call' ? data.callId : data.subCallId
      if (typeof id !== 'string' || typeof data.name !== 'string' || cursor.calls.has(id)) return
      let args: Record<string, unknown>
      try { args = recordOf(typeof data.arguments === 'string' ? JSON.parse(data.arguments) : data.arguments) } catch { args = {} }
      const chapter = args.章 ?? args.chapter
      cursor.calls.set(id, { id, name: data.name, stage: data.name === 'novel_delegate' && typeof args.role === 'string' ? roleStages[args.role] : data.name === 'novel_confirm_volume_outline' && args.目标 === '卷摘要' ? 'volume-close' : Object.hasOwn(toolStages, data.name) ? toolStages[data.name] : undefined, bookId: typeof args.bookId === 'string' ? args.bookId.trim() : undefined,
        ...(data.name === 'novel_delegate' && typeof args.role === 'string' && roleStages[args.role] ? { role: args.role, background: true } : {}),
        chapter: typeof chapter === 'number' && Number.isSafeInteger(chapter) && chapter > 0 ? chapter : undefined,
        state: 'preparing', started: event.time, summary: '调用已请求。' })
      // Bound settled history, but keep in-flight identities intact.
      if (cursor.calls.size > 240) for (const [key, call] of cursor.calls) {
        if (call.ended !== undefined) cursor.calls.delete(key)
        if (cursor.calls.size <= 160) break
      }
    }
    if (event.type === 'tool/result' || event.type === 'tool/ptc-dispatch') {
      const message = event.type === 'tool/result' ? recordOf(data.message) : data
      const id = event.type === 'tool/result' ? message.toolCallId : data.subCallId
      const call = typeof id === 'string' ? cursor.calls.get(id) : undefined
      if (call?.background && message.isError !== true) {
        let result = recordOf(data.meta)
        // Read historical structured receipts, never guess identity from rendered prose.
        if (data.meta === undefined && Array.isArray(message.content) && message.content.length === 1 && recordOf(message.content[0]).type === 'text') {
          try { result = recordOf(JSON.parse(String(recordOf(message.content[0]).text))) } catch { /* ordinary result handling */ }
        }
        if (result.kind === 'activation' && (typeof result.subagentId === 'string' && result.subagentId || typeof result.name === 'string' && result.name)) {
          if (typeof result.subagentId === 'string' && result.subagentId) call.activationId = result.subagentId
          else call.activationName = String(result.name)
          call.receiptAt = event.time
          call.state = 'preparing'; call.summary = '后台任务已派发，等待实际执行与结算。'; return
        }
      }
      if (call) Object.assign(call, resultState(message.content, message.isError, data.error), { ended: event.time,
        failureCode: typeof recordOf(data.error).code === 'string' ? recordOf(data.error).code : undefined })
    }
    if (event.type === 'user/message' && recordOf(data.source).kind === 'subagent-settled') {
      const child = recordOf(data.source).senderSessionId
      if (typeof child === 'string' && !cursor.settlements.has(child)) {
        const reason = recordOf(data.source).stopReason
        cursor.settlements.set(child, { time: event.time, ...(typeof reason === 'string' && reason ? { reason } : {}) })
        if (cursor.settlements.size > 240) cursor.settlements.delete(cursor.settlements.keys().next().value!)
      }
      for (const call of cursor.calls.values()) if (call.activationId === child && call.settledAt === undefined) {
        call.settledAt = event.time
        if (!call.lifecycleVerified) { call.ended = event.time; call.state = 'unknown' }
      }
    }
    if (event.type === 'approval/asked' && typeof data.id === 'string' && typeof data.callId === 'string') cursor.approvals.set(data.id, data.callId)
    if (event.type === 'approval/decided' && typeof data.id === 'string') cursor.approvals.delete(data.id)
  }
}

export function observeWorkflow(ctx: Context, observer: WorkflowObserver): void {
  const parentOf = (info: { id: string }) => {
    const parentId = recordOf(info).parentSessionId
    return typeof parentId === 'string' ? parentId : ctx.get('agents')?.get(info.id as Agent['id'])?.session.header.parentSession
  }
  ctx.on('subagent/start', info => observer.startChild(info.id, info.runId, parentOf(info)))
  ctx.on('subagent/end', info => observer.endChild(info.id, info.runId, info.stopReason, parentOf(info)))
  ctx.on('tools/execute', async (exec, next) => {
    const leave = exec.agent ? observer.enter(exec.agent, exec.callId) : undefined
    try { return await next() } finally { leave?.() }
  })
  ctx.on('user-questions/request', async (request, next) => {
    const leave = request.agent ? observer.ask(request.agent) : undefined
    try { return await next() } finally { leave?.() }
  }, { prepend: true })
}

/** rc.3 names are resolved by the native tree catalog without activating a child. */
export async function resolveWorkflowChild(ctx: Context, parent: WorkflowAgent, name: string, signal?: AbortSignal): Promise<string | undefined> {
  const subagents = ctx.get('subagents')
  if (!subagents || !('resolveName' in subagents) || typeof subagents.resolveName !== 'function') return undefined
  const id: unknown = await subagents.resolveName(parent as Agent, name, signal ?? new AbortController().signal)
  return typeof id === 'string' && id ? id : undefined
}

/** Read a child's identity without loading an Agent; ambiguous old epochs stay unknown. */
export async function readWorkflowChild(ctx: Context, observer: WorkflowObserver, childId: string, settledAt: number | undefined, signal?: AbortSignal): Promise<WorkflowChildCut | undefined> {
  const query = ctx.get('sessionQuery')
  if (!query) return undefined
  const observation = await query.observeSession(childId as Parameters<typeof query.observeSession>[0], { signal, projectionMode: 'none' })
  try {
    const parentId = observation.header.parentSession
    const child = ctx.get('agents')?.get(observation.header.id)
    let starts = 0, ends = 0, checked = 0
    let terminal: { time: number; reason: string } | undefined
    for (let index = observation.inheritedEventCount; index < observation.events.length; index++) {
      if (++checked > 5000) return { parentId, active: false }
      const event = observation.events[index]!
      if (settledAt !== undefined && event.time > settledAt) continue
      if (event.type === 'turn/start') starts++
      if (event.type === 'turn/end') {
        ends++
        terminal = { time: event.time, reason: typeof event.data.reason === 'string' ? event.data.reason : event.data.reason.kind }
      }
    }
    // Historical notices have no stopReason. A latest turn in a reused child
    // cannot prove the first activation's outcome, even if it predates delivery.
    if (settledAt !== undefined && starts === 1 && ends === 1 && terminal) return { parentId, active: false, ended: terminal.time, reason: terminal.reason }
    const active = settledAt === undefined && starts === 1 && ends === 0 && observation.source === 'live' && child?.status === 'running'
    return { parentId, active, waiting: active && !!child && observer.waiting(child) }
  } finally { observation[Symbol.dispose]() }
}

function childEnd(reason: string): Pick<WorkflowCall, 'state' | 'summary'> & { state: 'success' | 'stopped' | 'error' | 'attention' } {
  if (reason === 'completed') return { state: 'success', summary: '后台角色已交付；仍需主控核对，不代表章节已定稿。' }
  if (reason === 'aborted' || reason === 'interrupted') return { state: 'stopped', summary: '后台角色已中断，请核对已有产物。' }
  if (reason === 'max-tokens' || reason === 'blocked' || reason === 'refusal') return { state: 'attention', summary: '后台角色未完成，请查看任务说明与已有产物。' }
  return { state: 'error', summary: '后台角色异常结束，请查看任务结果。' }
}
