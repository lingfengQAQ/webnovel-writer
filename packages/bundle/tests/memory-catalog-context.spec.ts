import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { writeAuthorMemory, writeBookMemory } from '@webnovel/core'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { attachInitialMemoryCatalog, MEMORY_CATALOG_SOURCE, bookMemoryCatalogText } from '../src/status-context'
import { createNovelTools } from '../src/novel-tools'
import { nativeWriteStub } from './fixtures/native-write-stub'
import { removeSync } from '../../core/src/repo/remove'

const roots: string[] = []
afterAll(() => roots.forEach(root => removeSync(root)))
function makeWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-memctx-'))
  roots.push(dir)
  const book = path.join(dir, '星辰')
  fs.mkdirSync(path.join(book, '作品契约'), { recursive: true })
  fs.writeFileSync(path.join(book, '作品契约/契约.md'), '---\n书id: xingchen-001\n---\n正文\n')
  return dir
}

function harness(workspaceRoot: () => string | undefined, history: UserMessage[] = []) {
  let listener: (payload: unknown, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>
  let disposed = false
  const ctx = { on: (_name: string, callback: typeof listener) => { listener = callback; return () => { disposed = true } } }
  const agent = { ctx, session: { get seq() { return history.length }, eventAt: (seq: number) => ({ type: 'user/message', data: history[seq] }) } }
  const dispose = attachInitialMemoryCatalog(ctx as never, { workspaceRoot })
  return {
    dispose, history, isDisposed: () => disposed,
    run: async (options: { rejected?: boolean; aborted?: boolean; commit?: boolean; delegated?: boolean; messages?: UserMessage[] } = {}) => {
      const decision: PreStepDecision = options.rejected ? { kind: 'reject', reason: 'fixture' } as PreStepDecision : { kind: 'enter', messages: options.messages ?? [] }
      const signal = options.aborted ? AbortSignal.abort() : new AbortController().signal
      const result = await listener({ agent: options.delegated ? { ...agent, ctx: {} } : agent, signal }, async () => decision)
      if (result.kind === 'enter' && !options.aborted && options.commit !== false) history.push(...result.messages)
      return result
    },
  }
}
const contents = (messages: readonly UserMessage[]) => messages.flatMap(m => m.content.flatMap(p => p.type === 'text' ? [p.text] : [])).join('\n')
const write = (ws: string, name: string) => writeAuthorMemory(ws, { 名称: name, 描述: `作者喜欢 {{${name}}}`, 类: '文风', 标签: ['星辰'], 来源: '对谈', 正文: '正文不进目录' })

describe('作者记忆目录：独立的一次性原生消息（15A）', () => {
  it('首次发送，后续记忆或其他运行时context变化不重发，花括号保持原文', async () => {
    const ws = makeWorkspace()
    write(ws, '冷开场')
    const host = harness(() => ws)
    await host.run({ delegated: true })
    expect(host.history).toHaveLength(0)
    await host.run()
    expect(host.history).toHaveLength(1)
    expect(host.history[0]!.source).toMatchObject({ kind: MEMORY_CATALOG_SOURCE })
    expect(contents(host.history)).toContain('作者喜欢 {{冷开场}}')
    expect(contents(host.history)).not.toContain('正文不进目录')
    write(ws, '新记忆')
    for (let i = 0; i < 3; i++) await host.run({ messages: [createUserMessage({ content: [{ type: 'text', text: `变动状态${i}` }], source: { kind: 'runtime-context' } })] })
    expect(host.history.filter(m => m.source.kind === MEMORY_CATALOG_SOURCE)).toHaveLength(1)
    expect(contents(host.history)).not.toContain('新记忆')
    host.dispose()
    expect(host.isDisposed()).toBe(true)
  })

  it('工作范围迟到：首次就绪后才发送，没有记忆时也给索引入口', async () => {
    const ws = makeWorkspace()
    let ready = false
    const host = harness(() => ready ? ws : undefined)
    await host.run()
    expect(host.history).toHaveLength(0)
    ready = true
    await host.run()
    expect(contents(host.history)).toContain('目前没有作者记忆')
    expect(contents(host.history)).toContain(path.join(ws, '书房/作者记忆/索引.md'))
  })

  it('拒绝、取消和未提交的步骤不吞掉首次发送', async () => {
    const ws = makeWorkspace()
    const host = harness(() => ws)
    await host.run({ rejected: true })
    await host.run({ aborted: true })
    await host.run({ commit: false })
    expect(host.history).toHaveLength(0)
    await host.run()
    await host.run()
    expect(host.history).toHaveLength(1)
  })

  it('恢复沿用已发送消息，目录后来变化也不追加；新会话读取新目录', async () => {
    const ws = makeWorkspace()
    const first = harness(() => ws)
    await first.run()
    write(ws, '恢复前新增')
    const restored = harness(() => ws, [...first.history])
    await restored.run()
    expect(restored.history).toHaveLength(1)
    expect(contents(restored.history)).not.toContain('恢复前新增')
    const fresh = harness(() => ws)
    await fresh.run()
    expect(contents(fresh.history)).toContain('恢复前新增')
  })

  it('兼容历史combined快照的已发送目录，不再另加一份', async () => {
    const ws = makeWorkspace()
    const legacy = createUserMessage({ content: [{ type: 'text', text: '旧目录' }], source: { kind: 'runtime-context', form: 'snapshot', sections: [{ name: 'webnovel.memory', text: '旧目录' }] } })
    const host = harness(() => ws, [legacy])
    await host.run()
    expect(host.history).toEqual([legacy])
  })
})

describe('本书记忆目录：随选书结果返回（15A）', () => {
  it('novel_select_book 成功返回 记忆目录（选书时快照）；普通查询不附目录；切书换书目录', async () => {
    const ws = makeWorkspace()
    const bookRoot = path.join(ws, '星辰')
    writeBookMemory(bookRoot, { 类: '决策', 名称: '不写系统', 正文: '全书无系统面板', 来源: '定稿/卷01/0001-开篇.md', 裁决记录: '作者批准' })
    const tools = createNovelTools({ nativeWrite: nativeWriteStub, workspaceRoot: () => ws, bookRootOfBookId: () => bookRoot })
    const select = tools.find((t) => t.name === 'novel_select_book')!
    const res = (await select.execute({ bookId: 'xingchen-001' })) as { ok: boolean; bookId: string; 记忆目录: string; message: string }
    expect(res.ok).toBe(true)
    expect(res.bookId).toBe('xingchen-001')
    expect(res.记忆目录).toContain('【本书记忆目录】选书时')
    expect(res.记忆目录).toContain('- 不写系统 — （缺描述）｜类：决策')
    expect(res.记忆目录).toContain(path.join(bookRoot, '本书记忆', '索引.md'))
    expect(res.记忆目录).not.toContain('全书无系统面板')
    expect(res.message).not.toContain('记忆目录')
    const status = tools.find((t) => t.name === 'novel_get_story_status')!
    const statusRes = (await status.execute({ bookId: 'xingchen-001' })) as Record<string, unknown>
    expect(statusRes['记忆目录']).toBeUndefined()
    expect(JSON.stringify(statusRes)).not.toContain('记忆目录')
    // 切书：另一本书返回自己的目录
    const other = path.join(ws, '夜航')
    fs.mkdirSync(path.join(other, '作品契约'), { recursive: true })
    fs.writeFileSync(path.join(other, '作品契约', '契约.md'), '---\n书id: yehang-002\n---\n', 'utf8')
    const res2 = (await select.execute({ bookId: 'yehang-002' })) as { ok: boolean; 记忆目录: string }
    expect(res2.ok).toBe(true)
    expect(res2.记忆目录).toContain('目前没有本书记忆')
    expect(res2.记忆目录).toContain(path.join(other, '本书记忆', '索引.md'))
    expect(res2.记忆目录).not.toContain('不写系统')
    // 选书失败不带目录
    const bad = (await select.execute({ bookId: '不存在' })) as Record<string, unknown>
    expect(bad['ok']).toBe(false)
    expect(bad['记忆目录']).toBeUndefined()
    expect(bookMemoryCatalogText(path.join(ws, '不存在的书'))).toContain('目前没有本书记忆')
  })
})
