import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { serializeDocument } from '@webnovel/core'
import { removeSync } from '../../core/src/repo/remove'
import { attachDraftLengthFeedbackToAgent } from '../src/draft-length-feedback'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach(removeSync))
function setup() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-feedback-'))
  roots.push(workspace)
  const book = path.join(workspace, '测试书')
  fs.mkdirSync(path.join(book, '作品契约'), { recursive: true })
  fs.writeFileSync(path.join(book, '作品契约/契约.md'), serializeDocument({ 书id: 'test' },
    '## 阅读体验与情绪承诺 〔已确认〕\n### 章节篇幅\n- 目标汉字数: 3\n- 下限汉字数: 2\n- 上限汉字数: 4'))
  const agent = { id: 'owner' }
  const file = path.join(book, '草稿区/草稿/卷01-夜渡/稿1.md')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '磁盘可能已经被后续操作改动')
  let listener: (exec: ToolExecution, result: ToolExecutionResult, next: () => Promise<PostToolDecision>) => Promise<PostToolDecision>
  const off = vi.fn()
  const warn = vi.fn()
  const undo = attachDraftLengthFeedbackToAgent({ on: (_name, fn) => { listener = fn as never; return off } }, { agent, workspaceRoot: () => workspace, warn })!
  const exec = { agent, name: 'write', arguments: { file_path: file, content: '不信参数' }, signal: new AbortController().signal } as unknown as ToolExecution
  const result: ToolExecutionResult = { isError: false, value: { path: file, before: null, after: '甲乙𠮷' }, content: [{ type: 'text', text: '原生保存结果' }] }
  return { workspace, agent, file, exec, result, warn, off, undo,
    invoke: (execution = exec, outcome = result, decision: PostToolDecision = { kind: 'accept' }) => listener(execution, outcome, async () => decision) }
}
function receipt(decision: PostToolDecision) {
  const message = decision.additionalContexts?.at(-1)
  const block = message?.content[0]
  if (block?.type !== 'text') throw new Error('missing feedback')
  return JSON.parse(block.text.split('\n')[1]!)
}

