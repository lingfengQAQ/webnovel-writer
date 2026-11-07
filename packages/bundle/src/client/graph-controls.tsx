import React, { useEffect, useRef, useState } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GraphPreview } from '../indexing/graph-manager'
import type { GraphState } from '../indexing/graph-storage'
import type { BookInspection } from '@webnovel/core'
import type { StoryGraph } from '../study/graph-types'
import type { ClientHost } from './host'
import { callStudy } from './api'
import { openPluginSettings } from './plugin-nav'

const phases: Record<GraphState['phase'], string> = { disabled: '抽取未启用', ready: '索引已就绪', queued: '等待更新', running: '正在提取证据', paused: '已暂停', failed: '部分来源待处理', unconfigured: '模型待配置', 'model-changed': '模型已变化，待确认更新' }
export function GraphControls({ graph, sessionId, space, host, changed, openSource }: { graph: StoryGraph; sessionId: string; space: string; host?: ClientHost; changed(): void; openSource?(path: string): void }) {
  const [preview, setPreview] = useState<{ action: string; value: GraphPreview }>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [details, setDetails] = useState(false)
  const [inspection, setInspection] = useState<{ value: BookInspection; fingerprint?: string }>()
  const controller = useRef<AbortController>()
  useEffect(() => () => controller.current?.abort(), [])
  const state = graph.index?.state
  const inspect = async () => {
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort
    setBusy(true); setError('')
    try {
      const value = await callStudy<BookInspection>(sessionId, 'book-inspection', { space }, abort.signal)
      if (!abort.signal.aborted) setInspection({ value, fingerprint: graph.fingerprint })
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : '书仓检查失败') }
    finally { if (!abort.signal.aborted) setBusy(false) }
  }
  const start = async (action: string) => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort
    setBusy(true); setError('')
    try {
      if (action === 'pause' || action === 'disable') { await callStudy(sessionId, 'graph-control', { space, action }, abort.signal); if (!abort.signal.aborted) changed() }
      else {
        const value = await callStudy<GraphPreview>(sessionId, 'graph-preview', { space, action }, abort.signal)
        if (!abort.signal.aborted) setPreview({ action, value })
      }
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : '图谱操作失败') }
    finally { if (!abort.signal.aborted) setBusy(false) }
  }
  const confirm = async () => {
    if (!preview) return
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort
    setBusy(true); setError('')
    try {
      await callStudy(sessionId, 'graph-control', { space, action: preview.action, token: preview.value.token }, abort.signal)
      if (!abort.signal.aborted) { setPreview(undefined); changed() }
    } catch (e) { if (!abort.signal.aborted) { setError(e instanceof Error ? e.message : '图谱操作失败'); setPreview(undefined) } }
    finally { if (!abort.signal.aborted) setBusy(false) }
  }
  return <section className="nw-graph-control" aria-label="图谱索引">
    <div className="nw-graph-control-row"><Tag tone={state?.phase === 'failed' || graph.index?.cache === 'invalid' ? 'warning' : 'neutral'}>{graph.index?.cache === 'invalid' ? '缓存待核对' : graph.index?.cache === 'missing' && state?.phase === 'ready' ? '缓存缺失' : state ? phases[state.phase] : '确定性资料'}</Tag>
      {graph.format && !graph.format.ok ? <Tag tone="warning">{graph.format.kind === 'unversioned' ? '格式未标注' : '格式待核对'}</Tag> : null}
      {graph.index?.cache === 'stale' ? <span className="nw-viz-note">来源或抽取规则已变化，旧证据需重新核对</span> : null}
      {state?.phase === 'running' ? <span className="nw-viz-note">{state.completed ?? 0} / {state.total ?? 0} 条</span> : null}
      <div className="nw-graph-control-actions">
        {state?.enabled ? <>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void start(state.paused ? 'resume' : 'update')}>{state.paused ? '预览恢复' : '预览更新'}</Button>
          <Button size="sm" variant="ghost" disabled={busy || state.paused} onClick={() => void start('pause')}>暂停</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void start('disable')}>关闭抽取</Button>
        </> : <Button size="sm" variant="outline" disabled={busy} onClick={() => void start('enable')}>启用沉淀抽取</Button>}
        {host ? <Button size="sm" variant="ghost" onClick={() => openPluginSettings(host, { kind: 'row', rowId: 'webnovel-graph' })}>图谱模型</Button> : null}
        <Button size="sm" variant="ghost" aria-expanded={details} onClick={() => setDetails(value => !value)}>索引详情</Button>
      </div>
    </div>
    {state?.error || graph.index?.error ? <p className="nw-viz-note" role="status">{state?.error || graph.index?.error}</p> : null}
    {state?.phase === 'failed' ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void start('retry')}>预览重试失败项</Button> : null}
    {details ? <div className="nw-relation-options" aria-label="索引操作与用量">
      <p className="nw-viz-note">{state?.calls ?? 0} 轮抽取。已报告输入 {state?.inputTokens ?? 0}、输出 {state?.outputTokens ?? 0} token；实际金额未知。</p>
      <div className="nw-graph-control-actions"><Button size="sm" variant="ghost" disabled={busy} onClick={() => void start('build')}>更新确定性资料</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void start('rebuild')}>预览完整重建</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void inspect()}>检查书仓格式</Button></div>
    </div> : null}
    {inspection ? <details className="nw-viz-notes" open><summary className="nw-relation-options-title">{inspection.fingerprint === graph.fingerprint ? '最近检查' : '来源已更新 · 上次检查'}：{inspection.value.状态} · {inspection.value.结论}</summary>
      <p className="nw-viz-note">检查于 {inspection.value.快照.结束时间}；{inspection.value.受检范围.length} 项受检，{inspection.value.未检范围.length} 项未检。{inspection.value.快照.稳定 ? '检查期间来源稳定。' : '检查期间来源发生变化，结果须重新核对。'}修复和升级仍需另行预览与批准。</p>
      <ul className="nw-viz-notes-list">{inspection.value.问题.map((item, index) => <li key={index}><button className="nw-link-button" type="button" onClick={() => openSource?.(item.路径)}>{item.路径}</button>：{item.说明}</li>)}</ul>
    </details> : null}
    {error ? <p className="nw-error" role="alert">{error}</p> : null}
    {preview ? <div className="nw-graph-preview" role="dialog" aria-label="确认图谱抽取范围">
      <strong>{preview.value.bookName} · {preview.action === 'build' ? '更新确定性资料' : preview.action === 'rebuild' ? '完整重建图谱' : '沉淀抽取预览'}</strong>
      <p className="nw-viz-note">范围为世界书已发生事实及已入档账本、时间线，包含本书实体名称和别名。不发送定稿全文、草稿或聊天。</p>
      <p className="nw-graph-preview-copy">{preview.value.records} 条可抽取沉淀，{preview.value.pending} 条待处理。模型：{preview.value.provider ? `${preview.value.provider.provider} / ${preview.value.provider.model}` : '尚未配置'}。</p>
      {preview.value.providerIssue ? <p className="nw-error">{preview.value.providerIssue}</p> : null}
      <p className="nw-viz-note">{preview.action === 'build' ? '只更新既有明确资料，不调用模型。' : `待处理输入合计 ${preview.value.inputChars.toLocaleString()} 字符。输出长度沿用宿主模型设置；实际请求及费用以服务账单为准。`}{preview.action === 'rebuild' ? '旧缓存会保留为备份，全部可抽取沉淀重新处理。' : ''}</p>
      <p className="nw-viz-note">首次启用后自动增量，可随时暂停或关闭。API错误或超时会保留已完成结果；重试仅处理失败项，用量记录持续保留。</p>
      <div className="nw-graph-control-actions"><Button size="sm" variant="ghost" disabled={busy} onClick={() => setPreview(undefined)}>取消</Button>
        <Button size="sm" variant="primary" disabled={busy || preview.action !== 'build' && !preview.value.provider} onClick={() => void confirm()}>{busy ? '处理中…' : '确认范围并继续'}</Button></div>
    </div> : null}
  </section>
}
