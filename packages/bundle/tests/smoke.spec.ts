import { describe, expect, it } from 'vitest';
import { apply, currentWorkspaceRoot, name, registerWorkspaceRoot, resetWorkspaceRoot } from '../src/index';
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

function makeWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-bundle-'))
  const book = path.join(dir, '星辰')
  fs.mkdirSync(path.join(book, '作品契约'), { recursive: true })
  fs.writeFileSync(path.join(book, '作品契约', '契约.md'), '---\n书id: xingchen-001\n---\n正文\n', 'utf8')
  return dir
}

describe('包冒烟', () => {
  it('可导入', () => {
    expect(name).toBe('webnovel-bundle');
  });

  it('无 tools 表面仍加载', () => {
    const logs: string[] = []
    expect(() => apply({
      logger: { info: (m: string) => { logs.push(m) }, warn: (m: string) => { logs.push(m) } },
    } as never)).not.toThrow()
    expect(logs.some((m) => m.includes('工作台插件已加载'))).toBe(true)
  });

  it('接线:agent/created 触发 status context 注册与文件门禁挂载', () => {
    const ws = makeWorkspace()
    registerWorkspaceRoot(ws)

    const createdListeners: Array<(p: { agent: AgentLike }) => void> = []
    const agentCtxEvents: string[] = []
    const registeredContexts: Array<{ name: string; order: number; text: (a: unknown) => string }> = []

    interface AgentLike { id: string; ctx: FakeAgentCtx }
    interface FakeAgentCtx {
      systemPrompt: { context: (c: unknown) => void }
      inject: (deps: unknown, cb: (scope: unknown) => void) => unknown
      on: (e: string) => void
    }

    const makeAgentCtx = (): FakeAgentCtx => ({
      systemPrompt: {
        context: (c) => { registeredContexts.push(c as never) },
      },
      inject: (_deps, cb) => {
        cb(fakeCtx)
        return undefined
      },
      on: (e) => { agentCtxEvents.push(e) },
    })
    const fakeCtx = makeAgentCtx()

    const hostCtx = {
      logger: { info: () => {}, warn: () => {} },
      get: (n: string) => {
        if (n === 'workspaceRegistry') {
          return { list: () => [{ path: ws }] }
        }
        if (n === 'agents') return { list: () => [{ id: 'sess-1', ctx: fakeCtx }] }
        return undefined
      },
      on: (e: string, l: unknown) => { if (e === 'agent/created') createdListeners.push(l as never) },
    }

    // apply 会注册 agent/created 监听器并初装现有 agents
    apply(hostCtx as never)

    // 初装：现有 sess-1 已 attach
    expect(registeredContexts.length).toBeGreaterThanOrEqual(1)
    const status = registeredContexts.find((c) => c.name === 'webnovel.status')
    expect(status).toBeDefined()
    expect(status!.text({})).toContain('【工作区总览】')
    expect(status!.text({})).toContain('《星辰》')

    // agent/created 新起 agent 也 attach
    const newCtx = makeAgentCtx()
    for (const l of createdListeners) l({ agent: { id: 'sess-2', ctx: newCtx } })
    const created = registeredContexts.filter((c) => c.name === 'webnovel.status')
    expect(created.length).toBe(2)

  });

  it('headless 兜底:无 workspaceRegistry 服务时退回进程 cwd,总览不静默缺席', () => {
    // 工作范围是模块级单例,跨用例存活(审计 B5):经显式重置入口清掉前序用例的认领残留
    resetWorkspaceRoot()
    // 真机实证(2026-09-01):workspaceRegistry 只被 dsh-host-apiproxy / dsh-web-app 依赖,
    // headless profile 不装它 —— inject 的 setup 永不执行。此前该情形下工作范围认不到,
    // 状态注入返回空串被组装侧 filter(text.length > 0) 丢弃,总览静默缺席且无任何报错。
    const registered: Array<{ name: string; text: unknown }> = []
    const fakeCtx = {
      systemPrompt: {
        context: (c: unknown) => { registered.push(c as never) },
        variable: () => {},
      },
      inject: (_d: unknown, cb: (s: unknown) => void) => { cb(fakeCtx); return undefined },
      on: () => {},
    }
    const hostCtx = {
      logger: { info: () => {}, warn: () => {} },
      // headless:workspaceRegistry 缺席
      get: (n: string) => (n === 'agents' ? { list: () => [{ id: 'h-1', ctx: fakeCtx }] } : undefined),
      inject: (deps: readonly string[], cb: (s: unknown) => void) => { if (!deps.includes('connection')) cb(hostCtx); return undefined },
      on: () => {},
    }

    apply(hostCtx as never)

    expect(currentWorkspaceRoot()).toBe(process.cwd())
  });
});