describe('原生草稿工具后置回执', () => {
  it('使用 native after，不重读正文，不改变已有投影/上下文；卸载可清理', async () => {
    const s = setup()
    const original: PostToolDecision = { kind: 'accept', value: '其他插件的投影', additionalContexts: [] }
    const response = await s.invoke(s.exec, s.result, original)
    expect(response).toMatchObject({ kind: 'accept', value: '其他插件的投影' })
    expect(original.additionalContexts).toEqual([])
    expect(receipt(response)).toMatchObject({ 书id: 'test', 正文统计: { 汉字数: 3 }, 篇幅核对: { 结果: '范围内' } })
    expect(s.result.content).toEqual([{ type: 'text', text: '原生保存结果' }])
    expect(response.additionalContexts?.[0]?.source.kind).toBe('plugin:webnovel-draft-length')
    s.undo()
    expect(s.off).toHaveBeenCalledOnce()
  })

  it('尊重拒绝、取消、错误、兄弟或同 id 的另一实例，非正文不回执', async () => {
    const s = setup()
    const block: PostToolDecision = { kind: 'block', feedback: [] }
    expect(await s.invoke(s.exec, s.result, block)).toBe(block)
    const error = { isError: true, error: { message: '拒写' }, content: [] } as ToolExecutionResult
    expect(await s.invoke(s.exec, error)).not.toHaveProperty('additionalContexts')
    const cancelled = AbortSignal.abort()
    for (const execution of [{ ...s.exec, signal: cancelled }, { ...s.exec, agent: { id: 'owner' } },
      { ...s.exec, name: 'read' }, { ...s.exec, name: 'str_replace_editor', arguments: { command: 'view', path: s.file } }]) {
      expect(await s.invoke(execution as ToolExecution)).not.toHaveProperty('additionalContexts')
    }
    for (const file of [path.join(s.workspace, 'outside.md'), s.file.replace('稿1.md', '备注.txt'), path.join(s.workspace, '测试书/定稿/卷01-夜渡/稿1.md')]) {
      const outcome = { ...s.result, value: { path: file, after: '甲乙' } } as ToolExecutionResult
      expect(await s.invoke({ ...s.exec, arguments: { file_path: file } }, outcome)).not.toHaveProperty('additionalContexts')
    }
    const mismatch = { ...s.result, value: { path: s.file.replace('稿1.md', '稿2.md'), after: '甲乙' } } as ToolExecutionResult
    expect(await s.invoke(s.exec, mismatch)).not.toHaveProperty('additionalContexts')
  })

  it('未知完整快照明确未核验，stage 只报累计值；契约每次取当前版本', async () => {
    const s = setup()
    const replacement = { ...s.exec, name: 'str_replace_editor', arguments: { command: 'insert', path: s.file } }
    expect(receipt(await s.invoke(replacement, { ...s.result, value: '只含局部片段' } as ToolExecutionResult))).toMatchObject({ 统计状态: '未核验' })
    const stagedPath = s.file.replace('.md', '.起草中.txt')
    const staged = { ...s.result, value: { path: stagedPath, after: '甲' } } as ToolExecutionResult
    const exec = { ...s.exec, arguments: { file_path: stagedPath } }
    expect(receipt(await s.invoke(exec, staged))).toMatchObject({ 文本阶段: '起草暂存', 距目标剩余汉字数: 2 })
    expect(receipt(await s.invoke(exec, staged))).not.toHaveProperty('篇幅核对')
    expect(receipt(await s.invoke(exec, staged))).not.toHaveProperty('身份检查')
    const contract = path.join(s.workspace, '测试书/作品契约/契约.md')
    fs.writeFileSync(contract, serializeDocument({ 书id: 'test' },
      '## 阅读体验与情绪承诺 〔已确认〕\n### 章节篇幅\n- 目标汉字数: 1\n- 下限汉字数: 1\n- 上限汉字数: 2'))
    expect(receipt(await s.invoke())).toMatchObject({ 篇幅核对: { 结果: '偏长', 差额: 1 } })
    fs.appendFileSync(contract, '\n- 上限汉字数: 2')
    expect(receipt(await s.invoke())).toMatchObject({ 篇幅核对: { 结果: '配置错误' } })
    fs.unlinkSync(path.join(s.workspace, '测试书/作品契约/契约.md'))
    // Without a book identity there is no safe book to attach a count to.
    expect(await s.invoke()).not.toHaveProperty('additionalContexts')
  })

  it('成功保存字符串身份时立即反馈问题，合法对象按 after 核对且不改变原结果', async () => {
    const s = setup()
    const bad = { ...s.result, value: { path: s.file, after: serializeDocument({ 身份: '卷01-0005-夜渡', 版本: 3 }, '甲乙𠮷') } } as ToolExecutionResult
    const decision = { kind: 'accept' as const, value: 'native projection' }
    const response = await s.invoke(s.exec, bad, decision)
    expect(response).toMatchObject(decision)
    expect(receipt(response)).toMatchObject({ 正文统计: { 汉字数: 3 }, 身份检查: { 状态: '需核对' } })
    expect(bad.isError).toBe(false)
    const good = { ...s.result, value: { path: s.file, after: serializeDocument({ 身份: { 卷: 1, 章: 5, 章名: '夜渡' }, 版本: 3 }, '甲乙𠮷') } } as ToolExecutionResult
    expect(receipt(await s.invoke(s.exec, good))).toMatchObject({ 身份检查: { 范围: '格式与目录', 状态: '通过', 问题: [] } })
    expect(fs.readFileSync(s.file, 'utf8')).toBe('磁盘可能已经被后续操作改动')
  })
})
