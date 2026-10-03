import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-questions'
import { recordOf, resultState, toolStages, type WorkflowCall, type WorkflowView } from './workflow-types'

export interface WorkflowAgent {
  readonly session: { readonly seq?: number; readonly eventAt?: Session['eventAt'] }
  readonly status?: string
}
interface LogEvent { type: string; data: unknown; time: number }
interface Cursor { seq: number; calls: Map<string, WorkflowCall>; approvals: Map<string, string>; turnOpen: boolean }
/** A disposable read cache of native records, never a business state store. */
export class WorkflowObserver {
  private readonly cursors = new WeakMap<object, Cursor>()
  private readonly executing = new WeakMap<object, Set<string>>()
  private readonly asking = new WeakMap<object, number>()

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
      if (call.ended !== undefined) return { ...call }
      const approvedWait = [...cursor.approvals.values()].includes(call.id)
      const state = !active ? 'unknown' : approvedWait || asking && staged.length === 1 && staged[0]?.id === call.id ? 'waiting' : executing.has(call.id) ? 'running' : 'preparing'
      return { ...call, state, summary: !active ? '暂无可确认的运行状态。' : state === 'waiting' ? '等待作者答复。' : state === 'running' ? '正在执行本次操作。' : '调用已请求，等待执行。' } satisfies WorkflowCall
    })
    return { available: true, active, syncing: end < total, asOf: end, calls: calls.filter(call => call.bookId === bookId).slice(-80),
      otherActive: active ? calls.filter(call => call.ended === undefined && call.bookId === undefined).length : 0,
      waiting: asking || active && cursor.approvals.size > 0 }
  }

  private apply(cursor: Cursor, event: LogEvent): void {
    const data = recordOf(event.data)
    if (event.type === 'turn/start') cursor.turnOpen = true
    if (event.type === 'turn/end') {
      cursor.turnOpen = false; cursor.approvals.clear()
      for (const call of cursor.calls.values()) if (call.ended === undefined) {
        call.ended = event.time; call.state = 'unknown'; call.summary = '本轮已结束，未找到匹配结果。'
      }
    }
    if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start') {
      const id = event.type === 'tool/call' ? data.callId : data.subCallId
      if (typeof id !== 'string' || typeof data.name !== 'string' || cursor.calls.has(id)) return
      let args: Record<string, unknown>
      try { args = recordOf(typeof data.arguments === 'string' ? JSON.parse(data.arguments) : data.arguments) } catch { args = {} }
      const chapter = args.章 ?? args.chapter
      cursor.calls.set(id, { id, name: data.name, stage: data.name === 'novel_confirm_volume_outline' && args.目标 === '卷摘要' ? 'volume-close' : Object.hasOwn(toolStages, data.name) ? toolStages[data.name] : undefined, bookId: typeof args.bookId === 'string' ? args.bookId.trim() : undefined,
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
      if (call) Object.assign(call, resultState(message.content, message.isError, data.error), { ended: event.time,
        failureCode: typeof recordOf(data.error).code === 'string' ? recordOf(data.error).code : undefined })
    }
    if (event.type === 'approval/asked' && typeof data.id === 'string' && typeof data.callId === 'string') cursor.approvals.set(data.id, data.callId)
    if (event.type === 'approval/decided' && typeof data.id === 'string') cursor.approvals.delete(data.id)
  }
}

export function observeWorkflow(ctx: Context, observer: WorkflowObserver): void {
  ctx.on('tools/execute', async (exec, next) => {
    const leave = exec.agent ? observer.enter(exec.agent, exec.callId) : undefined
    try { return await next() } finally { leave?.() }
  })
  ctx.on('user-questions/request', async (request, next) => {
    const leave = request.agent ? observer.ask(request.agent) : undefined
    try { return await next() } finally { leave?.() }
  }, { prepend: true })
}
