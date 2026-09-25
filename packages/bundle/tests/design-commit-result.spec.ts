import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { designCommitResult, repeatedDesignNoChange } from '../src/design-commit-result'
import type { ToolExecContext } from '../src/novel-tools'

const name = 'novel_update_contract'
const args = { bookId: 'book', partName: '创作禁区与不可妥协项', state: '已确认', content: '不扩展支线。' }
// Only fields consumed by the trace reader; the real AgentLoop test covers durable envelopes.
const event = (type: string, data: object = {}) => ({ type, data }) as SessionEvent
const text = (commitState = 'unchanged') => [{ type: 'text', text: JSON.stringify({ ok: commitState !== 'failed', commitState }) }]
function trace(previous = args, commitState = 'unchanged', toolName = name) {
  return [event('turn/start', { turn: 1 }),
    event('tool/call', { callId: 'one', name: toolName, arguments: JSON.stringify(previous) }),
    event('tool/result', { message: { content: [{ toolCallId: 'one', content: text(commitState) }] } }),
  ]
}
function context(events: SessionEvent[]): ToolExecContext {
  return { name, concludeTurn: vi.fn(), agent: { id: 'main', session: { seq: events.length, eventAt: seq => events[seq] } } }
}

describe('#167 相同设计空操作的轮次保护', () => {
  it('当前轮相同操作重复无改动才结束，读取与宿主快照不重置已完成证据', () => {
    const events = [...trace(), event('user/message', { source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot' } }),
      event('tool/call', { callId: 'read', name: 'read', arguments: '{}' }),
      event('tool/result', { message: { content: [{ toolCallId: 'read', content: [{ type: 'text', text: '正文' }] }] } }),
    ]
    const exec = context(events)
    expect(repeatedDesignNoChange({ content: args.content, state: args.state, partName: args.partName, bookId: args.bookId, summary: '换了提交摘要' }, exec)).toBe(true)
    expect(designCommitResult({ ok: true, noChanges: true }, '契约', args, exec)).toMatchObject({ ok: true, commitState: 'unchanged', retryable: false })
    expect(exec.concludeTurn).toHaveBeenCalledOnce()
  })

  it('首次空操作、不同操作、提交失败和实际提交均不被当作重复完成', () => {
    for (const events of [[event('turn/start')], trace({ ...args, content: '其他正文' }), trace(args, 'committed'), trace(args, 'failed'), trace(args, 'unchanged', 'novel_roll_window')]) {
      const exec = context(events)
      designCommitResult({ ok: true, noChanges: true }, '契约', args, exec)
      expect(exec.concludeTurn).not.toHaveBeenCalled()
    }
    const exec = context(trace())
    designCommitResult({ ok: true, message: 'design: change' }, '契约', args, exec)
    designCommitResult({ ok: false, reason: 'index locked' }, '契约', args, exec)
    expect(exec.concludeTurn).not.toHaveBeenCalled()
  })

  it('新轮次、用户新指令或新的书房保存通知不继承上一操作的停止判定', () => {
    for (const boundary of [event('turn/end'), event('turn/start'), event('user/message', { source: { kind: 'user' } }), event('user/message', { source: { kind: 'plugin', plugin: 'webnovel' } })]) {
      expect(repeatedDesignNoChange(args, context([...trace(), boundary]))).toBe(false)
    }
    expect(repeatedDesignNoChange(args, { name, agent: { id: 'other' } })).toBe(false)
  })

  it('不将其他工具返回的相似 JSON 或损坏参数当作本插件操作成功', () => {
    expect(repeatedDesignNoChange(args, context(trace(args, 'unchanged', 'read')))).toBe(false)
    const events = trace()
    events[1] = event('tool/call', { callId: 'one', name, arguments: '{' })
    expect(repeatedDesignNoChange(args, context(events))).toBe(false)
  })

  it('PTC 只读取已完成的自身子调用，不把失败或仅开始的调用算完成', () => {
    const base = { name, arguments: args, content: text(), isError: false }
    expect(repeatedDesignNoChange(args, context([event('turn/start'), event('tool/ptc-dispatch', base)]))).toBe(true)
    expect(repeatedDesignNoChange(args, context([event('turn/start'), event('tool/ptc-dispatch', { ...base, isError: true })]))).toBe(false)
    expect(repeatedDesignNoChange(args, context([event('turn/start'), event('tool/ptc-dispatch-start', base)]))).toBe(false)
  })
})
