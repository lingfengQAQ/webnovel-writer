import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@deepseek-ai/dsh-session'
import { WorkflowObserver, readWorkflowChild } from '../src/study/workflow'
import { workflowDisplay } from '../src/client/workflow-display'
import { writingAssignmentOf } from '../src/writing-delegation'

function at<T>(time: number, operation: () => T): T {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(time)
  try { return operation() } finally { clock.mockRestore() }
}

function fixture() {
  const events: { type: string; data: unknown; time: number }[] = []
  const agent = { status: 'running', session: { header: { id: 'parent' }, get seq() { return events.length }, eventAt: ((i: number) => events[i]) as Session['eventAt'] } }
  const push = (type: string, data: unknown) => events.push({ type, data, time: events.length * 100 + 100 })
  const delegate = (bookId: string | undefined = 'a') => {
    push('turn/start', {})
    push('tool/call', { callId: 'delegate', name: 'novel_delegate', arguments: JSON.stringify({ role: 'polish', bookId, chapter: 3, prompt: '正文不作为状态推断' }) })
    push('tool/result', { message: { toolCallId: 'delegate', content: [{ type: 'text', text: JSON.stringify({ kind: 'activation', subagentId: 'child' }) }] } })
  }
  const start = (observer: WorkflowObserver, runId: string, parentId = 'parent') =>
    at(events.find(event => event.type === 'tool/call')!.time + 1, () => observer.startChild('child', runId, parentId))
  return { events, agent, push, delegate, start }
}

