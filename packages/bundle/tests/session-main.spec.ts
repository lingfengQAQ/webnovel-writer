import React from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { mainSessionOf, type ClientHost } from '../src/client/host'
import { useSession } from '../src/client/hooks'

type Row = { retainedBy?: Record<string, number | undefined> }

function fakeHost(rows: Record<string, Row>) {
  let snapshot = { byId: rows }
  const listeners = new Set<() => void>()
  return {
    publish(next: Record<string, Row>) { snapshot = { byId: next }; for (const listener of listeners) listener() },
    host: {
      sessions: {
        list: {
          getSnapshot: () => snapshot,
          subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
        },
      },
    } as unknown as ClientHost,
  }
}

describe('DSH 0.1.7 主会话解析', () => {
  it('主会话是 mainView 引用的行，忽略其他引用来源', () => {
    const { host } = fakeHost({
      'session-a': { retainedBy: { sidebar: 2 } },
      'session-b': { retainedBy: { mainView: 1 } },
    })
    expect(mainSessionOf(host)).toBe('session-b')
  })

  it('没有 mainView 引用时返回 undefined，而不是回退到任意会话', () => {
    const { host } = fakeHost({ 'session-a': { retainedBy: { sidebar: 1 } }, 'session-b': {} })
    expect(mainSessionOf(host)).toBeUndefined()
  })

  it('同一快照重复读取返回缓存值，新快照重新解析', () => {
    const { host, publish } = fakeHost({ 'session-a': { retainedBy: { mainView: 1 } } })
    expect(mainSessionOf(host)).toBe('session-a')
    expect(mainSessionOf(host)).toBe('session-a')
    publish({ 'session-b': { retainedBy: { mainView: 1 } } })
    expect(mainSessionOf(host)).toBe('session-b')
  })

  it('useSession 随列表发布切换主会话', async () => {
    const { host, publish } = fakeHost({ 'session-a': { retainedBy: { mainView: 1 } } })
    const seen: Array<string | undefined> = []
    function Probe() { const id = useSession(host); seen.push(id); return null }
    let renderer!: ReturnType<typeof create>
    await act(async () => { renderer = create(React.createElement(Probe)) })
    await act(async () => { publish({ 'session-b': { retainedBy: { mainView: 1 } } }) })
    await act(async () => { publish({}) })
    renderer.unmount()
    expect(seen[0]).toBe('session-a')
    expect(seen).toContain('session-b')
    expect(seen.at(-1)).toBeUndefined()
  })

  it('不同宿主实例的列表互不串缓存', () => {
    const first = fakeHost({ 'session-a': { retainedBy: { mainView: 1 } } })
    const second = fakeHost({ 'session-b': { retainedBy: { mainView: 1 } } })
    expect(mainSessionOf(first.host)).toBe('session-a')
    expect(mainSessionOf(second.host)).toBe('session-b')
  })
})
