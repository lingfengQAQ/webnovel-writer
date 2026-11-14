import { afterAll, describe, expect, it, vi } from 'vitest'
import * as core from '@webnovel/core'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createNovelTools } from '../src/novel-tools'
import { nativeWriteStub } from './fixtures/native-write-stub'
import { removeSync } from '../../core/src/repo/remove'
import { settlementPack } from './fixtures/settlement-pack'

const roots: string[] = []
afterAll(() => { for (const root of roots) removeSync(root) })

const LEAK = /Error:|\(B\d|askFn|ASK_ABORTED|未装机|PRD §/

describe('所有工具的失败结果都有 code 与 next（PR-6）', () => {
  it('缺少或无效参数时，每个失败结果带 code、next，且不泄漏内部细节', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-failure-'))
    roots.push(ws)
    const tools = createNovelTools({ workspaceRoot: () => ws, bookRootOfBookId: () => undefined, nativeWrite: nativeWriteStub })
    let failures = 0
    for (const tool of tools) {
      for (const args of [{}, { bookId: 'missing-book', 卷: 0, 章: 0, 章名: '' }]) {
        let result: unknown
        try { result = await tool.execute(args) } catch { continue }
        const value = result as Record<string, unknown>
        if (value?.['ok'] !== false) continue
        failures++
        expect(typeof value['code'], `${tool.name} code`).toBe('string')
        expect(String(value['next'] ?? ''), `${tool.name} next`).not.toBe('')
        expect(String(value['reason']), `${tool.name} reason`).not.toMatch(LEAK)
      }
    }
    expect(failures).toBeGreaterThan(20)
  })

  it('输出 schema 都声明了 code 与 next', () => {
    const tools = createNovelTools({ workspaceRoot: () => undefined, bookRootOfBookId: () => undefined })
    for (const tool of tools) {
      const properties = (tool.output as { schema?: { properties?: Record<string, unknown> } }).schema?.properties
      if (properties === undefined) continue
      expect(properties, tool.name).toHaveProperty('code')
      expect(properties, tool.name).toHaveProperty('next')
    }
  })

  it('裁决通道不可用时给出 host-unavailable', async () => {
    const tools = createNovelTools({ workspaceRoot: () => undefined, bookRootOfBookId: () => undefined })
    const result = await tools.find(tool => tool.name === 'novel_settle_chapter')!.execute({ bookId: 'b' }) as Record<string, unknown>
    expect(result).toMatchObject({ ok: false, code: 'host-unavailable' })
    expect(String(result['reason'])).toContain('裁决通道')
  })

  it('运行目录链接不会被误报为需要改参数', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-runtime-link-')); roots.push(ws)
    const book = path.join(ws, 'book')
    const target = path.join(ws, 'runtime')
    fs.mkdirSync(book); fs.mkdirSync(target)
    fs.symlinkSync(target, path.join(book, '.webnovel'), process.platform === 'win32' ? 'junction' : 'dir')
    const tools = createNovelTools({ workspaceRoot: () => ws, bookRootOfBookId: () => book, nativeWrite: nativeWriteStub })
    for (const [name, args] of [
      ['novel_roll_window', { bookId: 'b', 卷: 1, action: '追加', 名称: '新章' }],
      ['novel_note_pending', { bookId: 'b' }],
    ] as const) {
      const result = await tools.find(tool => tool.name === name)!.execute(args)
      expect(result).toMatchObject({ ok: false, code: 'runtime-link', next: expect.stringContaining('运行路径') })
    }
    expect(fs.readdirSync(target)).toEqual([])
  })

  it('吃书请求返回的已知失败在外层转交时仍保留 code 与 next', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retcon-failure-result-')); roots.push(root)
    const failure = { ok: false as const, reason: 'opaque', code: 'transaction-conflict', next: '核对当前隔离备份' }
    const request = vi.spyOn(core, 'archiveRetconRequest').mockReturnValue(failure)
    try {
      const tools = createNovelTools({ workspaceRoot: () => root, bookRootOfBookId: () => root,
        askFn: async () => ({ answers: [{ id: '吃书补偿', selected: ['批准'] }] }),
      })
      const result = await tools.find(tool => tool.name === 'novel_apply_retcon')!.execute({ bookId: 'b', 卷: 1, 章: 1, 章名: '测试', 更正后正文: '更正正文' })
      expect(request).toHaveBeenCalledOnce()
      expect(result).toEqual(failure)
    } finally { request.mockRestore() }
  })

  it('裁决完成后加锁失败仍返回统一业务失败', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'settle-lock-failure-')); roots.push(root)
    settlementPack(root, 'b', { 卷: 1, 章: 1, 章名: '测试' })
    fs.writeFileSync(path.join(root, '.webnovel/book.lock'), JSON.stringify({ pid: process.pid, hostname: os.hostname() }))
    const tools = createNovelTools({ workspaceRoot: () => root, bookRootOfBookId: () => root,
      askFn: async () => ({ answers: [{ id: '定稿入档', selected: ['批准'] }] }),
    })
    const result = await tools.find(tool => tool.name === 'novel_settle_chapter')!.execute({ bookId: 'b', 卷: 1, 章: 1, 章名: '测试', summary: '测试' })
    expect(result).toMatchObject({ ok: false, code: 'book-locked', reason: expect.any(String), next: expect.stringContaining('重试一次') })
  })
})
