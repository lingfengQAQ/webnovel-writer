import React from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PluginConfigViewProps } from '../src/auxiliary-client'
import { apply } from '../src/client'

type RegisteredRow = (props: PluginConfigViewProps) => React.ReactNode
type RegisteredFooter = () => React.ReactNode

function text(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : text(child)).join('')
}

function createScope<T extends Record<string, unknown>>(initial: T, writable = true) {
  let snapshot: ConfigFormSnapshot<T> = {
    status: 'ready',
    value: initial,
    revision: 1,
    writable,
  }
  const listeners = new Set<() => void>()
  let mutateResult = true
  let mutateError: Error | undefined
  const mutations: Array<{ ops: readonly unknown[]; revision: number | undefined }> = []
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    mutate: vi.fn(async (ops: readonly unknown[], revision?: number) => {
      mutations.push({ ops, revision })
      if (mutateError) throw mutateError
      if (!mutateResult) return false
      const next: Record<string, unknown> = { ...(snapshot.value ?? {}) }
      for (const op of ops as Array<{ op: 'set' | 'unset'; path: readonly string[]; value?: unknown }>) {
        const key = op.path[0]!
        if (op.op === 'unset') delete next[key]
        else next[key] = op.value
      }
      snapshot = { ...snapshot, value: next as T, revision: (snapshot.revision ?? 0) + 1 }
      for (const listener of listeners) listener()
      return true
    }),
    setExternal(value: T, revision: number) {
      snapshot = { ...snapshot, value, revision }
      for (const listener of listeners) listener()
    },
    setMutateOutcome(options: { ok?: boolean; error?: Error }) {
      mutateResult = options.ok ?? true
      mutateError = options.error
    },
    mutations,
  }
  return scope as unknown as ConfigForm<T> & typeof scope
}

const renderers: ReactTestRenderer[] = []
afterEach(async () => {
  await act(async () => {
    for (const renderer of renderers.splice(0)) renderer.unmount()
  })
})

function setupHost(options?: { packages?: readonly { name: string; rows?: readonly { rowId: string }[] }[] }) {
  const rowConfigs = new Map<string, RegisteredRow>()
  const footers = new Map<string, RegisteredFooter>()
  const scopes = {
    'webnovel-embeddings': createScope({ enabled: false, protocol: 'openai-compatible', baseURL: 'https://api.example.com/v1', model: 'bge-m3', dimensions: 1024 }),
    'webnovel-scenes': createScope({ enabled: false, provider: 'deepseek', model: 'deepseek-chat', concurrency: 2 }),
    'webnovel-reranking': createScope({ enabled: false, endpoint: 'https://api.example.com/v1/rerank', model: 'bge-reranker-v2-m3', candidates: 40, timeoutMs: 30_000 }),
    'webnovel-graph': createScope({ enabled: false, provider: 'deepseek', model: 'deepseek-chat' }),
  }
  const openBundle = vi.fn()
  const setView = vi.fn()
  const setCredential = vi.fn(async () => ({ ok: true as const }))
  const describeCredential = vi.fn(async (refs: readonly string[]) => ({
    ok: true as const,
    value: Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true }])),
  }))
  const host = {
    effect(fn: () => unknown) {
      fn()
      return () => {}
    },
    get(name: string) {
      if (name === 'pluginNavigation') return { openBundle }
      if (name === 'remote.session') {
        return {
          modelCatalog: vi.fn(async () => ({
            ok: true as const,
            value: { groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }], failures: [] },
          })),
        }
      }
      return undefined
    },
    configForms: {
      get: (ns: keyof typeof scopes) => scopes[ns],
    },
    pluginNavigation: { openBundle },
    remote: {
      $on: () => () => {},
      credentials: {
        describe: describeCredential,
        set: setCredential,
      },
    },
    slots: {
      entries(slotName: string) {
        if (slotName !== 'main') return []
        return [{
          options: { key: 'plugins' },
          inject: () => ({
            ensure: vi.fn(async () => {}),
            hooks: {
              pluginManager: {
                getSnapshot: () => ({ status: 'ready', packages: options?.packages ?? [{ name: '@linfengqaqtat/dsh-scriptor-full', installed: true, rows: [{ rowId: 'webnovel-embeddings' }, { rowId: 'webnovel-scenes' }, { rowId: 'webnovel-reranking' }] }] }),
              },
            },
          }),
          store: { create: () => ({ actions: { setView } }) },
        }]
      },
      inject(_name: string, fn: () => unknown) {
        fn()
        return () => {}
      },
      register(reg: { name: string; key?: string; id?: string }, component: unknown) {
        if (reg.name === 'plugins.row.config' && reg.key) rowConfigs.set(reg.key, component as RegisteredRow)
        if (reg.name === 'settings.models.footer' && reg.id) footers.set(reg.id, component as RegisteredFooter)
        return () => {}
      },
    },
  }
  apply(host as unknown as Context)
  return { host, rowConfigs, footers, scopes, openBundle, setView, setCredential }
}

