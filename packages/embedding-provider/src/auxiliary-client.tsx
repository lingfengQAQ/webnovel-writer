import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { Button, Checkbox, IconChevronDownOutlineRegular, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SceneSettings, RerankSettings } from './auxiliary-config'
import type { GraphSettings } from './graph-config'
import { DEFAULT_RERANK_TIMEOUT_MS, MAX_RERANK_TIMEOUT_MS, MIN_RERANK_TIMEOUT_MS } from '@webnovel/core/retrieval-policy'
import { SelectMenu } from './select-menu'

export interface PluginConfigViewProps {
  readonly view: 'summary' | 'page'
  readonly form?: {
    readonly state: ConfigFormSnapshot<Record<string, unknown>>
    readonly mutate: ConfigForm<Record<string, unknown>>['mutate']
  } | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    pluginNavigation?: {
      openBundle(packageName: string): void
    }
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'plugins.bundle.config': {
      kind: 'keyed'
      scope: 'root'
      owner: PluginConfigViewProps
    }
    'plugins.row.config': {
      kind: 'keyed'
      scope: 'root'
      owner: PluginConfigViewProps
    }
  }
}

export const RETRIEVAL_BUNDLES = ['@linfengqaqtat/dsh-scriptor-full', '@linfengqaqtat/dsh-scriptor-retrieval'] as const

type Draft = SceneSettings & RerankSettings & GraphSettings
type Group = { readonly id: string; readonly name: string; readonly models: readonly { readonly id: string; readonly name: string }[] }
const sceneFields = ['enabled', 'provider', 'model', 'concurrency', 'timeoutMs'] as const
const rankFields = ['enabled', 'endpoint', 'model', 'apiKeyEnv', 'candidates', 'timeoutMs'] as const
const graphFields = ['enabled', 'provider', 'model', 'timeoutMs'] as const

