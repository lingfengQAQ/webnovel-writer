import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Pause, Play, RefreshCw, RotateCcw } from 'lucide-react'
import type { IndexAction } from '@webnovel/core'
import type { IndexView } from '../indexing/manager'
import type { StudyShelf } from '../study/types'
import type { ClientHost } from './host'
import { mainSessionOf } from './host'
import { callStudy } from './api'
import { useStudy } from './hooks'
import { createIndexSelection, isNewerIndexView, type IndexSelection } from './index-state'

const TAB_ID = '@webnovel/bundle/index'
const TAB_KIND = 'webnovel-index'
const labels: Record<IndexView['phase'], string> = {
  disabled: '自动更新已关闭', unconfigured: '等待配置嵌入模型', queued: '等待后台处理', scanning: '正在校准定稿',
  scenes: '正在识别场景', embedding: '正在生成向量', retrying: '等待自动重试', paused: '已暂停', ready: '索引已同步', failed: '索引需要处理',
}
export type OpenIndex = (sessionId: string, space?: string) => void

function IndexPanel({ sessionId, selection }: { sessionId: string; selection: IndexSelection }) {
  const chosen = useSyncExternalStore(selection.subscribe, () => selection.get(sessionId))
  const shelf = useStudy<StudyShelf>(sessionId, 'shelf')
  const books = shelf.value?.books.filter(book => !book.error) ?? []
  const space = books.some(book => book.id === chosen) ? chosen : books[0]?.id
  const key = `${sessionId}\0${space ?? ''}`
  const [snapshot, setSnapshot] = useState<{ key: string; value?: IndexView; error?: string }>()
  const [busyRequest, setBusyRequest] = useState<{ key: string; abort: AbortController }>()
  const [sceneChapter, setSceneChapter] = useState('')
  const [confirmation, setConfirmation] = useState<{ key: string; action: 'rebuild' | 'rescan-scenes'; chapter?: number }>()
  const active = useRef(key)
  const control = useRef<typeof busyRequest>()
  active.current = key
  const value = snapshot?.key === key ? snapshot.value : undefined
  const error = snapshot?.key === key ? snapshot.error : undefined
  const busy = busyRequest?.key === key

  const accept = (requestKey: string, next: IndexView) => setSnapshot(previous => {
    if (active.current !== requestKey) return previous
    if (previous?.key === requestKey && !isNewerIndexView(previous.value, next)) return previous
    return { key: requestKey, value: next }
  })
  useEffect(() => {
    if (!space) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let live = true
    const poll = async () => {
      try { const next = await callStudy<IndexView>(sessionId, 'index-status', { space }, abort.signal); if (live) accept(key, next) }
      catch (failure) {
        if (live && active.current === key) setSnapshot(previous => ({ key, value: previous?.key === key ? previous.value : undefined, error: failure instanceof Error ? failure.message : '无法读取索引状态' }))
      } finally { if (live) timer = setTimeout(() => { void poll() }, 1200) }
    }
    void poll()
    return () => {
      live = false; abort.abort(); if (timer) clearTimeout(timer)
      const request = control.current
      if (request?.key === key) {
        control.current = undefined
        request.abort.abort()
        setBusyRequest(previous => previous === request ? undefined : previous)
      }
    }
  }, [sessionId, space])

  const pending = confirmation?.key === key ? confirmation : undefined
  const run = async (action: IndexAction, confirmed = false, chapter?: number) => {
    if (!space || busy || control.current?.key === key) return
    if (!confirmed && (action === 'rebuild' || action === 'rescan-scenes')) {
      if (action === 'rescan-scenes' && sceneChapter && (!Number.isSafeInteger(Number(sceneChapter)) || Number(sceneChapter) < 1)) {
        setSnapshot(previous => ({ ...previous, key, error: '章号须为正整数，留空表示全书' })); return
      }
      setConfirmation({ key, action, ...(action === 'rescan-scenes' && sceneChapter ? { chapter: Number(sceneChapter) } : {}) })
      return
    }
    setConfirmation(undefined)
    control.current?.abort.abort()
    const abort = new AbortController()
    const request = { key, abort }
    control.current = request
    setBusyRequest(request)
    try {
      const next = await callStudy<IndexView>(sessionId, 'index-control', { space, action, ...(action === 'rescan-scenes' && chapter !== undefined ? { chapter } : {}) }, abort.signal)
      if (!abort.signal.aborted && control.current === request) accept(key, next)
    }
    catch (failure) {
      if (!abort.signal.aborted && active.current === key) setSnapshot(previous => ({ key, value: previous?.key === key ? previous.value : undefined, error: failure instanceof Error ? failure.message : '索引操作失败' }))
    } finally {
      if (control.current === request) control.current = undefined
      setBusyRequest(previous => previous === request ? undefined : previous)
    }
  }

  const working = !!value && ['queued', 'scanning', 'scenes', 'embedding', 'retrying'].includes(value.phase)
  const remaining = value?.retryAt ? Math.max(0, Math.ceil((value.retryAt - Date.now()) / 1000)) : 0
  return <div className="webnovel nw-index">
    <label className="nw-index-book"><span>作品</span><select aria-label="选择索引作品" value={space ?? ''} onChange={event => selection.choose(sessionId, event.target.value)}>
      {books.map(book => <option key={book.id} value={book.id}>{book.name}</option>)}
    </select></label>
    {shelf.error || error ? <p className="nw-error" role="alert">{shelf.error ?? error}</p> : null}
    {!space && !shelf.loading ? <p className="nw-empty">当前工作范围没有可用作品</p> : null}
    {space && !value ? <p className="nw-empty">正在读取索引状态…</p> : null}
    {value ? <>
      <div className={`nw-index-status is-${value.phase}`} role="status"><span className="nw-index-dot" /><strong>{labels[value.phase]}</strong></div>
      {!value.providerConfigured ? <p className="nw-index-help">请先在“设置 → 模型 → 嵌入模型”填写服务、模型、维度和凭据。</p> : null}
      <label className="nw-index-auto"><input type="checkbox" checked={value.auto} disabled={busy} onChange={event => { void run(event.target.checked ? 'enable' : 'disable') }} />提交后自动更新</label>
      <p className="nw-index-help">包含终端和其他编辑器的 Git 提交。后台更新不影响正文提交；关闭此页面后仍会继续。</p>
      <section className="nw-index-progress" aria-label="索引进度">
        <div><strong>{value.completedChunks} / {value.chunks}</strong><span>片段已落库</span></div>
        <progress aria-label="索引片段进度" value={value.completedChunks} max={Math.max(1, value.chunks)} />
        <p>{value.completedChapters} / {value.chapters} 章已完成</p>
        <dl><div><dt>本次生成</dt><dd>{value.generated}</dd></div><div><dt>复用</dt><dd>{value.reused}</dd></div><div><dt>待处理</dt><dd>{Math.max(0, value.chunks - value.completedChunks)}</dd></div></dl>
      </section>
      {value.scenes ? <section className="nw-index-progress"><strong>场景识别 {value.scenes.completed} / {value.scenes.total} 章</strong>
        <progress aria-label="场景识别进度" value={value.scenes.completed} max={Math.max(1, value.scenes.total)} />
        <p>新识别 {value.scenes.generated} · 复用 {value.scenes.reused} · 回退段落 {value.scenes.fallback}</p>
        {value.scenes.model ? <p>场景模型：{value.scenes.model}</p> : null}{value.scenes.warning ? <p role="status">{value.scenes.warning}</p> : null}</section> : null}
      {value.phase === 'retrying' ? <p className="nw-index-retry" role="status">重试 {value.attempt} / {value.maxRetries} · {remaining} 秒后再次尝试</p> : null}
      {value.lastError ? <div className="nw-index-error" role="alert"><strong>{value.lastError.message}</strong>
        {value.notice ? <small>{value.notice.delivered ? '诊断已交给所属主会话' : value.notice.deliveryError ?? '诊断已保留，等待所属主会话接收'}</small> : null}
      </div> : null}
      <div className="nw-index-actions">
        <button type="button" disabled={busy || working} onClick={() => { void run(value.phase === 'failed' || value.phase === 'unconfigured' ? 'retry' : 'update') }}><RefreshCw size={14} />{value.phase === 'failed' || value.phase === 'unconfigured' ? '立即重试' : '立即更新'}</button>
        <button type="button" disabled={busy || !working && !value.paused} onClick={() => { void run(value.paused ? 'resume' : 'pause') }}>{value.paused ? <Play size={14} /> : <Pause size={14} />}{value.paused ? '继续' : '暂停'}</button>
        <button type="button" disabled={busy || working} onClick={() => { void run('rebuild') }}><RotateCcw size={14} />重建向量</button>
      </div>
      {value.sceneConfigured ? <div className="nw-index-actions"><label>重新识别章号 <input aria-label="重新识别章号" type="number" min={1} step={1} value={sceneChapter} placeholder="留空为全书" disabled={busy || working} onChange={event => setSceneChapter(event.target.value)} /></label>
        <button type="button" disabled={busy || working} onClick={() => { void run('rescan-scenes') }}>重新识别场景</button></div> : null}
      {pending ? <section className="nw-index-confirm" role="group" aria-label="确认索引操作">
        <p>{pending.action === 'rebuild'
          ? '重新生成《' + value.bookName + '》的全部定稿向量？场景边界将保留。'
          : '重新识别《' + value.bookName + '》' + (pending.chapter ? '第 ' + pending.chapter + ' 章' : '全书') + '的场景？将重新调用场景模型，并更新受影响的向量。'}</p>
        <div className="nw-index-actions"><button type="button" disabled={busy} onClick={() => setConfirmation(undefined)}>取消</button>
          <button type="button" disabled={busy || working} onClick={() => { if (pending.key === active.current) void run(pending.action, true, pending.chapter) }}>确认执行</button></div>
      </section> : null}
      {value.provider ? <dl className="nw-index-model"><div><dt>嵌入模型</dt><dd>{value.provider.model}</dd></div><div><dt>向量维度</dt><dd>{value.provider.dimensions}</dd></div></dl> : null}
      {value.head || value.indexedHead ? <div className="nw-index-version"><span>目标提交 {value.head?.slice(0, 8) ?? '未提交'}</span><span>已同步 {value.indexedHead?.slice(0, 8) ?? '尚未完成'}</span></div> : null}
      {value.issues?.length ? <details className="nw-index-details"><summary>异常来源（{value.issues.length}）</summary><ul>{value.issues.map(issue => <li key={issue.path}>{issue.path}：{issue.message}</li>)}</ul></details> : null}
      {value.errors.length ? <details className="nw-index-details"><summary>最近诊断（{value.errors.length}）</summary><ul>{[...value.errors].reverse().map((entry, index) => <li key={index}><time>{new Date(entry.at).toLocaleTimeString()}</time> · 尝试 {entry.attempt}<br />{entry.error.message}</li>)}</ul></details> : null}
    </> : null}
  </div>
}

export function installIndexSidebar(host: ClientHost): OpenIndex {
  const selection = createIndexSelection()
  host.effect(() => () => selection.dispose(), 'webnovel: index view selection')
  host.effect(() => host.sidebarRightTabs.register({ id: TAB_ID, kind: TAB_KIND, title: () => '检索索引',
    guide: [{ id: TAB_ID, order: 51, title: () => '检索索引', description: () => '查看当前书的后台索引进度、重试和错误。' }] }), 'webnovel: index progress tab')
  host.slots.inject('sidebar.right.pane.tab', () => host.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID,
    inject: (sessionId: string) => ({ sessionId, selection }) }, IndexPanel))
  return (sessionId, space) => {
    if (mainSessionOf(host) !== sessionId) return
    if (space) selection.choose(sessionId, space)
    host.sidebarRight.openTab(TAB_KIND)
  }
}
