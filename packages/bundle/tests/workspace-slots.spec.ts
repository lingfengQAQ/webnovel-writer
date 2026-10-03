import React from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientHost, NativeEntry, WorkspaceProps } from '../src/client/host'
import { createEditorStore } from '../src/client/store'
import { installWorkspaceStudyTabs } from '../src/client/workspace-slots'

const workspace = 'sidebar.workspaces'
const flow = `${workspace}.directoryFlow`
const menu = `${workspace}.session.menu.item`
const actions = `${workspace}.session.row.action`
const leading = 'sidebar.session.row.leading'
const hover = 'sidebar.session.row.hover'
const mirrored = (key: string) => `webnovel.${key}`
const Placeholder = () => null

function fixture() {
  const core = new SlotCore()
  const register = core.register.bind(core) as ClientHost['slots']['register']
  register({ name: 'root', children: { [workspace]: { kind: 'single', scope: 'root' } } }, Placeholder)
  const hookContext = [true, vi.fn()]
  const owner = { sessionId: 'session-one', displayTitle: '验收会话' }
  const menuHooks = { hooks: { menuOpenState: vi.fn() } }
  const nativeChildren = {
    [flow]: { kind: 'single' as const, scope: 'root' as const },
    [menu]: { kind: 'list' as const, scope: 'root' as const, inject: menuHooks },
    [actions]: { kind: 'list' as const, scope: 'root' as const },
    [leading]: { kind: 'list' as const, scope: 'root' as const },
    [hover]: { kind: 'list' as const, scope: 'root' as const },
  }
  register({ name: workspace, children: nativeChildren }, (props: WorkspaceProps) => React.createElement(React.Fragment, null,
    props.renderSlot(flow, { open: false }),
    props.renderSlot(menu, owner, { hookContext }),
    props.renderSlot(actions, owner),
    props.renderSlot(leading, { sessionId: owner.sessionId }),
    props.renderSlot(hover, { sessionId: owner.sessionId }),
  ))
  const offFlow = register({ name: flow }, Placeholder)
  const store = {}, inject = vi.fn(() => ({})), label = () => '重命名'
  register({ name: menu, id: 'rename', order: 200, locale: 'workspace', store, inject, label }, Placeholder)
  register({ name: menu, id: 'pin', order: 100 }, Placeholder)
  register({ name: actions, id: 'archive', order: 100 }, Placeholder)
  let dispose!: () => void
  const host = { slots: {
    register, entries: core.entries.bind(core), subscribe: core.subscribe.bind(core),
    inject(_name: string, callback: () => () => void) { dispose = callback() },
  } } as unknown as ClientHost
  installWorkspaceStudyTabs({ host, store: createEditorStore() })
  return { core, register, dispose: () => dispose(), owner, hookContext, menuHooks, store, inject, label, offFlow }
}

describe('原生工作区子插槽转发（#178）', () => {
  it('分别渲染目录、菜单、行内操作和装饰，原样传递菜单上下文', () => {
    const f = fixture()
    const entry = f.core.entries('webnovel.workspaces')[0] as unknown as NativeEntry
    const renderSlot = vi.fn((key: string) => {
      // Match the native renderer authorization boundary: undeclared keys fail.
      expect(entry.children).toHaveProperty(key)
      return React.createElement('span', null, f.core.entriesOfSlot(key).map(item => item.options.id).join(','))
    })
    let rendered!: ReturnType<typeof create>
    act(() => { rendered = create(React.createElement(entry.component, { wide: true, expandSidebar: vi.fn(), renderSlot, useSessions: vi.fn() })) })
    expect(renderSlot.mock.calls.map(call => call[0])).toEqual([flow, menu, actions, leading, hover].map(mirrored))
    expect(renderSlot).toHaveBeenCalledWith(mirrored(menu), f.owner, { hookContext: f.hookContext })
    expect(rendered.root.findAllByType('span')[1]!.children).toEqual(['pin,rename'])
    expect(f.core.specDynamic(mirrored(menu))?.inject).toBe(f.menuHooks)
    expect(f.core.entries(mirrored(menu))[1]).toMatchObject({ options: { id: 'rename', order: 200, label: f.label }, locale: 'workspace', store: f.store, inject: f.inject })
    act(() => rendered.unmount()); f.dispose()
  })

  it('同步菜单动作的新增、优先级覆盖和卸载，不重建未变的条目', async () => {
    const f = fixture(), pin = f.core.entries(mirrored(menu))[0]
    const remove = f.register({ name: menu, id: 'rename', priority: -20, order: 50 }, Placeholder)
    await Promise.resolve()
    expect(f.core.entriesOfSlot(mirrored(menu)).map(entry => entry.options.id)).toEqual(['rename', 'pin'])
    expect(f.core.entries(mirrored(menu))).toContain(pin)
    remove(); await Promise.resolve()
    expect(f.core.entriesOfSlot(mirrored(menu)).map(entry => entry.options.id)).toEqual(['pin', 'rename'])
    f.offFlow(); await Promise.resolve()
    expect(f.core.entries(mirrored(flow))).toHaveLength(0)
    f.register({ name: flow }, Placeholder); await Promise.resolve()
    expect(f.core.entries(mirrored(flow))).toHaveLength(1)
    f.dispose()
    f.register({ name: menu, id: 'late', order: 300 }, Placeholder); await Promise.resolve()
    expect(f.core.entries(mirrored(menu))).toHaveLength(0)
    expect(f.core.specDynamic(mirrored(menu))).toBeUndefined()
    expect(f.core.entries(workspace)).toHaveLength(1)
    expect(f.core.entries(menu)).toHaveLength(3)
  })

  it('保留第三方菜单条目的嵌套子插槽，并在卸载时清理', async () => {
    const f = fixture(), nested = 'extension.session.action'
    const remove = f.register({ name: menu, id: 'extension', order: 300, children: { [nested]: { kind: 'single', scope: 'root' } } }, Placeholder)
    f.register({ name: nested, locale: 'extension' }, Placeholder)
    await Promise.resolve()
    expect(f.core.entries(mirrored(nested))[0]?.locale).toBe('extension')
    remove(); await Promise.resolve()
    expect(f.core.entries(mirrored(nested))).toHaveLength(0)
    expect(f.core.specDynamic(mirrored(nested))).toBeUndefined()
    f.dispose()
  })
})