export function ModelCard({ scope, host, kind, defaultOpen = false }: { scope: ConfigForm<Draft>; host: Context; kind: 'scenes' | 'reranking' | 'graph'; defaultOpen?: boolean }) {
  const state = useSyncExternalStore(listener => scope.subscribe(listener), () => scope.getSnapshot())
  const [draft, setDraft] = useState<Draft>({})
  const [revision, setRevision] = useState<number>()
  const [dirty, setDirty] = useState(false)
  const [open, setOpen] = useState(defaultOpen)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [key, setKey] = useState('')
  const [credential, setCredential] = useState({ configured: false, writable: true })
  const [credentialRevision, setCredentialRevision] = useState(0)
  const [groups, setGroups] = useState<readonly Group[]>([])
  const [loading, setLoading] = useState(false)
  const alive = useRef(true)
  const catalogRequest = useRef(0)
  const graph = kind === 'graph', scene = kind !== 'reranking'
  const title = graph ? '人物关系 · 沉淀抽取' : scene ? '混合检索 · 场景识别' : '混合检索 · 重排序 API'
  const modelLabel = graph ? '图谱抽取模型' : '场景识别模型'
  const explanation = graph ? '只发送已入档沉淀及本书实体名称与别名。保存配置后，仍须在每本书的关系页预览并手动启用；不依赖向量或场景模型。'
    : scene ? '向所选模型发送已启用书仓的定稿正文，只保存边界。普通向量重建、改名和换模型复用已有结果；关闭后不再识别新章。' : '查询时向本接口发送问题与候选正文；不参与索引重建。服务失败时使用原排序，并返回降级原因。'
  const ref = draft.apiKeyEnv || 'WEBNOVEL_RERANK_API_KEY'
  useEffect(() => { alive.current = true; return () => { alive.current = false; catalogRequest.current++ } }, [])
  useEffect(() => { if (!dirty && state.value) { setDraft({ ...state.value }); setRevision(state.revision) } }, [state, dirty])
  useEffect(() => {
    if (scene) return
    let valid = true
    setCredential({ configured: false, writable: true })
    void host.remote.credentials.describe([ref]).then((result: { ok: true; value: Record<string, { configured: boolean; writable: boolean }> } | { ok: false }) => {
      if (valid && result.ok) setCredential({ configured: result.value[ref]?.configured ?? false, writable: result.value[ref]?.writable ?? true })
    }).catch(() => { if (valid) setMessage('无法读取重排凭据状态') })
    const off = host.remote.$on('credentials/reference-updated', (changed: string) => { if (changed === ref) setCredentialRevision(value => value + 1) })
    return () => { valid = false; off() }
  }, [host, ref, scene, credentialRevision])
  const change = <K extends keyof Draft>(field: K, value: Draft[K]) => { setDraft(previous => ({ ...previous, [field]: value })); setDirty(true); setMessage('') }
  const catalog = async () => {
    const request = ++catalogRequest.current
    setLoading(true); setMessage('')
    try {
      const service = host.get('remote.session') as Context['remote']['session'] | undefined
      if (!service) throw new Error('宿主模型目录不可用，可手动填写已配置的提供方和模型')
      const response = await service.modelCatalog()
      if (!alive.current || request !== catalogRequest.current) return
      if (!response.ok) throw new Error(response.error.message)
      const result = response.value
      setGroups(result.groups)
      if (result.failures.length) setMessage('部分提供方的模型列表未能获取，可重试或手动填写')
    } catch (error) { if (alive.current && request === catalogRequest.current) setMessage(error instanceof Error ? error.message : '模型列表读取失败') }
    finally { if (alive.current && request === catalogRequest.current) setLoading(false) }
  }
  useEffect(() => {
    if (defaultOpen && scene && !groups.length && !loading) void catalog()
  }, [])
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true); setMessage('')
    let keySaved = false
    try {
      if (!scene && key) {
        const result = await host.remote.credentials.set(ref, key)
        if (!result.ok) throw new Error('重排 API Key 保存失败')
        keySaved = true
        if (alive.current) { setKey(''); setCredentialRevision(value => value + 1) }
      }
      const accepted = await scope.mutate((graph ? graphFields : scene ? sceneFields : rankFields).map(field => draft[field] === undefined
        ? { op: 'unset' as const, path: [field] }
        : { op: 'set' as const, path: [field], value: draft[field] }), revision)
      if (!accepted) throw new Error('配置未保存；请载入最新配置后重试')
      if (alive.current) { setDirty(false); if (!defaultOpen) setOpen(false) }
    } catch (error) { if (alive.current) setMessage((keySaved ? 'API Key 已保存；' : '') + (error instanceof Error ? error.message : '设置保存失败')) }
    finally { if (alive.current) setBusy(false) }
  }
  const text = (field: 'provider' | 'model' | 'endpoint' | 'apiKeyEnv', label: string, placeholder?: string) => <label className="we-field">
    <span className="we-label">{label}</span><Input aria-label={label} value={draft[field] ?? ''} placeholder={placeholder} onChange={event => change(field, event.target.value)} />
  </label>
  const number = (field: 'concurrency' | 'timeoutMs' | 'candidates', label: string, min: number, max: number, fallback: number) => <label className="we-field">
    <span className="we-label">{label}</span><Input aria-label={label} type="number" step={1} min={min} max={max} value={draft[field] ?? fallback}
      onChange={event => change(field, event.target.value === '' ? undefined : Number(event.target.value))} />
  </label>
  const selected = draft.provider && draft.model ? JSON.stringify([draft.provider, draft.model]) : ''
  const inCatalog = groups.some(group => group.id === draft.provider && group.models.some(model => model.id === draft.model))
  if (state.status === 'unavailable') return null
  return <li className={'webnovel-embedding-card' + (open ? ' we-open' : '') + (defaultOpen ? ' we-page' : '')}>
    {!defaultOpen ? <button type="button" className="we-header" aria-expanded={open} aria-label={(open ? '收起' : '展开') + '设置: ' + title}
      onClick={() => { setOpen(value => !value); if (!open && scene && !groups.length && !loading) void catalog() }}>
      <span className="we-head-text"><span className="we-title">{title}</span><span className="we-description">{graph ? '从已入档沉淀提取带原文依据的辅助关系。' : scene ? '复用已配置的聊天模型，每章识别一次并缓存场景边界。' : '对少量正文候选重新排序，提高相关片段的可见性。'}</span></span>
      {dirty ? <Tag tone="warning" className="we-tag">未保存</Tag> : null}<IconChevronDownOutlineRegular className="we-chevron" />
    </button> : null}
    {open ? <form className="we-body" onSubmit={event => void save(event)}><fieldset className="we-fieldset" disabled={busy || state.status !== 'ready' || !state.writable}>
      <Checkbox className="we-check" checked={draft.enabled ?? false} onChange={checked => change('enabled', checked)} label={graph ? '提供图谱抽取模型' : scene ? '启用后台场景识别' : '启用查询重排序'} />
      <p className="we-hint">{explanation}</p>
      <div className="we-fields">{scene ? <>
        <div className="we-field"><span className="we-label">{modelLabel}</span><SelectMenu label={modelLabel} value={selected} disabled={busy || !state.writable} onChange={value => {
          if (!value) return
          const [provider, model] = JSON.parse(value) as [string, string]
          setDraft(previous => ({ ...previous, provider, model })); setDirty(true); setMessage('')
        }} options={[{ value: '', label: '请选择宿主模型' }, ...(selected && !inCatalog ? [{ value: selected, label: `${draft.provider} / ${draft.model}` }] : []),
          ...groups.flatMap(group => group.models.map(model => ({ value: JSON.stringify([group.id, model.id]), label: `${group.name} / ${model.name}` })))]} /></div>
        <Button variant="outline" size="sm" className="we-discard we-inline-btn" disabled={loading} onClick={() => { void catalog() }}>{loading ? '读取中…' : '刷新宿主模型列表'}</Button>
        {!graph ? number('concurrency', '场景并发数', 1, 8, 2) : null}
        <p className="we-hint">输出长度沿用宿主模型设置；请求失败或超时后保留已完成结果。</p>
      </> : <>
        {text('endpoint', '完整重排接口地址', 'https://api.example.com/v1/rerank')}
        {text('model', '重排序模型')}
        {number('candidates', '重排候选数', 1, 200, 40)}
        <label className="we-field"><span className="we-label">重排等待时间（秒）</span>
          <Input aria-label="重排等待时间（秒）" type="number" min={MIN_RERANK_TIMEOUT_MS / 1000} max={MAX_RERANK_TIMEOUT_MS / 1000} step={0.001}
            value={(draft.timeoutMs ?? DEFAULT_RERANK_TIMEOUT_MS) / 1000}
            onChange={event => change('timeoutMs', event.target.value === '' ? undefined : Math.round(Number(event.target.value) * 1000))} />
          <span className="we-hint">默认 {DEFAULT_RERANK_TIMEOUT_MS / 1000} 秒，最长 {MAX_RERANK_TIMEOUT_MS / 1000} 秒；超时后使用原排序。</span>
        </label>
        <label className="we-field"><span className="we-label">重排 API Key {credential.configured ? '（已配置）' : '（未配置）'}</span>
          <Input aria-label="重排 API Key" type="password" autoComplete="off" value={key} disabled={!credential.writable} placeholder={credential.configured ? '留空保持现有密钥' : ''}
            onChange={event => { setKey(event.target.value); setDirty(true) }} /><span className="we-hint">由 DSH 凭据服务保存，普通配置只保留引用。</span></label>
      </>}</div>
      <details className="we-advanced"><summary className="we-summary">高级设置</summary><div className="we-fields">
        {scene ? <>{text('provider', '宿主提供方路由')}{text('model', graph ? '图谱模型标识' : '场景模型标识')}</> : text('apiKeyEnv', '重排凭据引用名称', 'WEBNOVEL_RERANK_API_KEY')}
        {scene ? number('timeoutMs', graph ? '图谱请求超时（毫秒）' : '场景请求超时（毫秒）', 100, 180_000, 60_000) : null}
      </div></details>
      <div className="we-actions">{message ? <p className="we-error" role="status">{message}</p> : null}
        <Button variant="outline" size="sm" className="we-discard" disabled={!dirty} onClick={() => { setDirty(false); setDraft({ ...state.value }); setRevision(state.revision); setKey(''); setMessage('') }}>放弃更改</Button>
        <Button variant="primary" size="sm" type="submit" className="we-save" disabled={!dirty}>{busy ? '保存中…' : '保存'}</Button>
      </div>
      {dirty && revision !== state.revision ? <p className="we-hint" role="status">配置已在其他位置更新；放弃当前更改后载入最新配置。</p> : null}
    </fieldset></form> : null}
  </li>
}

