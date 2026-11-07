import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createPreferencesStore, followPreference, preferencesFor } from '../src/client/preferences'
import { ScriptorBundleConfig } from '../src/client/bundle-config'
import { openPluginTarget as openBundleTarget } from '../src/client/plugin-target'
import { openPluginTarget as openRetrievalTarget } from '../../embedding-provider/src/plugin-nav'
import type { WebnovelPreferencesInput } from '../src/preferences'
import type { ClientHost } from '../src/client/host'
import { retrievalSettingsLink } from '../src/client/retrieval-settings-link'
import { NovelToolCard } from '../src/client/tool-result-card'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'

function form(initial: WebnovelPreferencesInput = {}) {
  let state: ConfigFormSnapshot<WebnovelPreferencesInput> = { status: 'ready', value: initial, user: initial, base: {}, revision: 1, writable: true }
  const listeners = new Set<() => void>()
  let accepted = true
  const publish = (next: Partial<typeof state>) => { state = { ...state, ...next }; for (const listener of listeners) listener() }
  const mutate = vi.fn(async (ops: readonly { path: readonly string[]; value?: unknown }[], expected?: number) => {
    if (!accepted || expected !== state.revision) return false
    publish({ value: { ...state.value, [ops[0]!.path[0]!]: ops[0]!.value }, revision: state.revision! + 1 })
    return true
  })
  return { getSnapshot: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    mutate, publish, refuse: () => { accepted = false } }
}
const renders: ReactTestRenderer[] = []
afterEach(async () => { await act(async () => { for (const view of renders.splice(0)) view.unmount() }); vi.useRealTimers() })

describe('shared Scriptor preference view', () => {
  it.each([
    ['novel_search_finalized', { ok: true, mode: 'keyword', degraded: '未启用或未配置嵌入提供方，本次仅检索关键词', index: { phase: 'disabled' } }, 'webnovel-embeddings'],
    ['novel_index_manage', { ok: true, index: { phase: 'unconfigured', providerConfigured: false } }, 'webnovel-embeddings'],
    ['novel_index_manage', { ok: true, index: { phase: 'failed', providerConfigured: true } }, undefined],
    ['novel_search_finalized', { ok: true, mode: 'hybrid', reranking: { applied: false, reason: '请求超时' } }, 'webnovel-reranking'],
  ] as const)('offers settings for a successful but degraded %s result', async (toolName, value, rowId) => {
    expect(retrievalSettingsLink(toolName, JSON.stringify(value))).toEqual({ needsAttention: true,
      target: rowId ? { kind: 'row', rowId } : { kind: 'bundle', group: 'retrieval' } })
    const props = { toolName, phase: 'result', block: { content: [{ type: 'text', text: JSON.stringify(value) }], call: { argsRaw: '{}' }, isError: false },
      useDisclosure: () => ({ expanded: false, toggle() {} }), host: {} as ClientHost } as unknown as ToolCallViewProps & { host: ClientHost }
    let card!: ReactTestRenderer
    await act(async () => { card = create(React.createElement(NovelToolCard, props)) })
    renders.push(card)
    expect(card.root.findAllByType('button').some(button => button.children.includes('打开检索设置'))).toBe(true)
  })
  it('does not infer an embedding problem from quoted source text or a deliberate keyword query', () => {
    expect(retrievalSettingsLink('novel_search_finalized', JSON.stringify({ ok: true, mode: 'keyword', degraded: '本次指定关键词模式', hits: [{ snippet: 'unconfigured 未配置嵌入' }] })))
      .toEqual({ needsAttention: false, target: { kind: 'bundle', group: 'retrieval' } })
    expect(retrievalSettingsLink('novel_check_book', '{"ok":false}')).toBeUndefined()
  })
  it('saves one field with its observed revision and propagates accepted external edits', async () => {
    const source = form(), store = createPreferencesStore()
    store.bind(source as unknown as ConfigForm<WebnovelPreferencesInput>)
    expect(await store.set('showVisualTab', false)).toBe(true)
    expect(source.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['showVisualTab'], value: false }], 1)
    source.publish({ value: { defaultVisualMode: 'graph' }, revision: 5 })
    expect(store.getSnapshot().value.defaultVisualMode).toBe('graph')
    expect(store.getSnapshot().value.showVisualTab).toBe(true)
  })
  it('rolls back refused optimistic preferences and keeps a visible explanation', async () => {
    const source = form(), store = createPreferencesStore()
    store.bind(source as unknown as ConfigForm<WebnovelPreferencesInput>); source.refuse()
    expect(await store.set('autoIndexOnCommit', true)).toBe(false)
    expect(store.getSnapshot()).toMatchObject({ value: { autoIndexOnCommit: false }, busy: false, notice: expect.stringContaining('未保存') })
    source.publish({ writable: false })
    expect(await store.set('showLayoutSwap', false)).toBe(false)
    expect(source.mutate).toHaveBeenCalledTimes(1)
  })
  it('unregisters, restores and releases the visibility entry without duplicate registration', () => {
    const source = form(), store = createPreferencesStore(), unmount = vi.fn(), mount = vi.fn(() => unmount)
    store.bind(source as unknown as ConfigForm<WebnovelPreferencesInput>)
    const off = followPreference(store, 'showVisualTab', mount)
    source.publish({ value: { showVisualTab: false } })
    expect(unmount).toHaveBeenCalledTimes(1)
    source.publish({ value: { showVisualTab: false, showIndexGuideCard: false } })
    expect(unmount).toHaveBeenCalledTimes(1)
    source.publish({ value: { showVisualTab: true } })
    expect(mount).toHaveBeenCalledTimes(2)
    off(); expect(unmount).toHaveBeenCalledTimes(2)
  })
  it('renders all eight preferences in three groups and disables writes for an unavailable Host', async () => {
    const host = {} as ClientHost, source = form()
    const store = preferencesFor(host)
    const detach = store.bind(source as unknown as ConfigForm<WebnovelPreferencesInput>)
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(React.createElement(ScriptorBundleConfig, { host })) })
    renders.push(renderer)
    expect(renderer.root.findAll(node => !!node.props['data-webnovel-pref-group']).map(node => node.props['data-webnovel-pref-group'])).toEqual(['visibility', 'views', 'retrieval'])
    expect(renderer.root.findAllByType('input').filter(node => node.props.type === 'checkbox')).toHaveLength(6)
    expect(renderer.root.findAll(node => node.props.role === 'tablist')).toHaveLength(2)
    await act(async () => { detach() })
    expect(renderer.root.findAllByType('input').every(node => node.props.disabled)).toBe(true)
    expect(source.mutate).not.toHaveBeenCalled()
  })
})

