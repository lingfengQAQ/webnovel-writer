import { describe, expect, it } from 'vitest'
import type { ToolCallPhaseProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { editorSuggestionModel, novelResultModel, novelToolTitles } from '../src/client/tool-result'
import { NOVEL_TOOL_NAMES } from '../src/novel-tools'
import {
  EDITOR_CANCELLED_REASON, EDITOR_DELIVERED_MESSAGE, EDITOR_DUPLICATE_REASON, EDITOR_UNANSWERED_REASON, EDITOR_UNKNOWN_REASON,
} from '../src/study/editor-requests'

const settled = (value: unknown): Extract<ToolCallPhaseProps, { phase: 'result' }> => ({ phase: 'result', block: {
  kind: 'tool-result', seq: 3, time: 3, callTime: 2, callId: 'one', call: { name: 'novel_record_review_findings', argsRaw: '{}' },
  content: [{ type: 'text', text: JSON.stringify(value) }], isError: false, subCalls: [],
} })

describe('小说结果卡的证据边界', () => {
  it('覆盖实际生产工具名，不为测试 seed 注册入口', () => {
    expect(Object.keys(novelToolTitles).sort()).toEqual([...NOVEL_TOOL_NAMES].sort())
  })
  it('模块完成但问题未处置，不显示审核通过', () => {
    const model = novelResultModel(settled({ ok: true, 完成: true, 审核通过: false, 待处置数: 2, 待回写模块: [] }))
    expect(model.state).toBe('attention')
    expect(model.facts).toContainEqual({ label: '审核', value: '尚未通过' })
  })
  it('业务失败和运行时错误都优先于成功信息', () => {
    expect(novelResultModel(settled({ ok: false, reason: '旧批准已失效', message: '成功' })).summary).toBe('旧批准已失效')
    const input = settled({ ok: true, message: '成功' }); input.block.isError = true
    expect(novelResultModel(input).state).toBe('error')
    input.block.error = { name: 'Abort', code: 'interrupted' }
    expect(novelResultModel(input).state).toBe('stopped')
    expect(novelResultModel(settled({ ok: true, commitState: 'failed' })).state).toBe('error')
  })
  it('无变化无需重试；进度待核对与渲染文本保留', () => {
    expect(novelResultModel(settled({ ok: true, commitState: 'unchanged' })).label).toBe('无变化')
    const model = novelResultModel(settled({ ok: true, 渲染: '骨架缺正文', 内容问题: ['骨架缺正文'], 疑似占位待核对: ['事件甲'] }))
    expect(model.state).toBe('attention'); expect(model.report).toBe('骨架缺正文')
  })
  it('未知/混合内容原样回退，不从其中挑一个成功对象', () => {
    expect(novelResultModel(settled({ message: '成功' })).state).toBe('unknown')
    const input = settled({ ok: true }); input.block.content = [...input.block.content, { type: 'text', text: '不完整的另一结果' }]
    expect(novelResultModel(input).state).toBe('unknown')
    expect(novelResultModel(input).raw).toContain('不完整的另一结果')
  })
  it('PTC 子调用与历史缺失调用头仅展示自己的冻结结果', () => {
    const input = settled({ ok: true, bookId: '甲' }); input.block.parentCallId = 'parent'; input.block.call = null
    const original = JSON.stringify(input)
    expect(novelResultModel(input).facts).toContainEqual({ label: '书 ID', value: '甲' })
    expect(JSON.stringify(input)).toBe(original)
    expect(novelResultModel(settled({ ok: true, bookId: '乙' })).facts).not.toContainEqual({ label: '书 ID', value: '甲' })
  })
  it('编辑建议摘要面向作者，原始结果仍保留给模型的原文', () => {
    const frozen = settled({ ok: true, requestId: 'polish1', delivered: true, message: EDITOR_DELIVERED_MESSAGE })
    frozen.block.call = { name: 'novel_editor_suggest', argsRaw: JSON.stringify({ requestId: 'polish1', kind: 'replace', note: '更顺一点' }) }
    const live = editorSuggestionModel(frozen, { decision: 'accepted', intent: 'polish' })
    expect(live.state).toBe('success')
    expect(live.summary).toBe('作者已采纳这条建议')
    expect(live.summary).not.toContain('不要')
    expect(live.raw).toContain(EDITOR_DELIVERED_MESSAGE)
    expect(live.facts).toContainEqual({ label: '编号', value: '#polish1' })
    expect(live.facts).toContainEqual({ label: '类型', value: '替换建议' })
    expect(live.facts).toContainEqual({ label: '意图', value: '润色' })
    expect(live.facts).toContainEqual({ label: '说明', value: '更顺一点' })
    expect(live.facts).toContainEqual({ label: '作者决定', value: '已采纳' })
    const cold = editorSuggestionModel(frozen)
    expect(cold.facts.find(fact => fact.label === '作者决定')).toBeUndefined()
    expect(cold.facts.find(fact => fact.label === '意图')).toBeUndefined()
    expect(cold.facts).toContainEqual({ label: '编号', value: '#polish1' })
    expect(cold.summary).toBe('已送到编辑器，由作者决定是否采用')
    expect(cold.raw).toBe(live.raw)
    for (const [decision, summary, label] of [
      ['rejected', '作者已拒绝这条建议', '已拒绝'],
      ['reopened', '作者已撤销采纳', '已撤销采纳'],
      ['expired', '这条请求已过期', '已过期'],
    ] as const) {
      const model = editorSuggestionModel(frozen, { decision })
      expect(model.summary).toBe(summary)
      expect(model.facts).toContainEqual({ label: '作者决定', value: label })
    }
    const reasons = [
      [EDITOR_UNKNOWN_REASON, '未知编号'],
      [EDITOR_CANCELLED_REASON, '作者已取消'],
      [EDITOR_DUPLICATE_REASON, '已交回过'],
      [EDITOR_UNANSWERED_REASON, '请求已结束未交回'],
    ] as const
    for (const [reason, summary] of reasons) {
      const failed = settled({ ok: false, requestId: 'gone1', reason })
      failed.block.call = { name: 'novel_editor_suggest', argsRaw: JSON.stringify({ requestId: 'gone1', kind: 'replace' }) }
      const model = editorSuggestionModel(failed, { decision: 'cancelled' })
      expect(model.state).toBe('error')
      expect(model.summary).toBe(summary)
      expect(model.summary).not.toContain('不要')
      expect(model.raw).toContain(reason)
      expect(model.facts).toContainEqual({ label: '作者决定', value: '已取消' })
    }
    const generic = settled({ ok: false, requestId: 'gone1', reason: '替换文本不能为空；无需修改时请改用 none。' })
    generic.block.call = { name: 'novel_editor_suggest', argsRaw: JSON.stringify({ requestId: 'gone1', kind: 'replace' }) }
    expect(editorSuggestionModel(generic).summary).toBe('这次没有交回编辑建议')
  })
  it('准备态不展示参数，运行态不预告成功', () => {
    const block = { phase: 'preparing' as const, callId: 'p', name: 'novel_settle_chapter', turn: 1, step: 1, time: 1, subCalls: [] }
    expect(novelResultModel({ phase: 'preparing', block })).toMatchObject({ state: 'preparing', args: '' })
    expect(novelResultModel({ phase: 'start', block: { ...block, phase: 'start', argsRaw: '{}' } }).state).toBe('running')
  })
})