describe('检索增强插件管理页配置与模型设置页轻提示', () => {
  it('图谱和场景设置只展示模型与超时，不展示额度字段', async () => {
    const { rowConfigs } = setupHost()
    for (const kind of ['graph', 'scenes']) {
      const Page = rowConfigs.get('@linfengqaqtat/dsh-scriptor-full#webnovel-' + kind)!
      let renderer!: ReactTestRenderer
      await act(async () => { renderer = create(React.createElement(Page, { view: 'page' })) })
      renderers.push(renderer)
      const labels = renderer.root.findAllByType('input').map(node => node.props['aria-label'])
      expect(labels).not.toContain('单次输出 token 上限')
      expect(labels).not.toContain('单次完整输入字符上限')
      expect(labels).not.toContain('单章输入字符预算')
      expect(labels).toContain(kind === 'graph' ? '图谱请求超时（毫秒）' : '场景请求超时（毫秒）')
      expect(text(renderer.root)).toContain('输出长度沿用宿主模型设置')
    }
  })
  it('双包键注册四项 plugins.row.config，支持 summary 与 page 视图，并在 settings.models.footer 提供轻提示与跳转按钮', async () => {
    const { rowConfigs, footers, openBundle } = setupHost({
      packages: [{ name: '@linfengqaqtat/dsh-scriptor-retrieval', rows: [{ rowId: 'webnovel-embeddings' }, { rowId: 'webnovel-scenes' }, { rowId: 'webnovel-reranking' }] }],
    })
    const expectedKeys = [
      '@linfengqaqtat/dsh-scriptor-full#webnovel-embeddings',
      '@linfengqaqtat/dsh-scriptor-retrieval#webnovel-embeddings',
      '@linfengqaqtat/dsh-scriptor-full#webnovel-scenes',
      '@linfengqaqtat/dsh-scriptor-retrieval#webnovel-scenes',
      '@linfengqaqtat/dsh-scriptor-full#webnovel-reranking',
      '@linfengqaqtat/dsh-scriptor-retrieval#webnovel-reranking',
      '@linfengqaqtat/dsh-scriptor-full#webnovel-graph',
      '@linfengqaqtat/dsh-scriptor-retrieval#webnovel-graph',
    ]
    expect([...rowConfigs.keys()].sort()).toEqual([...expectedKeys].sort())
    expect(rowConfigs.get('@linfengqaqtat/dsh-scriptor-full#webnovel-embeddings')!({ view: 'summary' })).toBe('配置混合检索使用的接口、向量模型和维度。')
    expect(rowConfigs.get('@linfengqaqtat/dsh-scriptor-full#webnovel-scenes')!({ view: 'summary' })).toBe('复用已配置的聊天模型，每章识别一次并缓存场景边界。')
    expect(rowConfigs.get('@linfengqaqtat/dsh-scriptor-full#webnovel-reranking')!({ view: 'summary' })).toBe('对少量正文候选重新排序，提高相关片段的可见性。')
    expect(rowConfigs.get('@linfengqaqtat/dsh-scriptor-full#webnovel-graph')!({ view: 'summary' })).toContain('每本书的关系页单独启用')

    expect([...footers.keys()]).toEqual(['webnovel-embeddings'])
    const Footer = footers.get('webnovel-embeddings')!
    let footerRenderer!: ReactTestRenderer
    await act(async () => {
      footerRenderer = create(React.createElement(Footer))
    })
    renderers.push(footerRenderer)
    expect(text(footerRenderer.root)).toContain('已迁移至插件管理页')
    expect(footerRenderer.root.findAllByType('form')).toHaveLength(0)
    const jumpBtn = footerRenderer.root.findAllByType('button').find(btn => text(btn) === '去插件页设置')!
    await act(async () => {
      jumpBtn.props.onClick()
    })
    expect(openBundle).toHaveBeenCalledWith('@linfengqaqtat/dsh-scriptor-retrieval')
  })

  it('插件页清单未加载时先乐观打开完整版，加载后改到实际安装的检索包并打开行配置页', async () => {
    const { openPluginTarget } = await import('../src/plugin-nav')
    let snapshot: { status: string; packages: { name: string; installed: boolean; rows: { rowId: string }[] }[] } = { status: 'idle', packages: [] }
    const listeners = new Set<() => void>()
    const openBundle = vi.fn(), setView = vi.fn(), ensure = vi.fn()
    const host = {
      get: (name: string) => name === 'pluginNavigation' ? { openBundle } : undefined,
      pluginNavigation: { openBundle },
      slots: { entries: () => [{
        options: { key: 'plugins' },
        inject: () => ({ ensure, hooks: { pluginManager: { getSnapshot: () => snapshot, subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) } } } }),
        store: { create: () => ({ actions: { setView } }) },
      }] },
    }
    const opened = openPluginTarget(host as unknown as Context, ['@linfengqaqtat/dsh-scriptor-full', '@linfengqaqtat/dsh-scriptor-retrieval'], 'webnovel-embeddings')
    expect(opened).toBe('@linfengqaqtat/dsh-scriptor-full')
    expect(ensure).toHaveBeenCalled()
    snapshot = { status: 'ready', packages: [{ name: '@linfengqaqtat/dsh-scriptor-retrieval', installed: true, rows: [{ rowId: 'webnovel-embeddings' }] }] }
    for (const listener of [...listeners]) listener()
    expect(openBundle).toHaveBeenLastCalledWith('@linfengqaqtat/dsh-scriptor-retrieval')
    expect(setView).toHaveBeenLastCalledWith({ kind: 'row', name: '@linfengqaqtat/dsh-scriptor-retrieval', rowId: 'webnovel-embeddings' })
    expect(listeners.size).toBe(0)
  })

  it('plugins.row.config 页面视图默认展开表单，支持保存配置与凭据、冲突提示及失败保留草稿', async () => {
    const { rowConfigs, scopes, setCredential } = setupHost()
    const RowPage = rowConfigs.get('@linfengqaqtat/dsh-scriptor-full#webnovel-embeddings')!
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(React.createElement(RowPage, { view: 'page' }))
    })
    renderers.push(renderer)

    // Default open in page view
    expect(renderer.root.findAllByType('form')).toHaveLength(1)
    const protocolTab = renderer.root.findAllByType('button').find(btn => btn.props.role === 'tab' && text(btn) === 'Gemini 原生')!
    await act(async () => {
      protocolTab.props.onClick()
    })
    const keyInput = renderer.root.findAllByType('input').find(input => input.props['aria-label'] === 'API Key')!
    await act(async () => {
      keyInput.props.onChange({ target: { value: 'sk-test-secret' } })
    })

    // External revision update while dirty shows conflict warning
    await act(async () => {
      scopes['webnovel-embeddings'].setExternal(
        { enabled: false, protocol: 'openai-compatible', baseURL: 'https://api.example.com/v1', model: 'bge-m3', dimensions: 1024 },
        2,
      )
    })
    expect(text(renderer.root)).toContain('配置已在其他位置更新')

    // Rejected mutation keeps dirty draft and reports notice
    scopes['webnovel-embeddings'].setMutateOutcome({ ok: false })
    const form = renderer.root.findByType('form')
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} })
    })
    expect(setCredential).toHaveBeenCalledWith('WEBNOVEL_EMBEDDING_API_KEY', 'sk-test-secret')
    expect(text(renderer.root)).toContain('API Key 已保存；配置未保存；请载入最新配置后重试')

    // Discard reloads latest revision, then save succeeds
    const discardBtn = renderer.root.findAllByType('button').find(btn => text(btn) === '放弃更改')!
    await act(async () => {
      discardBtn.props.onClick()
    })
    expect(text(renderer.root)).not.toContain('配置已在其他位置更新')

    scopes['webnovel-embeddings'].setMutateOutcome({ ok: true })
    await act(async () => {
      protocolTab.props.onClick()
    })
    await act(async () => {
      await renderer.root.findByType('form').props.onSubmit({ preventDefault() {} })
    })
    expect(scopes['webnovel-embeddings'].getSnapshot().value?.protocol).toBe('gemini-native')
    const saveBtn = renderer.root.findAllByType('button').find(btn => text(btn) === '保存')!
    expect(saveBtn.props.disabled).toBe(true)
  })
})
