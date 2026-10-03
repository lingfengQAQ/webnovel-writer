import { describe, expect, it } from 'vitest'
import type { Session } from '@deepseek-ai/dsh-session'
import { WorkflowObserver } from '../src/study/workflow'
import { resultState } from '../src/study/workflow-types'
import { graphLayout, graphPath, neighbors } from '../src/client/graph-model'
import { projectStoryGraph, type StoryGraph, type StoryGraphEdge, type StoryGraphRecord } from '../src/study/graph-types'

function runtime() {
  const events: { type: string; data: unknown; time: number }[] = []
  const agent = { status: 'running', session: { get seq() { return events.length }, eventAt: ((i: number) => events[i]) as Session['eventAt'] } }
  const push = (type: string, data: unknown) => events.push({ type, data, time: events.length * 1000 })
  push('turn/start', { turn: 1 })
  const start = (id: string, name = 'novel_assemble_materials', bookId = 'a') => push('tool/call', { callId: id, name, arguments: JSON.stringify({ bookId, 章: 3 }) })
  const finish = (id: string, value: unknown, error = false) => push('tool/result', { message: { toolCallId: id, isError: error, content: [{ type: 'text', text: JSON.stringify(value) }] } })
  return { agent, push, start, finish }
}
describe('运行图从真实事件语义投影', () => {
  it('按结构化目标区分卷规划与卷末摘要，不从文案猜测', () => {
    const r = runtime(), observer = new WorkflowObserver()
    r.push('tool/call', { callId: 'close', name: 'novel_confirm_volume_outline', arguments: JSON.stringify({ bookId: 'a', 目标: '卷摘要' }) })
    r.push('tool/call', { callId: 'plan', name: 'novel_confirm_volume_outline', arguments: JSON.stringify({ bookId: 'a', 目标: '卷纲' }) })
    expect(observer.read(r.agent, 'a').calls.map(c => c.stage)).toEqual(['volume-close', 'volume'])
  })
  it('请求不冒充执行，实际入口与结果分别更新', () => {
    const r = runtime(), observer = new WorkflowObserver()
    r.start('one')
    expect(observer.read(r.agent, 'a').calls[0]?.state).toBe('preparing')
    const leave = observer.enter(r.agent, 'one')
    expect(observer.read(r.agent, 'a').calls[0]).toMatchObject({ state: 'running', stage: 'materials', chapter: 3 })
    leave(); r.finish('one', { ok: true })
    expect(observer.read(r.agent, 'a').calls[0]?.state).toBe('success')
  })
  it('业务失败与待处理不能被成功返回覆盖', () => {
    const r = runtime(), observer = new WorkflowObserver()
    r.start('a'); r.finish('a', { ok: true, commitState: 'failed' })
    r.start('b'); r.finish('b', { ok: true, 审核通过: false })
    expect(observer.read(r.agent, 'a').calls.map(c => c.state)).toEqual(['error', 'attention'])
    expect(resultState([{ type: 'text', text: '{"ok":true}' }], true, { code: 'interrupted' }).state).toBe('stopped')
  })
  it('恢复后历史请求不宣称仍在运行，重复读取幂等', () => {
    const r = runtime(), observer = new WorkflowObserver()
    r.start('one'); r.agent.status = 'idle'
    expect(observer.read(r.agent, 'a').calls[0]?.state).toBe('unknown')
    expect(observer.read(r.agent, 'a')).toEqual(observer.read(r.agent, 'a'))
    r.push('turn/end', { reason: 'interrupted' })
    expect(observer.read(r.agent, 'a').calls[0]?.ended).toBeDefined()
  })
  it('书、会话、迟到结果分别归属，查询不点亮写稿', () => {
    const r = runtime(), observer = new WorkflowObserver()
    r.start('a', 'novel_get_story_status', 'a'); r.start('b', 'novel_prepare_pack', 'b')
    r.finish('a', { ok: true })
    expect(observer.read(r.agent, 'a').calls).toHaveLength(1)
    expect(observer.read(r.agent, 'a').calls[0]?.stage).toBeUndefined()
    expect(observer.read(r.agent, 'b').calls[0]?.stage).toBe('settle')
    expect(observer.read(runtime().agent, 'a').calls).toHaveLength(0)
  })
  it('PTC 子调用失败不会被外层成功覆盖', () => {
    const r = runtime(), observer = new WorkflowObserver()
    r.start('outer', 'run_code')
    r.push('tool/ptc-dispatch-start', { rootCallId: 'outer', parentCallId: 'outer', subCallId: 'inner', name: 'novel_apply_revision', arguments: { bookId: 'a', 章: 3 } })
    const leave = observer.enter(r.agent, 'inner')
    expect(observer.read(r.agent, 'a').calls.find(c => c.id === 'inner')?.state).toBe('running')
    leave()
    r.push('tool/ptc-dispatch', { subCallId: 'inner', isError: true, content: [] })
    r.finish('outer', { ok: true })
    expect(observer.read(r.agent, 'a').calls.find(c => c.id === 'inner')?.state).toBe('error')
  })
  it('作者等待只来自真实请求，结束后恢复执行', () => {
    const r = runtime(), observer = new WorkflowObserver()
    r.start('one', 'novel_settle_chapter')
    const leave = observer.enter(r.agent, 'one'), answer = observer.ask(r.agent)
    expect(observer.read(r.agent, 'a').calls[0]?.state).toBe('waiting')
    answer()
    expect(observer.read(r.agent, 'a').calls[0]?.state).toBe('running')
    leave()
    r.push('approval/asked', { id: 'question', callId: 'one' })
    expect(observer.read(r.agent, 'a').calls[0]?.state).toBe('waiting')
    r.push('approval/decided', { id: 'question', outcome: 'rejected' })
    expect(observer.read(r.agent, 'a').waiting).toBe(false)
  })
  it('缺失宿主能力明确降级；不完整结果保留未知', () => {
    expect(new WorkflowObserver().read({ session: {} }, 'a').available).toBe(false)
    expect(resultState([{ type: 'text', text: 'done' }], false, undefined).state).toBe('unknown')
    expect(resultState([{ type: 'text', text: '{"ok":true,"commitState":"new-state"}' }], false, undefined).state).toBe('unknown')
  })
  it.each(['ABORTED', 'ABORTED_BEFORE_DISPATCH', 'interrupted', 'ASK_ABORTED'])('识别实际宿主取消码 %s', code => {
    expect(resultState([], true, { code }).state).toBe('stopped')
  })
})

