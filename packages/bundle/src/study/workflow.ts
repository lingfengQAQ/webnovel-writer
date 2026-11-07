import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-subagent'
import { recordOf, resultState, toolStages, type WorkflowCall, type WorkflowView } from './workflow-types'

export interface WorkflowAgent {
  readonly session: { readonly seq?: number; readonly eventAt?: Session['eventAt']; readonly header?: { readonly id?: string; readonly parentSession?: string } }
  readonly status?: string
}
interface LogEvent { type: string; data: unknown; time: number }
interface Cursor { seq: number; calls: Map<string, WorkflowCall>; approvals: Map<string, string>; turnOpen: boolean }
export interface WorkflowChildCut {
  readonly parentId?: string
  readonly active: boolean
  readonly waiting?: boolean
  readonly ended?: number
  readonly reason?: string
}
export type WorkflowChildReader = (childId: string, settledAt: number | undefined, signal?: AbortSignal) => Promise<WorkflowChildCut | undefined>
const roleStages: Readonly<Record<string, WorkflowCall['stage']>> = { drafting: 'draft', polish: 'polish', revision: 'revise', review: 'review', settle: 'settle' }
/** A disposable read cache of native records, never a business state store. */
export class WorkflowObserver {
  private readonly cursors = new WeakMap<object, Cursor>()
  private readonly executing = new WeakMap<object, Set<string>>()
  private readonly asking = new WeakMap<object, number>()
  private readonly activations = new Map<string, { runId: string; state: 'running' | 'success' | 'stopped' | 'error' | 'attention'; started: number; ended?: number; reason?: string }>()

