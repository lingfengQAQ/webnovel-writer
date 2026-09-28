import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ToolExecutionInput, ToolExecutionResult, ToolExecutionToken, ToolRuntime } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createNativeWriteBridge } from '../src/native-write'
import { createNovelTools, type ToolExecContext } from '../src/novel-tools'
import { removeSync } from '../../core/src/repo/remove'

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-native-')) })
afterEach(() => { removeSync(root) })
const op = { relPath: '大纲/故事骨架.md', content: '# 完整正文\n' }
const success: ToolExecutionResult = { isError: false, value: { written: true }, content: [] }
const context = (signal = new AbortController().signal): ToolExecContext => ({
  agent: { id: 'main' }, token: Symbol('business-call') as ToolExecutionToken,
  callId: 'business-call', rootCallId: 'model-call', signal,
})

describe('受信原生写入桥', () => {
  it('只放行当前嵌套 callId、parent、Agent 实例、write、目标和正文的完整匹配', async () => {
    let dispatch!: ToolExecutionInput
    let resolve!: (result: ToolExecutionResult) => void
    const execute: ToolRuntime['execute'] = async input => {
      dispatch = input
      return new Promise(done => { resolve = done })
    }
    const bridge = createNativeWriteBridge({ execute })
    const exec = context()
    const task = bridge.write(root, op, exec)
    expect(dispatch).toMatchObject({ name: 'write', agent: exec.agent, parent: exec.token, rootCallId: exec.rootCallId, signal: exec.signal })
    expect(dispatch.arguments).toEqual({ file_path: path.resolve(root, op.relPath), content: op.content })
    expect(bridge.allows(dispatch)).toBe(true)
    for (const changed of [
      { callId: 'unrelated-call' }, { parent: Symbol('unrelated') }, { parent: undefined },
      { agent: { id: 'main' } }, { name: 'edit' }, { name: 'read' },
      { arguments: { file_path: path.resolve(root, '作品契约/契约.md'), content: op.content } },
      { arguments: { file_path: path.resolve(root, op.relPath), content: '伪造正文' } },
    ]) expect(bridge.allows({ ...dispatch, ...changed })).toBe(false)
    expect(createNativeWriteBridge({ execute }).allows(dispatch)).toBe(false)
    resolve(success)
    await task
    expect(bridge.allows(dispatch)).toBe(false)
  })

  it('失败与取消都清理授权；保留原生错误和附加上下文', async () => {
    const extra = createUserMessage({ content: [{ type: 'text', text: '请重读文件后重试' }], source: { kind: 'user' } })
    let dispatch!: ToolExecutionInput
    const execute = vi.fn<ToolRuntime['execute']>(async input => {
      dispatch = input
      return { isError: true, content: [], error: { message: 're-read the file, then retry' }, additionalContexts: [extra] }
    })
    const bridge = createNativeWriteBridge({ execute })
    const deferContext = vi.fn()
    await expect(bridge.write(root, op, { ...context(), deferContext })).rejects.toThrow('re-read the file, then retry')
    expect(deferContext).toHaveBeenCalledWith(extra)
    expect(bridge.allows(dispatch)).toBe(false)
    const controller = new AbortController()
    controller.abort(new Error('已取消'))
    await expect(bridge.write(root, op, context(controller.signal))).rejects.toThrow('已取消')
    expect(execute).toHaveBeenCalledTimes(1)
    execute.mockImplementationOnce(async input => {
      dispatch = input
      return new Promise((_resolve, reject) => input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true }))
    })
    const waiting = new AbortController()
    const task = bridge.write(root, op, context(waiting.signal))
    waiting.abort(new Error('等待中取消'))
    await expect(task).rejects.toThrow('等待中取消')
    expect(bridge.allows(dispatch)).toBe(false)
  })

  it('成功时透传 concludeTurn，卸载后当前与后续调用均无放行凭证', async () => {
    let dispatch!: ToolExecutionInput
    let resolve!: (result: ToolExecutionResult) => void
    const execute = vi.fn<ToolRuntime['execute']>(async input => {
      dispatch = input
      return new Promise(done => { resolve = done })
    })
    const bridge = createNativeWriteBridge({ execute })
    const concludeTurn = vi.fn()
    const task = bridge.write(root, op, { ...context(), concludeTurn })
    bridge.dispose()
    expect(bridge.allows(dispatch)).toBe(false)
    resolve({ ...success, concludesTurn: true })
    await task
    expect(concludeTurn).toHaveBeenCalledTimes(1)
    await expect(bridge.write(root, op, context())).rejects.toThrow(/上下文不可用/)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('缺执行上下文或路径越界时不调用宿主', async () => {
    const execute = vi.fn<ToolRuntime['execute']>()
    const bridge = createNativeWriteBridge({ execute })
    for (const exec of [undefined, {}, { ...context(), token: undefined }, { ...context(), agent: undefined }, { ...context(), signal: undefined }]) {
      await expect(bridge.write(root, op, exec)).rejects.toThrow(/上下文不可用/)
    }
    await expect(bridge.write(root, { ...op, relPath: '../越界.md' }, context())).rejects.toThrow(/不在书仓内/)
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('设计工具写入前置条件', () => {
  it('宿主能力缺席时拒绝直接覆盖；业务校验失败时不发起原生写入', async () => {
    fs.mkdirSync(path.join(root, '大纲/卷规划/卷01'), { recursive: true })
    fs.writeFileSync(path.join(root, '大纲/故事骨架.md'), '原文\n')
    const deps = { workspaceRoot: () => root, bookRootOfBookId: () => root }
    const missing = createNovelTools(deps).find(tool => tool.name === 'novel_update_skeleton')!
    expect(await missing.execute({ bookId: 'book', 正文: '新文' })).toMatchObject({ ok: false, reason: expect.stringMatching(/无版本保护/) })
    expect(fs.readFileSync(path.join(root, '大纲/故事骨架.md'), 'utf8')).toBe('原文\n')
    const nativeWrite = vi.fn()
    const tools = createNovelTools({ ...deps, nativeWrite })
    const invalid = tools.find(tool => tool.name === 'novel_confirm_volume_outline')!
    expect(await invalid.execute({ bookId: 'book', 卷: 1, 目标: '卷纲', 正文: '缺少四段卷纲' })).toMatchObject({ ok: false, reason: expect.stringMatching(/段落不完整/) })
    fs.writeFileSync(path.join(root, '大纲/故事骨架.md'), '---\n版本: [坏格式\n---\n旧文')
    const skeleton = tools.find(tool => tool.name === 'novel_update_skeleton')!
    expect(await skeleton.execute({ bookId: 'book', 正文: '新文' })).toMatchObject({ ok: false, reason: expect.stringMatching(/解析失败/) })
    expect(nativeWrite).not.toHaveBeenCalled()
  })
})
