import { describe, expect, it } from 'vitest'
import type { ToolCallPhaseProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { novelResultModel, novelToolTitles } from '../src/client/tool-result'
import { NOVEL_TOOL_NAMES } from '../src/novel-tools'

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
  it('准备态不展示参数，运行态不预告成功', () => {
    const block = { phase: 'preparing' as const, callId: 'p', name: 'novel_settle_chapter', turn: 1, step: 1, time: 1, subCalls: [] }
    expect(novelResultModel({ phase: 'preparing', block })).toMatchObject({ state: 'preparing', args: '' })
    expect(novelResultModel({ phase: 'start', block: { ...block, phase: 'start', argsRaw: '{}' } }).state).toBe('running')
  })
})