  startChild(id: string, runId: string): void { this.activations.set(id, { runId, state: 'running', started: Date.now() }) }
  endChild(id: string, runId: string, reason: string): void {
    const active = this.activations.get(id)
    if (active && active.runId !== runId) return
    this.activations.set(id, { runId, ...childEnd(reason), started: active?.started ?? 0, ended: Date.now(), reason })
    if (this.activations.size > 500) for (const [key, value] of this.activations) { if (value.ended) this.activations.delete(key); if (this.activations.size <= 400) break }
  }
  waiting(agent: object): boolean { return (this.asking.get(agent) ?? 0) > 0 }
  async readWithChildren(agent: WorkflowAgent, bookId: string, readChild: WorkflowChildReader | undefined, signal?: AbortSignal): Promise<WorkflowView> {
    const view = this.read(agent, bookId)
    if (!readChild) return view
    for (const call of view.calls) {
      if (!call.activationId || call.ended !== undefined && call.state !== 'unknown') continue
      signal?.throwIfAborted()
      let child: WorkflowChildCut | undefined
      try { child = await readChild(call.activationId, call.settledAt, signal) } catch { signal?.throwIfAborted() }
      if (!child || !agent.session.header?.id || child.parentId !== agent.session.header.id) continue
      if (child.ended !== undefined && child.ended >= call.started && child.reason) {
        Object.assign(call, childEnd(child.reason), { ended: child.ended, lifecycleVerified: true })
        const original = this.cursors.get(agent.session)?.calls.get(call.id)
        if (original) Object.assign(original, call)
      }
      else if (child.active && !call.settledAt) Object.assign(call, { state: child.waiting ? 'waiting' : 'running', ended: undefined,
        summary: child.waiting ? '后台角色正在等待答复。' : '后台角色正在执行，独立于主控当前轮次。' })
    }
    return { ...view, active: view.active || view.calls.some(call => call.background && call.ended === undefined && ['running', 'waiting'].includes(call.state)),
      waiting: view.waiting || view.calls.some(call => call.background && call.state === 'waiting') }
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

  read(agent: WorkflowAgent, bookId: string): WorkflowView {
    const total = agent.session.seq
    const read = agent.session.eventAt
    if (total === undefined || !read) return { available: false, active: false, syncing: false, asOf: 0, calls: [], otherActive: 0, waiting: false }
    let cursor = this.cursors.get(agent.session)
    if (!cursor || cursor.seq > total) {
      cursor = { seq: 0, calls: new Map(), approvals: new Map(), turnOpen: false }; this.cursors.set(agent.session, cursor)
    }
    // Incremental and bounded per request; cold histories continue on the next poll.
    const end = Math.min(total, cursor.seq + 5000)
    for (; cursor.seq < end; cursor.seq++) {
      const event = read.call(agent.session, cursor.seq as SessionSeq)
      if (event) this.apply(cursor, event)
    }
    const active = agent.status === 'running' && cursor.turnOpen && end === total
    const executing = this.executing.get(agent) ?? new Set<string>()
    const asking = active && (this.asking.get(agent) ?? 0) > 0
    const staged = [...cursor.calls.values()].filter(call => call.stage && call.ended === undefined && executing.has(call.id))
    const calls = [...cursor.calls.values()].map(call => {
      if (call.activationId) {
        if (call.lifecycleVerified && call.ended !== undefined) return { ...call }
        const observed = this.activations.get(call.activationId)
        if (observed && (!call.settledAt || observed.started <= call.settledAt && observed.ended !== undefined)) {
          if (observed.ended !== undefined) Object.assign(call, childEnd(observed.reason ?? ''), { ended: observed.ended, lifecycleVerified: true })
          return { ...call, state: observed.state, ended: observed.ended,
            summary: observed.state === 'running' ? '后台角色正在执行，独立于主控当前轮次。' : childEnd(observed.reason ?? '').summary }
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
      for (const call of cursor.calls.values()) if (call.ended === undefined && !call.activationId) {
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
      if (call?.background && Array.isArray(message.content) && message.isError !== true) {
        try {
          const result = JSON.parse(String(recordOf(message.content[0]).text)) as { kind?: string; subagentId?: string }
          if (result.kind === 'activation' && typeof result.subagentId === 'string') {
            call.activationId = result.subagentId; call.state = 'preparing'; call.summary = '后台任务已派发，等待实际执行与结算。'; return
          }
        } catch { /* a malformed/native error result uses ordinary handling */ }
      }
      if (call) Object.assign(call, resultState(message.content, message.isError, data.error), { ended: event.time,
        failureCode: typeof recordOf(data.error).code === 'string' ? recordOf(data.error).code : undefined })
    }
    if (event.type === 'user/message' && recordOf(data.source).kind === 'subagent-settled') {
      const child = recordOf(data.source).senderSessionId
      for (const call of cursor.calls.values()) if (call.activationId === child && call.settledAt === undefined) {
        call.settledAt = event.time; call.ended = event.time; call.state = 'unknown'
      }
    }
    if (event.type === 'approval/asked' && typeof data.id === 'string' && typeof data.callId === 'string') cursor.approvals.set(data.id, data.callId)
    if (event.type === 'approval/decided' && typeof data.id === 'string') cursor.approvals.delete(data.id)
  }
}

export function observeWorkflow(ctx: Context, observer: WorkflowObserver): void {
  ctx.on('subagent/start', info => observer.startChild(info.id, info.runId))
  ctx.on('subagent/end', info => observer.endChild(info.id, info.runId, info.stopReason))
  ctx.on('tools/execute', async (exec, next) => {
    const leave = exec.agent ? observer.enter(exec.agent, exec.callId) : undefined
    try { return await next() } finally { leave?.() }
  })
  ctx.on('user-questions/request', async (request, next) => {
    const leave = request.agent ? observer.ask(request.agent) : undefined
    try { return await next() } finally { leave?.() }
  }, { prepend: true })
}

function childEnd(reason: string): Pick<WorkflowCall, 'state' | 'summary'> & { state: 'success' | 'stopped' | 'error' | 'attention' } {
  if (reason === 'completed') return { state: 'success', summary: '后台角色已交付；仍需主控核对，不代表章节已定稿。' }
  if (reason === 'aborted' || reason === 'interrupted') return { state: 'stopped', summary: '后台角色已中断，请核对已有产物。' }
  if (reason === 'max-tokens' || reason === 'blocked' || reason === 'refusal') return { state: 'attention', summary: '后台角色未完成，请查看任务说明与已有产物。' }
  return { state: 'error', summary: '后台角色异常结束，请查看任务结果。' }
}