describe('后台写作角色的独立生命周期', () => {
  it('启动回执不算交付；主控轮结束后继续显示真实后台运行', () => {
    const f = fixture(), observer = new WorkflowObserver(); f.delegate()
    expect(observer.read(f.agent, 'a').calls[0]).toMatchObject({ stage: 'polish', chapter: 3, state: 'unknown', background: true })
    f.start(observer, 'run-one')
    f.push('turn/end', { reason: { kind: 'completed' } }); f.agent.status = 'idle'
    const view = observer.read(f.agent, 'a')
    expect(view.calls[0]).toMatchObject({ state: 'running', activationId: 'child' })
    expect(view.calls[0]?.ended).toBeUndefined(); expect(view.active).toBe(true)
    expect(workflowDisplay(view, 3).current?.stage).toBe('polish')
    observer.endChild('child', 'run-one', 'completed')
    expect(observer.read(f.agent, 'a').calls[0]).toMatchObject({ state: 'success', lifecycleVerified: true })
    expect(observer.read(f.agent, 'a').calls[0]?.summary).toContain('不代表章节已定稿')
  })
  it('错误、取消与不同activation的迟到结算分别处理', () => {
    const f = fixture(), observer = new WorkflowObserver(); f.delegate()
    f.start(observer, 'new-run'); observer.endChild('child', 'old-run', 'completed')
    expect(observer.read(f.agent, 'a').calls[0]?.state).toBe('running')
    observer.endChild('child', 'new-run', 'aborted')
    expect(observer.read(f.agent, 'a').calls[0]?.state).toBe('stopped')
    const other = fixture(), second = new WorkflowObserver(); other.delegate()
    other.start(second, 'error-run'); second.endChild('child', 'error-run', 'error')
    expect(second.read(other.agent, 'a').calls[0]?.state).toBe('error')
  })
  it('结算消息晚于已核验的终态时不抹掉交付结果', async () => {
    const f = fixture(), observer = new WorkflowObserver(); f.delegate()
    f.start(observer, 'run'); observer.endChild('child', 'run', 'completed', 'parent')
    expect(observer.read(f.agent, 'a').calls[0]?.state).toBe('success')
    f.push('user/message', { source: { kind: 'subagent-settled', senderSessionId: 'child' } })
    observer.startChild('child', 'later-run', 'parent')
    const read = vi.fn(async () => ({ parentId: 'parent', active: true }))
    expect((await observer.readWithChildren(f.agent, 'a', read)).calls[0]).toMatchObject({ state: 'success', lifecycleVerified: true })
    expect(read).not.toHaveBeenCalled()
  })
  it('冷恢复按原生子日志核对，父结算通知不解析英文摘要猜成功', async () => {
    const f = fixture(), observer = new WorkflowObserver(); f.delegate()
    f.push('turn/end', { reason: { kind: 'completed' } }); f.agent.status = 'idle'
    f.push('user/message', { source: { kind: 'subagent-settled', senderSessionId: 'child', summary: 'arbitrary localized summary' }, content: [] })
    expect(observer.read(f.agent, 'a').calls[0]?.state).toBe('unknown')
    const read = vi.fn(async () => ({ parentId: 'parent', active: false, ended: 450, reason: 'error' }))
    expect((await observer.readWithChildren(f.agent, 'a', read)).calls[0]?.state).toBe('error')
    expect(read).toHaveBeenCalledWith('child', 500, undefined)
    await observer.readWithChildren(f.agent, 'a', read); expect(read).toHaveBeenCalledTimes(1)
  })
  it('子会话待答独立显示；另一父级不能提供本任务的运行证据', async () => {
    const f = fixture(), observer = new WorkflowObserver(); f.delegate(); f.push('turn/end', {}); f.agent.status = 'idle'
    const foreign = await observer.readWithChildren(f.agent, 'a', async () => ({ parentId: 'another-parent', active: true, waiting: true }))
    expect(foreign.calls[0]?.state).toBe('unknown')
    const own = await observer.readWithChildren(f.agent, 'a', async () => ({ parentId: 'parent', active: true, waiting: true }))
    expect(own.calls[0]?.state).toBe('waiting'); expect(own.active).toBe(true); expect(own.waiting).toBe(true)
    expect((await observer.readWithChildren(f.agent, 'b', async () => ({ parentId: 'parent', active: true }))).calls).toEqual([])
  })
  it.each(['tool/result', 'tool/ptc-dispatch'])('从%s的原生文本与元数据读取rc.3名称，解析后核对真实父级', async type => {
    const f = fixture(), observer = new WorkflowObserver()
    f.push('tool/call', { callId: 'native', name: 'novel_delegate', arguments: { role: 'drafting', bookId: 'a', chapter: 3 } })
    const result = { toolCallId: 'native', content: [{ type: 'text', text: 'started subagent lead/writer' }], isError: false }
    f.push(type, { ...(type === 'tool/result' ? { message: result } : { ...result, subCallId: 'native' }), meta: { kind: 'activation', name: 'lead/writer' } })
    f.push('turn/end', {}); f.agent.status = 'idle'
    expect(observer.read(f.agent, 'a').calls[0]).toMatchObject({ activationName: 'lead/writer', state: 'unknown' })
    expect(observer.read(f.agent, 'a').calls[0]?.ended).toBeUndefined()
    const resolve = vi.fn(async () => 'child'), read = vi.fn(async () => ({ parentId: 'parent', active: true }))
    f.start(observer, 'native-run')
    const view = await observer.readWithChildren(f.agent, 'a', read, undefined, resolve)
    expect(resolve).toHaveBeenCalledWith(f.agent, 'lead/writer', undefined)
    expect(read).toHaveBeenCalledWith('child', undefined, undefined)
    expect(view.calls[0]).toMatchObject({ activationId: 'child', state: 'running' })
    expect(view.active).toBe(true)
    observer.endChild('child', 'native-run', 'completed', 'parent')
    expect((await observer.readWithChildren(f.agent, 'a', read, undefined, resolve)).calls[0]?.state).toBe('success')
    expect(resolve).toHaveBeenCalledTimes(1)
  })
  it('rc.1文本使用新增元数据，缺元数据的自由文本不猜子会话身份', () => {
    const f = fixture(), observer = new WorkflowObserver()
    for (const [id, meta] of [['native', { kind: 'activation', subagentId: 'child' }], ['old-text', undefined]] as const) {
      f.push('tool/call', { callId: id, name: 'novel_delegate', arguments: { role: 'review', bookId: 'a' } })
      f.push('tool/result', { message: { toolCallId: id, content: [{ type: 'text', text: 'started subagent child' }] }, ...(meta ? { meta } : {}) })
    }
    f.start(observer, 'run')
    expect(observer.read(f.agent, 'a').calls.map(call => call.state)).toEqual(['running', 'unknown'])
  })
  it('根收到的孙级或另一父级生命周期不能充当本次直接子级证明', async () => {
    const f = fixture(), observer = new WorkflowObserver(); f.delegate()
    f.start(observer, 'nested-run', 'another-parent')
    expect(observer.read(f.agent, 'a').calls[0]?.state).toBe('unknown')
    observer.endChild('child', 'nested-run', 'completed', 'another-parent')
    expect(observer.read(f.agent, 'a').calls[0]?.state).toBe('unknown')
    const read = vi.fn(async () => ({ parentId: 'another-parent', active: false, ended: 400, reason: 'completed' }))
    expect((await observer.readWithChildren(f.agent, 'a', read)).calls[0]?.state).toBe('unknown')
  })
  it('名称首次解析前的结算通知保留历史截止点，不串到后来恢复的运行', async () => {
    const f = fixture(), observer = new WorkflowObserver(); f.delegate()
    f.events[2]!.data = { message: { toolCallId: 'delegate', content: [{ type: 'text', text: 'started subagent lead/writer' }] }, meta: { kind: 'activation', name: 'lead/writer' } }
    f.push('turn/end', {}); f.push('user/message', { source: { kind: 'subagent-settled', senderSessionId: 'child' } }); f.agent.status = 'idle'
    observer.startChild('child', 'later-resume', 'parent')
    const read = vi.fn(async () => ({ parentId: 'parent', active: false, ended: 450, reason: 'error' }))
    const view = await observer.readWithChildren(f.agent, 'a', read, undefined, async () => 'child')
    expect(read).toHaveBeenCalledWith('child', 500, undefined)
    expect(view.calls[0]).toMatchObject({ state: 'error', settledAt: 500, ended: 450 })
    expect(view.active).toBe(false)
  })
  it.each([true, false])('原任务失败不被后续成功覆盖，名称解析期间追加通知=%s', async duringResolve => {
    const f = fixture(), observer = new WorkflowObserver(); f.delegate(); f.agent.status = 'idle'
    f.events[2]!.data = { message: { toolCallId: 'delegate', content: [{ type: 'text', text: 'started subagent writer' }] }, meta: { kind: 'activation', name: 'writer' } }
    if (duringResolve) f.start(observer, 'first')
    const finish = () => {
      if (duringResolve) at(350, () => observer.endChild('child', 'first', 'error', 'parent'))
      at(360, () => observer.startChild('child', 'second', 'parent'))
      at(380, () => observer.endChild('child', 'second', 'completed', 'parent'))
      f.push('user/message', { source: { kind: 'subagent-settled', senderSessionId: 'child', stopReason: 'error' } })
    }
    if (!duringResolve) finish()
    const read = vi.fn(async () => ({ parentId: 'parent', active: false, ended: 380, reason: 'completed' }))
    const view = await observer.readWithChildren(f.agent, 'a', read, undefined, async () => { if (duringResolve) finish(); return 'child' })
    expect(view.calls[0]).toMatchObject({ state: 'error', lifecycleVerified: true })
    expect(observer.read(f.agent, 'a').calls[0]?.state).toBe('error')
  })
  it('首轮teardown错误优先于其已成功执行的结算通知', async () => {
    const f = fixture(), observer = new WorkflowObserver(); f.delegate()
    f.start(observer, 'first'); at(350, () => observer.endChild('child', 'first', 'error', 'parent'))
    at(360, () => observer.startChild('child', 'later', 'parent'))
    at(380, () => observer.endChild('child', 'later', 'completed', 'parent'))
    f.push('user/message', { source: { kind: 'subagent-settled', senderSessionId: 'child', stopReason: 'completed' } })
    expect(observer.read(f.agent, 'a').calls[0]?.state).toBe('error')
  })
  it.each([false, true])('异步解析期间补折叠共用5000条预算，原会话读游标重置=%s', async rewind => {
    const f = fixture(), observer = new WorkflowObserver()
    if (rewind) {
      for (let i = 0; i < 6000; i++) f.push('assistant/message', {})
      observer.read(f.agent, 'a'); observer.read(f.agent, 'a'); f.events.length = 0
    }
    f.delegate()
    f.events[2]!.data = { message: { toolCallId: 'delegate', content: [] }, meta: { kind: 'activation', name: 'writer' } }
    const readEvent = vi.spyOn(f.agent.session, 'eventAt')
    const view = await observer.readWithChildren(f.agent, 'a', undefined, undefined, async () => {
      for (let i = 0; i < 6000; i++) f.push('assistant/message', {})
      return 'child'
    })
    expect(view.syncing).toBe(true)
    expect(readEvent).toHaveBeenCalledTimes(5000)
    expect(view.calls[0]?.state).toBe('unknown')
  })
  it('历史冷读只证明单轮完成，多轮旧日志不把最新一轮当原委派', async () => {
    const dispose = vi.fn()
    const events = [{ type: 'turn/start', time: 150, data: {} }, { type: 'turn/end', time: 200, data: { reason: { kind: 'error' } } }]
    const query = { observeSession: vi.fn(async () => ({ header: { id: 'child', parentSession: 'parent' }, inheritedEventCount: 0,
      source: 'persisted', events, [Symbol.dispose]: dispose })) }
    const ctx = { get: (name: string) => name === 'sessionQuery' ? query : undefined }
    const observer = new WorkflowObserver()
    expect(await readWorkflowChild(ctx as never, observer, 'child', 400)).toMatchObject({ parentId: 'parent', ended: 200, reason: 'error' })
    events.push({ type: 'turn/start', time: 250, data: {} }, { type: 'turn/end', time: 300, data: { reason: { kind: 'completed' } } })
    expect(await readWorkflowChild(ctx as never, observer, 'child', 400)).toEqual({ parentId: 'parent', active: false, waiting: false })
    expect(dispose).toHaveBeenCalledTimes(2)
  })
  it('名称不可解析、错误回执和取消均不借元数据伪造后台运行', async () => {
    const f = fixture(), observer = new WorkflowObserver(); f.delegate()
    f.events[2]!.data = { message: { toolCallId: 'delegate', content: [{ type: 'text', text: 'started subagent missing' }] }, meta: { kind: 'activation', name: 'missing' } }
    const read = vi.fn(async () => ({ parentId: 'parent', active: true }))
    expect((await observer.readWithChildren(f.agent, 'a', read, undefined, async () => { throw new Error('missing') })).calls[0]?.state).toBe('unknown')
    expect(read).not.toHaveBeenCalled()
    const controller = new AbortController()
    await expect(observer.readWithChildren(f.agent, 'a', read, controller.signal, async () => { controller.abort(); controller.signal.throwIfAborted(); return undefined })).rejects.toThrow()
    f.push('tool/call', { callId: 'failed', name: 'novel_delegate', arguments: { role: 'review', bookId: 'a' } })
    f.push('tool/result', { message: { toolCallId: 'failed', isError: true, content: [] }, meta: { kind: 'activation', subagentId: 'child' } })
    observer.startChild('child', 'run', 'parent')
    expect(observer.read(f.agent, 'a').calls.at(-1)?.state).toBe('error')
    expect(observer.read(f.agent, 'a').calls.at(-1)?.activationId).toBeUndefined()
  })
  it('角色和章号只认结构化参数，普通subagent及prompt不猜工序', () => {
    const f = fixture(), observer = new WorkflowObserver()
    f.push('turn/start', {})
    f.push('tool/call', { callId: 'research', name: 'subagent', arguments: JSON.stringify({ bookId: 'a', prompt: '给第3章起草润色' }) })
    expect(observer.read(f.agent, 'a').calls[0]?.stage).toBeUndefined()
    expect(observer.read(f.agent, 'a').calls[0]?.chapter).toBeUndefined()
  })
  it('书章归属标记只来自子级首条自身任务，旧角色标记仍兼容', () => {
    const read = (messages: string[], inheritedEventCount = 0) => writingAssignmentOf({ id: 'child', session: { seq: messages.length, inheritedEventCount,
      eventAt: (seq: number) => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: messages[seq] }] } }) } } as never)
    expect(read(['<!-- scriptor-worker:v1:polish -->\n<!-- scriptor-assignment:v1:{"bookId":"a","chapter":3} -->\n正文任务'])).toEqual({ role: 'polish', bookId: 'a', chapter: 3 })
    expect(read(['<!-- scriptor-worker:v1:polish -->\n旧任务'])).toEqual({ role: 'polish' })
    expect(read(['<!-- scriptor-worker:v1:polish -->\n父任务', '普通研究'], 1)).toBeUndefined()
  })
})