describe.each([['Scriptor', openBundleTarget], ['retrieval', openRetrievalTarget]] as const)('%s plugin navigation', (_name, open) => {
  it('selects the installed owner and opens a row through the actual plugin navigation store', () => {
    const openBundle = vi.fn(), setView = vi.fn(), close = vi.fn()
    const host = { get: () => ({ openBundle }), slots: { entries: (slot: string) => slot === 'sidebar.settings' ? [{ store: { create: () => ({ actions: { close } }) } }] : [{
      options: { key: 'plugins' }, inject: () => ({ hooks: { pluginManager: { getSnapshot: () => ({ status: 'ready', packages: [
        { name: 'full', installed: false, rows: [{ rowId: 'embedding' }] }, { name: 'retrieval', installed: true, rows: [{ rowId: 'embedding' }] },
      ] }) } } }), store: { create: () => ({ actions: { setView } }) },
    }] } }
    open(host, ['full', 'retrieval'], 'embedding')
    expect(openBundle).toHaveBeenCalledWith('retrieval')
    expect(setView).toHaveBeenCalledWith({ kind: 'row', name: 'retrieval', rowId: 'embedding' })
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('cancels a pending inventory wait when the client unloads', () => {
    vi.useFakeTimers()
    let dispose!: () => void
    const listeners = new Set<() => void>(), openBundle = vi.fn()
    const host = { get: () => ({ openBundle }), effect: (fn: () => () => void) => { dispose = fn() }, slots: { entries: () => [{
      options: { key: 'plugins' }, inject: () => ({ ensure() {}, hooks: { pluginManager: {
        getSnapshot: () => ({ status: 'loading' }), subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
      } } }),
    }] } }
    open(host, ['full']); expect(listeners.size).toBe(1)
    dispose(); expect(listeners.size).toBe(0)
    vi.runAllTimers(); expect(openBundle).toHaveBeenCalledTimes(1)
  })
})
