import { describe, expect, it } from 'vitest'
import { apply, registerWorkspaceRoot } from '../src/index'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** 宿主注入 askFn 的接线：裁决通道须由 ctx.userQuestions 供给，而非模型自证。 */
function makeWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-ask-wire-'))
  const book = path.join(dir, '星辰')
  fs.mkdirSync(path.join(book, '作品契约'), { recursive: true })
  fs.writeFileSync(path.join(book, '作品契约', '契约.md'), '---\n书id: xingchen-001\n---\n正文\n', 'utf8')
  return dir
}

interface Registered { readonly name: string; readonly execute: (a: unknown, e: unknown) => Promise<unknown> }

function applyWith(services: Record<string, unknown>): Registered[] {
  const registered: Registered[] = []
  const declared: string[][] = []
  // dsh 运行时对齐批：注册落点＝agent 的 scope 层（经 agentCtx.get('tools')）。
  // 桩 agent 的 ctx 与宿主共享同一 tools 记录器，模拟服务经 scope 链可达。
  const recorder = { register: (t: Registered) => { registered.push(t); return () => {} } }
  const agent = { id: 'a-1', ctx: { get: (n: string) => (n === 'tools' ? recorder : undefined) } }
  const scope = {
    logger: { info: () => {}, warn: () => {} },
    get: (n: string) => services[n],
    on: () => {},
    inject: (deps: readonly string[], cb: (s: unknown) => void) => {
      declared.push([...deps])
      if (deps.includes('connection')) return undefined
      cb(scope)
      return undefined
    },
  }
  const host = {
    ...scope,
    get: (n: string) => (n === 'agents' ? { list: () => [agent] } : (services as Record<string, unknown>)[n]),
  }
  ;(host as { inject: unknown }).inject = (deps: readonly string[], cb: (s: unknown) => void) => {
    declared.push([...deps])
    if (deps.includes('connection')) return undefined
    cb(host)
    return undefined
  }
  registerWorkspaceRoot(makeWorkspace())
  apply(host as never)
  ;(applyWith as unknown as { declared: string[][] }).declared = declared
  return registered
}

describe('askFn 宿主接线（裁决 14）', () => {
  it('tools 注册声明 userQuestions 依赖，服务后到亦可拿到', () => {
    applyWith({})
    const declared = (applyWith as unknown as { declared: string[][] }).declared
    expect(declared.some((d) => d.includes('tools') && d.includes('userQuestions'))).toBe(true)
  })

  it('宿主有 userQuestions 时注入裁决通道，不再因缺通道早退', async () => {
    const tools = applyWith({
      userQuestions: {
        // dsh 真源形状：{ answers: [{ id, selected }] }（user-questions/src/types.ts:63）
        ask: async () => ({ answers: [{ id: '定稿入档', selected: ['退回'] }] }),
      },
    })
    const settle = tools.find((t) => t.name === 'novel_settle_chapter')
    expect(settle).toBeDefined()
    const r = (await settle!.execute(
      { bookId: 'xingchen-001', 卷: 1, 章: 1, 章名: '第一章', summary: 'x' },
      { agent: { id: 'a-1' } },
    )) as { ok: boolean; reason?: string }
    expect(r.ok).toBe(false)
    // 通道已注入:失败原因不再是「缺通道」（问作者排在书解析等便宜前置之后）。
    expect(String(r.reason)).not.toContain('裁决通道未配置')
  })

  it('宿主无 userQuestions 时不注入，沉淀 fail-closed', async () => {
    const tools = applyWith({})
    const settle = tools.find((t) => t.name === 'novel_settle_chapter')!
    const r = (await settle.execute(
      { bookId: 'xingchen-001', 卷: 1, 章: 1, 章名: '第一章', summary: 'x' },
      { agent: { id: 'a-1' } },
    )) as { ok: boolean; reason?: string }
    expect(r.ok).toBe(false)
    expect(String(r.reason)).toContain('裁决通道')
  })
})