export function installAuxiliaryCards(host: Context): void {
  const scenes = host.configForms.get<Draft>('webnovel-scenes')
  const reranking = host.configForms.get<Draft>('webnovel-reranking')
  const graph = host.configForms.get<Draft>('webnovel-graph')
  host.slots.inject('plugins.row.config', () => RETRIEVAL_BUNDLES.flatMap(bundle => [
    host.slots.register({ name: 'plugins.row.config', key: `${bundle}#webnovel-graph` }, ({ view }: PluginConfigViewProps) =>
      view === 'summary' ? '从已入档沉淀提取带原文依据的辅助关系；在每本书的关系页单独启用。'
        : <div className="webnovel-embedding-section"><ul className="we-list"><ModelCard host={host} scope={graph} kind="graph" defaultOpen /></ul></div>),
    host.slots.register({ name: 'plugins.row.config', key: `${bundle}#webnovel-scenes` }, ({ view }: PluginConfigViewProps) =>
      view === 'summary'
        ? '复用已配置的聊天模型，每章识别一次并缓存场景边界。'
        : <div className="webnovel-embedding-section"><ul className="we-list"><ModelCard host={host} scope={scenes} kind="scenes" defaultOpen /></ul></div>),
    host.slots.register({ name: 'plugins.row.config', key: `${bundle}#webnovel-reranking` }, ({ view }: PluginConfigViewProps) =>
      view === 'summary'
        ? '对少量正文候选重新排序，提高相关片段的可见性。'
        : <div className="webnovel-embedding-section"><ul className="we-list"><ModelCard host={host} scope={reranking} kind="reranking" defaultOpen /></ul></div>),
  ]))
}
