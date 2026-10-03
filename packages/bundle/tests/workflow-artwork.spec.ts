import { describe, expect, it } from 'vitest'
import { artworkEdges, artworkNodes, artworkSourceHash, artworkSvg } from '../src/client/workflow-artwork'
import { callsForNode, workflowDisplay, workflowNodeForCall } from '../src/client/workflow-display'
import { scopeArtworkSvg } from '../src/client/workflow-artwork-view'
import type { WorkflowCall, WorkflowView } from '../src/study/workflow-types'

const call = (id: string, chapter: number, state: WorkflowCall['state'], stage: WorkflowCall['stage'], started = 1): WorkflowCall =>
  ({ id, name: stage === 'confirm' ? 'novel_settle_chapter' : 'example', chapter, stage, state, started, summary: id, ...(['running', 'waiting', 'preparing'].includes(state) ? {} : { ended: started + 1 }) })
const view = (calls: WorkflowCall[], active = true): WorkflowView => ({ available: true, active, syncing: false, asOf: 1, calls, otherActive: 0, waiting: calls.some(c => c.state === 'waiting') })

describe('选定的 Archify 流程与运行投影', () => {
  it('隔离SVG定义的id但保留业务节点身份，状态与点击仍能找到原节点', () => {
    const scoped = scopeArtworkSvg('pane-one')
    for (const node of artworkNodes) expect(scoped).toContain('data-node-id="' + node.id + '"')
    for (const edge of artworkEdges) expect(scoped).toContain('data-edge-id="' + edge.id + '"')
    for (const [, id] of artworkSvg.matchAll(/\sid="([^"]+)"/g)) expect(scoped).toContain(' id="pane-one-' + id + '"')
    for (const [, id] of scoped.matchAll(/url\(#([^)]+)\)/g)) expect(scoped).toContain('id="' + id + '"')
    expect(scopeArtworkSvg('pane-two')).not.toContain('url(#pane-one-')
  })
  it('保留作者指定的成图与关键回路，不导入整页脚本或外链', () => {
    expect(artworkSourceHash).toBe('beafe2e8da31131ea943da873cdf92a09c3fa243cb11d926be8ec35fb85217fd')
    expect(artworkNodes).toHaveLength(13)
    expect(artworkEdges).toHaveLength(17)
    for (const edge of artworkEdges) expect(artworkSvg).toContain('data-edge-id="' + edge.id + '"')
    expect(artworkEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'package', to: 'approval' }), expect.objectContaining({ from: 'approval', to: 'settled' }),
      expect.objectContaining({ from: 'approval', to: 'revision' }), expect.objectContaining({ from: 'approval', to: 'package' }),
      expect.objectContaining({ from: 'wait', to: 'outline' }), expect.objectContaining({ from: 'volume', to: 'design' }),
    ]))
    expect(artworkSvg).not.toMatch(/<script|<foreignObject|\bon\w+\s*=|\bhref\s*=|https?:|file:/i)
  })
  it('切换章节时，标题、节点和详情只消费同一章', () => {
    const olderFailure = call('old', 12, 'error', 'revise', 1)
    const otherRunning = call('retry', 12, 'running', 'revise', 4)
    const waiting = call('wait', 13, 'waiting', 'materials', 3)
    const selected = workflowDisplay(view([olderFailure, waiting, otherRunning]), 13)
    expect(selected.current?.id).toBe('wait')
    expect(selected.currentNode).toBe('materials')
    expect(selected.calls.map(c => c.chapter)).toEqual([13])
    expect(callsForNode(selected.calls, 'revision')).toHaveLength(0)
    expect(selected.nodes.find(n => n.id === 'revision')?.state).toBeUndefined()
  })
  it('保留失败历史，实际重试优先于旧失败；合并节点仍保留具体子阶段', () => {
    const failed = call('old', 12, 'error', 'revise')
    const retry = call('retry', 12, 'running', 'revise', 3)
    const display = workflowDisplay(view([failed, retry]), 12)
    expect(display.nodes.find(n => n.id === 'revision')).toMatchObject({ state: 'running', activeCount: 1 })
    expect(callsForNode(display.calls, 'revision')).toHaveLength(2)
    expect(workflowNodeForCall(call('p', 12, 'running', 'polish'))).toBe('draft')
    expect(callsForNode([call('p', 12, 'running', 'polish')], 'draft')[0]?.stage).toBe('polish')
  })
  it('真实等待归作者裁决，执行结果归入档；不从成功调用伪造本章完成', () => {
    const waiting = call('s', 12, 'waiting', 'confirm')
    expect(workflowNodeForCall(waiting)).toBe('approval')
    expect(workflowNodeForCall({ ...waiting, state: 'running' })).toBe('settled')
    const done = call('s', 12, 'success', 'confirm')
    const display = workflowDisplay(view([done], false), 12)
    expect(display.nodes.find(n => n.id === 'approval')?.state).toBeUndefined()
    expect(display.nodes.find(n => n.id === 'settled')?.state).toBe('success')
    expect(display.nodes.find(n => n.id === 'wait')?.state).toBeUndefined()
    expect(callsForNode(display.calls, 'approval')).toHaveLength(1)
  })
  it.each(['disconnect', 'idle', 'syncing'])('%s 不保留假运行或旧的当前节点', mode => {
    const data = view([call('live', 12, 'running', 'review')], mode !== 'idle')
    data.syncing = mode === 'syncing'
    const display = workflowDisplay(data, 12, mode === 'disconnect')
    expect(display.current).toBeUndefined()
    expect(display.nodes.find(n => n.id === 'review')?.state).toBe('unknown')
  })
  it('全部章节有并行动作时保留数量，未知操作不会点亮某个写作工序', () => {
    const display = workflowDisplay(view([call('a', 12, 'running', 'draft'), call('b', 13, 'running', 'polish'), call('c', 14, 'running', undefined, 8)]), 0)
    expect(display.nodes.find(n => n.id === 'draft')).toMatchObject({ activeCount: 2, label: '2 项 · 进行中' })
    expect(display.currentNode).toBeUndefined()
    expect(workflowNodeForCall(call('v', 0, 'running', 'volume'))).toBe('design')
    expect(workflowNodeForCall(call('v', 0, 'running', 'volume-close'))).toBe('volume')
  })
})