const node = (id: string, chapter = 1): StoryGraphRecord => ({ id, label: id, chapter, revealChapter: chapter, kind: '人物', status: '', plan: false, source: { space: 'book:a', path: `${id}.md` }, line: 1, preview: '' })
const edge = (from: string, to: string, relation = true): StoryGraphEdge => ({ ...node(`${from}-${to}`), from, to, relation })
describe('人物关系探索', () => {
  it('按层展开关系；有向引用不反向推断', () => {
    const edges = [edge('a', 'b'), edge('b', 'c', false)]
    expect([...neighbors('a', edges, 1)]).toEqual(['a', 'b'])
    expect([...neighbors('a', edges, 2)]).toEqual(['a', 'b', 'c'])
    expect(graphPath('a', 'c', edges)).toEqual(['a', 'b', 'c'])
    expect(graphPath('c', 'a', edges)).toBeUndefined()
  })
  it('路径只看到投影后的时间和披露，隐藏节点无法穿过', () => {
    const graph: StoryGraph = { bookId: 'a', bookName: '测试', maxChapter: 8, records: [node('a'), node('b', 5), node('c')], edges: [edge('a', 'b'), edge('b', 'c')], events: [], warnings: [] }
    expect(graphPath('a', 'c', projectStoryGraph(graph, { chapter: 3, reader: true, plans: false, unknown: false }).edges)).toBeUndefined()
    expect(graphPath('a', 'c', projectStoryGraph(graph, { chapter: 6, reader: true, plans: false, unknown: false }).edges)).toEqual(['a', 'b', 'c'])
  })
  it('同一完整图谱布局确定，五类节点不会重叠', () => {
    const records = Array.from({ length: 180 }, (_, i) => node(String(i)))
    const layout = graphLayout(records, [])
    expect(layout).toEqual(graphLayout(records.slice().reverse(), []))
    const points = [...layout.values()]
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) expect(Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y) >= 72).toBe(true)
  })
  it('新增资料保留已有节点位置，新节点不占已有位置', () => {
    const original = graphLayout([node('b'), node('c')], [edge('b', 'c')])
    const next = graphLayout([node('a'), node('b'), node('c')], [edge('a', 'c'), edge('b', 'c')], original)
    expect(next.get('b')).toEqual(original.get('b'))
    expect(next.get('c')).toEqual(original.get('c'))
    expect(next.get('a')).not.toEqual(original.get('b'))
    expect(next.get('a')).not.toEqual(original.get('c'))
  })
})
