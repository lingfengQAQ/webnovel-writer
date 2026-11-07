import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@deepseek-ai/dsh-session'
import { WorkflowObserver } from '../src/study/workflow'
import { workflowDisplay } from '../src/client/workflow-display'
import { writingAssignmentOf } from '../src/writing-delegation'

function fixture() {
  const events: { type: string; data: unknown; time: number }[] = []
  const agent = { status: 'running', session: { header: { id: 'parent' }, get seq() { return events.length }, eventAt: ((i: number) => events[i]) as Session['eventAt'] } }
  const push = (type: string, data: unknown) => events.push({ type, data, time: events.length * 100 + 100 })
  const delegate = (bookId: string | undefined = 'a') => {
    push('turn/start', {})
    push('tool/call', { callId: 'delegate', name: 'novel_delegate', arguments: JSON.stringify({ role: 'polish', bookId, chapter: 3, prompt: '正文不作为状态推断' }) })
    push('tool/result', { message: { toolCallId: 'delegate', content: [{ type: 'text', text: JSON.stringify({ kind: 'activation', subagentId: 'child' }) }] } })
  }
  return { events, agent, push, delegate }
}

describe('后台写作角色的独立生命周期', () => {
  it('启动回执不算交付；主控轮结束后继续显示真实后台运行', () => {
    const f = fixture(), observer = new WorkflowObserver(); f.delegate()
    expect(observer.read(f.agent, 'a').calls[0]).toMatchObject({ stage: 'polish', chapter: 3, state: 'unknown', background: true })
    observer.startChild('child', 'run-one')
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
    observer.startChild('child', 'new-run'); observer.endChild('child', 'old-run', 'completed')
    expect(observer.read(f.agent, 'a').calls[0]?.state).toBe('running')
    observer.endChild('child', 'new-run', 'aborted')
    expect(observer.read(f.agent, 'a').calls[0]?.state).toBe('stopped')
    const other = fixture(), second = new WorkflowObserver(); other.delegate()
    second.startChild('child', 'error-run'); second.endChild('child', 'error-run', 'error')
    expect(second.read(other.agent, 'a').calls[0]?.state).toBe('error')
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
