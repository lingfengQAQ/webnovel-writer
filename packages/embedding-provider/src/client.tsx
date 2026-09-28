import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { EmbeddingSettings } from './config'
import css from './client.css'
import { dimensionGuidance, shouldSendDimensions, type EmbeddingModelOption } from './models'
import { MODEL_DIMENSIONS } from './model-dimensions'
import { installAuxiliaryCards } from './auxiliary-client'

const NS = 'webnovel-embeddings'
const DEFAULT_REF = 'WEBNOVEL_EMBEDDING_API_KEY'
const FIELDS = ['enabled', 'protocol', 'baseURL', 'model', 'dimensions', 'apiKeyEnv', 'batchSize', 'timeoutMs', 'maxRetries', 'sendDimensions', 'documentPrefix', 'queryPrefix', 'geminiTaskMode'] as const
export const inject = ['slots', 'configForms', 'remote', 'remote.credentials']

function EmbeddingCard({ scope, host }: { scope: ConfigForm<EmbeddingSettings>; host: Context }) {
  const state = useSyncExternalStore(listener => scope.subscribe(listener), () => scope.getSnapshot())
  const [draft, setDraft] = useState<EmbeddingSettings>({})
  const [revision, setRevision] = useState<number>()
  const [dirty, setDirty] = useState(false)
  const [key, setKey] = useState('')
  const [credential, setCredential] = useState({ configured: false, writable: true })
  const [credentialRefresh, setCredentialRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [open, setOpen] = useState(false)
  const alive = useRef(true)
  const [models, setModels] = useState<EmbeddingModelOption[]>([])
  const [discovering, setDiscovering] = useState(false)
  const discovery = useRef<AbortController>()
  const dimensionEdited = useRef(false)
  const selected = models.find(model => model.id === draft.model)
  const guidance = dimensionGuidance(draft.model ?? '', selected)
  const preset = guidance.preset
  const dimensionOptions = guidance.options
  const invalidateDiscovery = () => { discovery.current?.abort(); discovery.current = undefined; setDiscovering(false) }
  useEffect(() => () => discovery.current?.abort(), [])
  const discover = async (action: 'models' | 'dimensions') => {
    invalidateDiscovery()
    const controller = new AbortController(); discovery.current = controller
    setDiscovering(true); setNotice('')
    try {
      const response = await fetch('/api/webnovel/embeddings', {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, protocol: draft.protocol ?? 'openai-compatible', baseURL: draft.baseURL, model: draft.model, apiKeyEnv: ref, apiKey: key }),
      })
      if (!response.ok) {
        const result = await response.json().catch(() => undefined)
        throw new Error(result?.error ?? `接口查询失败（HTTP ${response.status}）`)
      }
      const result = await response.json()
      if (controller.signal.aborted || !alive.current) return
      if (!result.ok) throw new Error(result.error ?? '接口查询失败')
      if (action === 'models') {
        const options = result.value.models as EmbeddingModelOption[]
        setModels(options)
        const option = options.find(item => item.id === draft.model)
        if (!dimensionEdited.current && option) {
          const next = dimensionGuidance(draft.model ?? '', option)
          setDraft(previous => ({ ...previous, dimensions: next.defaultDimension, sendDimensions: shouldSendDimensions(previous.model ?? '', next.defaultDimension) })); setDirty(true)
        }
        setNotice(`已获取 ${options.length} 个模型${result.value.limited ? '（列表未全部返回）' : ''}；请选择向量模型，也可手动输入。`)
      } else {
        setDraft(previous => ({ ...previous, dimensions: result.value.dimensions, sendDimensions: false }))
        dimensionEdited.current = true; setDirty(true)
        setNotice(`默认维度为 ${result.value.dimensions}，已填入；调用时不传维度参数。`)
      }
    } catch (error) {
      if (!controller.signal.aborted && alive.current) setNotice(error instanceof Error ? error.message : '接口查询失败')
    } finally { if (discovery.current === controller && alive.current) setDiscovering(false) }
  }
  const ref = draft.apiKeyEnv || DEFAULT_REF
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (!dirty && state.value) { setDraft({ ...state.value }); setRevision(state.revision); dimensionEdited.current = state.value.dimensions !== undefined }
  }, [state, dirty])
  useEffect(() => host.remote.$on('credentials/reference-updated', (changed: string) => {
    if (changed === ref) setCredentialRefresh(value => value + 1)
  }), [host, ref])
  useEffect(() => {
    let valid = true
    setCredential({ configured: false, writable: true })
    void host.remote.credentials.describe([ref]).then((result: { ok: true; value: Record<string, { configured: boolean; writable: boolean }> } | { ok: false }) => {
      if (valid && result.ok) setCredential({ configured: result.value[ref]?.configured ?? false, writable: result.value[ref]?.writable ?? true })
    }).catch(() => { if (valid) setNotice('无法读取凭据状态，请检查 DSH 连接') })
    return () => { valid = false }
  }, [host, ref, state.status, credentialRefresh])
  const change = <K extends keyof EmbeddingSettings>(field: K, value: EmbeddingSettings[K]) => {
    invalidateDiscovery()
    if (field === 'dimensions') {
      dimensionEdited.current = true
      const dimensions = value as number | undefined
      setDraft(previous => ({ ...previous, dimensions, sendDimensions: shouldSendDimensions(previous.model ?? '', dimensions) }))
      setDirty(true); setNotice(''); return
    }
    if (field === 'baseURL' || field === 'protocol' || field === 'apiKeyEnv') setModels([])
    if (field === 'model') {
      dimensionEdited.current = false
      const option = models.find(model => model.id === value)
      const model = String(value ?? '')
      const next = dimensionGuidance(model, option)
      setDraft(previous => ({ ...previous, model, dimensions: next.defaultDimension, sendDimensions: shouldSendDimensions(model, next.defaultDimension) }))
      setDirty(true); setNotice(''); return
    }
    setDraft(previous => ({ ...previous, [field]: value })); setDirty(true); setNotice('')
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    invalidateDiscovery()
    if (draft.enabled && (!draft.baseURL?.trim() || !draft.model?.trim() || !Number.isInteger(draft.dimensions) || (draft.dimensions ?? 0) < 1)) {
      setNotice('启用前请填写接口地址、模型和正整数向量维度'); return
    }
    setBusy(true); setNotice('')
    let keySaved = false
    try {
      if (key) {
        const result = await host.remote.credentials.set(ref, key)
        if (!result.ok) throw new Error('API Key 保存失败，请检查宿主凭据权限')
        keySaved = true
        if (alive.current) { setKey(''); setCredentialRefresh(value => value + 1) }
      }
      const accepted = await scope.mutate(FIELDS.map(field => draft[field] === undefined
        ? { op: 'unset' as const, path: [field] }
        : { op: 'set' as const, path: [field], value: draft[field] }), revision)
      if (!accepted) throw new Error('配置未保存；请载入最新配置后重试')
      if (alive.current) { setDirty(false); setNotice(''); setOpen(false) }
    } catch (error) {
      if (alive.current) setNotice(`${keySaved ? 'API Key 已保存；' : ''}${error instanceof Error ? error.message : '设置保存失败，请重试'}`)
    } finally { if (alive.current) setBusy(false) }
  }
  const numeric = (field: 'dimensions' | 'batchSize' | 'timeoutMs' | 'maxRetries', label: string, minimum: number, maximum: number, placeholder?: string, hint?: string) => <label className="we-field">
    <span className="we-label">{label}</span><input type="number" min={minimum} max={maximum} step="1" value={draft[field] ?? ''} placeholder={placeholder}
      onChange={event => change(field, event.target.value === '' ? undefined : Number(event.target.value))} />
    {hint ? <span className="we-hint">{hint}</span> : null}
  </label>
  if (state.status === 'unavailable') return null
  // The form's state stays above the disclosure, so collapsing keeps every draft.
  return <li className={`webnovel-embedding-card${open ? ' we-open' : ''}`}>
    <button type="button" className="we-header" aria-expanded={open} aria-label={`${open ? '收起' : '展开'}设置: 混合检索 · 嵌入 API`} onClick={() => setOpen(value => !value)}>
      <span className="we-head-text"><span className="we-title">混合检索 · 嵌入 API</span><span className="we-description">配置混合检索使用的接口、向量模型和维度。</span></span>
      {dirty ? <span className="we-tag">未保存</span> : null}
      <svg className="we-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m3.5 5.25 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open ? <form className="we-body" onSubmit={event => void save(event)}>
      <fieldset disabled={busy || state.status !== 'ready' || !state.writable}>
        <div className="we-field"><label className="we-check"><input type="checkbox" checked={draft.enabled ?? false} onChange={event => change('enabled', event.target.checked)} />启用语义检索</label>
          <p className="we-hint">仅在调用混合检索时，向所配置服务发送当前书的定稿片段和查询。</p></div>
        <div className="we-fields">
          <label className="we-field"><span className="we-label">接口协议</span><select value={draft.protocol ?? 'openai-compatible'} onChange={event => change('protocol', event.target.value as EmbeddingSettings['protocol'])}>
            <option value="openai-compatible">OpenAI 兼容</option><option value="gemini-native">Gemini 原生</option>
          </select></label>
          <label className="we-field"><span className="we-label">API 基础地址</span><input type="url" value={draft.baseURL ?? ''} placeholder={draft.protocol === 'gemini-native' ? 'https://generativelanguage.googleapis.com/v1beta' : 'https://你的服务地址/v1'} onChange={event => change('baseURL', event.target.value)} /></label>
          <label className="we-field"><span className="we-label">向量模型</span><input list="we-embedding-models" value={draft.model ?? ''} placeholder="选择常用模型、获取列表或手动输入" onChange={event => change('model', event.target.value)} /><datalist id="we-embedding-models">{models.length ? models.map(model => <option key={model.id} value={model.id}>{model.name ?? model.id}</option>) : MODEL_DIMENSIONS.map(model => <option key={model.id} value={model.id}>{model.id}</option>)}</datalist><span className="we-hint">{models.length ? '列表来自当前接口。' : `内置 ${MODEL_DIMENSIONS.length} 个常用模型供参考，可获取当前接口实际提供的模型。`}</span></label>
          <button type="button" disabled={discovering || !draft.baseURL} onClick={() => void discover('models')}>{discovering ? '查询中…' : '获取模型列表'}</button>
          {dimensionOptions.length ? <label className="we-field"><span className="we-label">{guidance.source === 'api' ? '接口提供的维度' : '常用维度'}</span><select aria-label="选择向量维度" value={dimensionOptions.includes(draft.dimensions ?? 0) ? draft.dimensions : ''} onChange={event => change('dimensions', event.target.value ? Number(event.target.value) : undefined)}><option value="">手动填写</option>{dimensionOptions.map(value => <option key={value} value={value}>{value}{value === guidance.defaultDimension ? '（默认）' : ''}</option>)}</select>
            {guidance.source === 'catalog' && preset ? <span className="we-hint">{preset.kind === 'fixed' ? `模型标准输出为 ${preset.defaultDimension} 维。` : preset.range ? `模型支持 ${preset.range[0]}–${preset.range[1]} 维，上方列出常用值。` : '模型支持缩短输出，上方列出参考维度。'} <a href={preset.source.url} target="_blank" rel="noreferrer">{preset.source.label}</a> · 核对于 {preset.source.checkedOn}</span> : null}
            {preset?.requestDimensions === 'service-dependent' && guidance.source === 'catalog' ? <span className="we-hint">缩短维度需所选服务支持。选择较小维度会发送维度参数；标准维度默认不传。</span> : null}
          </label> : null}
          {numeric('dimensions', '向量维度', 1, 65_536, '按模型填写，例如 1024', '启用前必填。模型或维度变更后，下次检索会重建旧向量。')}
          <div className="we-field"><button type="button" disabled={discovering || !draft.baseURL || !draft.model} onClick={() => void discover('dimensions')}>检测默认维度</button><span className="we-hint">向所填接口发送一条固定测试文本，可能产生少量费用。检测只得到默认维度，不代表全部可选维度。</span></div>
          <div className="we-field"><div className="we-field-head"><label className="we-label" htmlFor="webnovel-embedding-key">API Key</label><span className="we-tag">{credential.configured ? '已配置' : '未配置'}</span></div>
            <input id="webnovel-embedding-key" type="password" autoComplete="off" value={key} disabled={!credential.writable}
              placeholder={credential.configured ? '留空保持现有密钥' : ''} onChange={event => { invalidateDiscovery(); setModels([]); setKey(event.target.value); setDirty(true) }} />
            <p className="we-hint">由 DSH 凭据服务保存，不写入普通配置。留空不会清除现有密钥。</p></div>
        </div>
        <details className="we-advanced"><summary>高级设置</summary><div className="we-fields">
          <label className="we-field"><span className="we-label">凭据引用名称</span><input value={ref} onChange={event => change('apiKeyEnv', event.target.value)} /></label>
          {numeric('batchSize', '每批片段数', 1, 128)}{numeric('timeoutMs', '请求超时（毫秒）', 100, 120_000)}
          {numeric('maxRetries', '临时故障重试次数', 0, 3)}
          <label className="we-field"><span className="we-label">Gemini 角色参数</span><select value={draft.geminiTaskMode ?? 'native'} onChange={event => change('geminiTaskMode', event.target.value as EmbeddingSettings['geminiTaskMode'])}>
            <option value="native">原生 taskType</option><option value="instruction">仅使用指令前缀</option>
          </select></label>
          <label className="we-field"><span className="we-label">文档指令前缀</span><textarea rows={2} value={draft.documentPrefix ?? ''} onChange={event => change('documentPrefix', event.target.value)} /></label>
          <label className="we-field"><span className="we-label">查询指令前缀</span><textarea rows={2} value={draft.queryPrefix ?? ''} onChange={event => change('queryPrefix', event.target.value)} /></label>
        </div><label className="we-check"><input type="checkbox" checked={draft.sendDimensions ?? true} onChange={event => change('sendDimensions', event.target.checked)} />将维度参数发送给 API（固定维度接口可关闭，响应仍会校验）</label></details>
        <div className="we-actions">{notice ? <p className="we-error" role="status">{notice}</p> : null}
          <button type="button" className="we-discard" disabled={!dirty} onClick={() => { invalidateDiscovery(); setModels([]); dimensionEdited.current = false; setDirty(false); setKey(''); setNotice(''); setDraft({ ...state.value }); setRevision(state.revision) }}>放弃更改</button>
          <button type="submit" className="we-save" disabled={!dirty}>{busy ? '保存中…' : '保存'}</button></div>
      </fieldset>
      {dirty && revision !== state.revision ? <p className="we-hint" role="status">配置已在其他位置更新；放弃当前更改后可载入最新配置。</p> : null}
    </form> : null}
  </li>
}

export function apply(host: Context): void {
  installAuxiliaryCards(host)
  const scope = host.configForms.get<EmbeddingSettings>(NS)
  host.effect(() => {
    const style = document.createElement('style'); style.textContent = css; document.head.append(style)
    return () => style.remove()
  }, 'webnovel embeddings: settings style')
  host.slots.inject('settings.models.footer', () => host.slots.register({ name: 'settings.models.footer', id: NS, order: 50 }, () => <section className="webnovel-embedding-section">
    <h3>嵌入模型</h3>
    <ul><EmbeddingCard host={host} scope={scope} /></ul>
  </section>))
}
