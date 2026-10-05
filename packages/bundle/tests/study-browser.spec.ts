import React from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { File, FileCode, FileText, FileType } from 'lucide-react'
import { WorkspaceStudyTabs } from '../src/client/browser'
import { createEditorStore } from '../src/client/store'
import type { ClientHost } from '../src/client/host'

type Frame = { kind: 'ready' } | { kind: 'change'; change: { absolutePath: string } }
const entry = (path: string, directory = false) => ({ ref: { space: 'book:a', path }, name: path.split('/').at(-1)!, directory, draft: false, absolutePath: '/w/甲/' + path })
const trees: Record<string, object[]> = {
  '': [entry('卷01', true), entry('设定.md'), entry('备忘.txt'), entry('配置.json'), entry('封面.png')],
  '卷01': [entry('卷01/0001.md')],
}
const shelf = { workspace: '/w', books: [{ id: 'book:a', name: '甲', progress: '第1章', absolutePath: '/w/甲' }], shared: false }
const renderers: ReactTestRenderer[] = []
let hold: Set<string>
let held: (() => void)[]
let streams: { name: string; push(frame: Frame): void }[]

beforeEach(() => {
  hold = new Set(); held = []; streams = []
  vi.stubGlobal('window', { setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const method = url.split('/').at(-1)!
    const body = JSON.parse(init.body as string) as { ref?: { path: string } }
    const key = method === 'tree' ? 'tree:' + body.ref!.path : method
    if (hold.has(key)) await new Promise<void>(resolve => held.push(resolve))
    const value = method === 'shelf' ? shelf : method === 'tree' ? trees[body.ref!.path] : []
    return new Response(JSON.stringify({ ok: true, value }), { status: 200 })
  }))
})
afterEach(async () => {
  await act(async () => { for (const renderer of renderers.splice(0)) renderer.unmount() })
  vi.unstubAllGlobals()
})

function remote() {
  return {
    workspaceFiles: { changes() { throw new Error('not used') } },
    $stream<T>({ name }: { name: string }) {
      const queue: T[] = []
      let wake: (() => void) | undefined, done = false
      streams.push({ name, push(frame) { queue.push(frame as T); wake?.() } })
      return {
        async *[Symbol.asyncIterator]() {
          while (!done) {
            if (queue.length) yield { value: queue.shift()!, accept() {} }
            else await new Promise<void>(resolve => { wake = resolve })
          }
        },
        async dispose() { done = true; wake?.() },
      }
    },
  }
}
const wait = (ms = 0) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })
async function mount() {
  const host = { sessions: { list: { getSnapshot: () => ({ byId: { s: { retainedBy: { mainView: 1 } } } }), subscribe: () => () => {} } }, get: (name: string) => name === 'remote' ? remote() : undefined }
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(React.createElement(WorkspaceStudyTabs, { wide: true, expandSidebar() {}, renderSlot: () => null, useSessions: (() => undefined) as never, host: host as unknown as ClientHost, store: createEditorStore() }))
  })
  renderers.push(renderer)
  await wait(); await wait()
  return renderer
}
function text(node: ReactTestInstance): string { return node.children.map(child => typeof child === 'string' ? child : text(child)).join('') }
const row = (renderer: ReactTestRenderer, name: string) => renderer.root.findAllByType('button').find(button => text(button).startsWith(name))
const release = async () => { hold.clear(); for (const resolve of held.splice(0)) resolve(); await wait(); await wait() }

describe('书房文件树', () => {
  it('首次读取书房时才显示顶部提示', async () => {
    hold.add('shelf')
    const renderer = await mount()
    expect(text(renderer.root)).toContain('正在读取书房…')
    await release()
    expect(text(renderer.root)).not.toContain('正在读取书房…')
    expect(row(renderer, '卷01')).toBeDefined()
  })

  it('展开目录触发的监听刷新不在顶部插入占位，也不丢展开状态', async () => {
    const renderer = await mount()
    hold.add('tree:卷01')
    await act(async () => { row(renderer, '卷01')!.props.onClick() })
    expect(renderer.root.findAllByProps({ role: 'status', 'aria-label': '读取中…' })).toHaveLength(1)
    await release()
    expect(row(renderer, '0001.md')).toBeDefined()

    hold.add('shelf'); hold.add('tree:'); hold.add('tree:卷01')
    await act(async () => { streams.at(-1)!.push({ kind: 'ready' }) })
    await wait(300)
    expect(held.length).toBeGreaterThan(0)
    expect(text(renderer.root)).not.toContain('正在读取书房…')
    expect(renderer.root.findAllByProps({ role: 'status', 'aria-label': '读取中…' })).toHaveLength(0)
    expect(row(renderer, '0001.md')).toBeDefined()
    await release()
    expect(row(renderer, '卷01')!.props['aria-expanded']).toBe(true)
    expect(row(renderer, '0001.md')).toBeDefined()
  })

  it('按文件类型区分图标', async () => {
    const renderer = await mount()
    const icon = (name: string) => row(renderer, name)!.findAll(node => [FileText, FileType, FileCode, File].includes(node.type as never))[0]?.type
    expect(icon('设定.md')).toBe(FileText)
    expect(icon('备忘.txt')).toBe(FileType)
    expect(icon('配置.json')).toBe(FileCode)
    expect(icon('封面.png')).toBe(File)
  })
})
