import React from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installIndexSidebar } from '../src/client/indexing'
import type { ClientHost } from '../src/client/host'
import type { IndexSelection } from '../src/client/index-state'

type Props = { sessionId: string; selection: IndexSelection }
type Request = { sessionId: string; space: string; signal: AbortSignal; resolve: (value?: object) => void; reject: (error: Error) => void }
const renderers: ReactTestRenderer[] = []
const cleanups: (() => void)[] = []
let requests: Request[]
let rejectOnAbort: boolean
function view(space: string, extra: object = {}) {
  return { schema: 1, auto: false, paused: false, generation: 0, phase: 'ready', chapters: 1, completedChapters: 1,
    chunks: 1, completedChunks: 1, generated: 1, reused: 0, failed: 0, attempt: 0, maxRetries: 5, updatedAt: 0,
    errors: [], bookId: space, bookName: space, providerConfigured: true, sceneConfigured: false, ...extra }
}
const response = (value: object) => new Response(JSON.stringify({ ok: true, value }), { status: 200 })
beforeEach(() => {
  requests = []; rejectOnAbort = true
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { sessionId: string; space: string }
    if (url.endsWith('/index-control')) return new Promise<Response>((resolve, reject) => {
      const signal = init.signal as AbortSignal
      requests.push({ ...body, signal, resolve: value => resolve(response(view(body.space, value))), reject })
      signal.addEventListener('abort', () => { if (rejectOnAbort) reject(new Error('cancelled')) }, { once: true })
    })
    return response(url.endsWith('/shelf') ? { books: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }] } : view(body.space))
  }))
})
afterEach(async () => {
  await act(async () => { for (const renderer of renderers.splice(0)) renderer.unmount() })
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  vi.unstubAllGlobals()
})
function sidebar() {
  let Component!: React.ComponentType<Props>
  let inject!: (sessionId: string) => Props
  const host = {
    effect(fn: () => unknown) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup as () => void) },
    sidebarRightTabs: { register() { return () => {} } },
    slots: { inject(_name: string, fn: () => void) { fn() }, register(options: { inject: typeof inject }, component: typeof Component) { inject = options.inject; Component = component; return () => {} } },
    sessions: { list: { getSnapshot: () => ({ byId: { 'session-a': { retainedBy: { mainView: 1 } } } }) } }, sidebarRight: { openTab() {} },
  }
  installIndexSidebar(host as unknown as ClientHost)
  return { Component, inject }
}
async function mount(installed = sidebar(), sessionId = 'session-a') {
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(React.createElement(installed.Component, installed.inject(sessionId))) })
  renderers.push(renderer)
  return renderer
}
function text(node: ReactTestInstance): string { return node.children.map(child => typeof child === 'string' ? child : text(child)).join('') }
const update = (renderer: ReactTestRenderer) => renderer.root.findAllByType('button').find(button => text(button) === '立即更新')!
async function choose(renderer: ReactTestRenderer, space: string) {
  await act(async () => { renderer.root.findByProps({ 'aria-label': '选择索引作品' }).props.onChange({ target: { value: space } }) })
}
async function run(renderer: ReactTestRenderer) { await act(async () => { update(renderer).props.onClick() }) }

describe('索引面板的真实 React 请求生命周期', () => {
  it('切书取消后再回原书，操作恢复可用', async () => {
    const panel = await mount()
    await run(panel)
    expect(update(panel).props.disabled).toBe(true)
    await choose(panel, 'B')
    expect(requests[0]!.signal.aborted).toBe(true)
    await choose(panel, 'A')
    expect(update(panel).props.disabled).toBe(false)
  })

  it('不配合取消的旧响应不能清除同书新请求的 busy 或发布旧结果', async () => {
    rejectOnAbort = false
    const panel = await mount()
    await run(panel)
    await choose(panel, 'B'); await choose(panel, 'A')
    expect(update(panel).props.disabled).toBe(false)
    await run(panel)
    expect(requests).toHaveLength(2)
    await act(async () => { requests[0]!.resolve({ generation: 99, bookName: '旧响应', phase: 'failed' }) })
    expect(update(panel).props.disabled).toBe(true)
    await act(async () => { requests[1]!.resolve() })
    expect(update(panel).props.disabled).toBe(false)
  })

  it('旧书 finally 不能解开新书请求，失败后可再次操作', async () => {
    rejectOnAbort = false
    const panel = await mount()
    await run(panel); await choose(panel, 'B'); await run(panel)
    await act(async () => { requests[0]!.resolve() })
    expect(update(panel).props.disabled).toBe(true)
    await act(async () => { requests[1]!.reject(new Error('网络失败')) })
    expect(update(panel).props.disabled).toBe(false)
    await run(panel)
    expect(requests).toHaveLength(3)
  })

  it('复用面板切换会话时取消原请求，迟到响应不影响新会话', async () => {
    rejectOnAbort = false
    const installed = sidebar(), panel = await mount(installed)
    await run(panel)
    await act(async () => { panel.update(React.createElement(installed.Component, installed.inject('session-b'))) })
    expect(requests[0]!.signal.aborted).toBe(true)
    await run(panel)
    expect(requests[1]!.sessionId).toBe('session-b')
    await act(async () => { requests[0]!.resolve() })
    expect(update(panel).props.disabled).toBe(true)
    await act(async () => { requests[1]!.resolve() })
    expect(update(panel).props.disabled).toBe(false)
  })

  it('同会话多面板独立 busy；关闭取消所属请求，重开可操作', async () => {
    rejectOnAbort = false
    const installed = sidebar(), first = await mount(installed), second = await mount(installed)
    await run(first)
    expect(update(second).props.disabled).toBe(false)
    await run(second)
    await act(async () => { first.unmount() })
    expect(requests[0]!.signal.aborted).toBe(true)
    expect(requests[1]!.signal.aborted).toBe(false)
    const reopened = await mount(installed)
    expect(update(reopened).props.disabled).toBe(false)
    await act(async () => { requests[0]!.resolve() })
    expect(update(second).props.disabled).toBe(true)
  })
})
