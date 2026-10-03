import React, { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, Network, RefreshCw, Search, Workflow } from 'lucide-react'
import type { ChapterView, StudyShelf } from '../study/types'
import { RelationshipGraph } from './relationship-graph'
import { WritingWorkflow } from './workflow-view'
import type { StudyUI } from './browser'
import type { EditorStore } from './store'
import { useEditor, useSession, useStudy } from './hooks'

type ViewProps = { sessionId: string; space: string; store: EditorStore; refresh: number }
// Older hosts expose the canonical phase '完成'; newer hosts return the actual finalized fact.
const finalized = (item: ChapterView['chapters'][number]) => item.finalized ?? item.status === '完成'

function ChapterProgress({ sessionId, space, store, refresh }: ViewProps) {
  const data = useStudy<ChapterView>(sessionId, 'chapters', { space }, refresh)
  const [volume, setVolume] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(0)
  const chapters = data.value?.chapters ?? []
  const volumes = [...new Set(chapters.map(item => item.volume))].sort((a, b) => a - b)
  const latestVolume = volumes.at(-1) ?? 0
  const selectedVolume = volume ?? latestVolume
  const done = chapters.filter(item => finalized(item)).length
  const needle = query.trim().toLocaleLowerCase()
  const selected = chapters.filter(item => (selectedVolume === 0 || item.volume === selectedVolume)
    && (status === 'all' || (status === 'done' ? finalized(item) : !finalized(item)))
    && (!needle || (String(item.chapter).padStart(4, '0') + ' ' + item.title + ' ' + item.status).toLocaleLowerCase().includes(needle)))
  const pages = Math.max(1, Math.ceil(selected.length / 40))
  const current = Math.min(page, pages - 1)
  useEffect(() => setPage(0), [volume, query, status])
  if (data.error) return <p className="nw-error" role="alert">{data.error}</p>
  if (!data.value) return <p className="nw-empty">正在读取章节进度…</p>
  return <>
    <div className="nw-viz-overview">
      <div><span>全书章节</span><strong>{chapters.length}</strong></div><div><span>已定稿</span><strong>{done}</strong></div>
      <div><span>推进中</span><strong>{chapters.length - done}</strong></div><div><span>卷数</span><strong>{volumes.length}</strong></div>
      <progress aria-label="全书定稿进度" max={Math.max(1, chapters.length)} value={done} />
    </div>
    <div className="nw-viz-toolbar">
      <label className="nw-viz-search"><Search size={15} /><input aria-label="搜索章节" placeholder="全书搜索章号、标题或状态" value={query} onChange={event => { setQuery(event.target.value); if (event.target.value.trim()) setVolume(0) }} /></label>
      <select aria-label="筛选章节状态" value={status} onChange={event => setStatus(event.target.value)}><option value="all">全部状态</option><option value="active">推进中</option><option value="done">已定稿</option></select>
    </div>
    <nav className="nw-volume-tabs" aria-label="按卷筛选">
      <button type="button" aria-pressed={selectedVolume === 0} onClick={() => setVolume(0)}>全书</button>
      {volumes.map(number => <button type="button" key={number} aria-pressed={selectedVolume === number} onClick={() => setVolume(number)}>卷 {String(number).padStart(2, '0')}<small>{chapters.filter(item => item.volume === number).length}</small></button>)}
    </nav>
    <div className="nw-chapter-list" role="list" aria-label="章节进度列表">
      {selected.slice(current * 40, (current + 1) * 40).map(item => <button type="button" role="listitem" className="nw-chapter-line" key={JSON.stringify([item.volume, item.chapter, item.title])}
        disabled={!item.source} title={item.source ? '打开章节来源' : '暂无可打开的来源'} onClick={() => { if (item.source) void store.open(sessionId, item.source) }}>
        <span className="nw-chapter-order">{item.chapter > 0 ? String(item.chapter).padStart(4, '0') : '待编号'}</span>
        <span className="nw-chapter-title"><strong>{item.title}</strong>{selectedVolume === 0 ? <small>卷 {item.volume}</small> : null}</span>
        <span className={'nw-chapter-state ' + (finalized(item) ? 'is-done' : '')}>{finalized(item) ? '已定稿' : item.status}</span><ExternalLink size={13} />
      </button>)}
      {!selected.length ? <p className="nw-empty">没有符合筛选条件的章节。</p> : null}
    </div>
    <footer className="nw-viz-pagination"><span>{selected.length} 章 · 第 {current + 1} / {pages} 页</span>
      <button type="button" aria-label="上一页章节" disabled={current === 0} onClick={() => setPage(current - 1)}><ArrowLeft size={15} /></button>
      <button type="button" aria-label="下一页章节" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}><ArrowRight size={15} /></button>
    </footer>
  </>
}

function WorkspaceVisual({ sessionId, store }: { sessionId: string; store: EditorStore }) {
  const state = useEditor(store, sessionId)
  const shelf = useStudy<StudyShelf>(sessionId, 'shelf', {}, state.refresh)
  const books = shelf.value?.books.filter(book => !book.error) ?? []
  const [choice, setChoice] = useState('')
  const [mode, setMode] = useState<'workflow' | 'graph' | 'chapters'>('workflow')
  const space = books.some(book => book.id === choice) ? choice : books[0]?.id
  return <div className="nw-viz">
    <header className="nw-viz-header"><div><p>作品视图</p><h2>{mode === 'graph' ? '人物关系' : mode === 'workflow' ? '写作流程' : '章节进度'}</h2></div>
      <div className="nw-viz-header-actions"><select aria-label="选择可视化作品" value={space ?? ''} onChange={event => setChoice(event.target.value)}>{books.map(book => <option key={book.id} value={book.id}>{book.name}</option>)}</select>
        <button type="button" className="nw-icon" aria-label="刷新作品视图" onClick={() => store.update(sessionId, { refresh: state.refresh + 1 })}><RefreshCw size={16} /></button></div></header>
    <div className="nw-viz-switch" role="group" aria-label="可视化视图"><button type="button" aria-pressed={mode === 'workflow'} onClick={() => setMode('workflow')}><Workflow size={15} />写作流程</button><button type="button" aria-pressed={mode === 'graph'} onClick={() => setMode('graph')}><Network size={15} />人物关系</button>
      <button type="button" aria-pressed={mode === 'chapters'} onClick={() => setMode('chapters')}><BookOpen size={15} />章节进度</button></div>
    {shelf.error ? <p className="nw-error">{shelf.error}</p> : null}
    {space ? <div key={space}>{mode === 'workflow' ? <WritingWorkflow {...{ sessionId, space, store, refresh: state.refresh }} /> : mode === 'graph' ? <RelationshipGraph {...{ sessionId, space, store, refresh: state.refresh }} /> : <ChapterProgress {...{ sessionId, space, store, refresh: state.refresh }} />}</div>
      : <p className="nw-empty">{shelf.loading ? '正在读取作品…' : '当前工作范围暂无作品。'}</p>}
  </div>
}

export function VisualView({ host, store }: StudyUI) {
  const sessionId = useSession(host)
  return <div className="webnovel nw-visual-root" data-conversation-composer-overlay="">{sessionId ? <WorkspaceVisual key={sessionId} {...{ sessionId, store }} /> : <p className="nw-empty">请先打开一个工作区会话</p>}</div>
}
