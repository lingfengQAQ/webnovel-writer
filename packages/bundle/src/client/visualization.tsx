import React, { useEffect, useId, useRef, useState } from 'react'
import { Input, Pill, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChapterView, StudyShelf } from '../study/types'
import { IconChevronLeft, IconChevronRight, IconOpen, IconRefresh, IconSearch, IconSettings } from './icons'
import { usePreferences } from './preferences'
import { openPluginSettings } from './plugin-nav'
import type { ClientHost } from './host'
import { SelectMenu } from './select-menu'
import { HintTooltip } from './tooltip'
import { RelationshipGraph } from './relationship-graph'
import { WritingWorkflow } from './workflow-view'
import type { StudyUI } from './browser'
import type { EditorStore } from './store'
import { useEditor, useSession, useStudy } from './hooks'

type ViewProps = { sessionId: string; space: string; store: EditorStore; refresh: number }
// Older hosts expose the canonical phase '完成'; newer hosts return the actual finalized fact.
const finalized = (item: ChapterView['chapters'][number]) => item.finalized ?? item.status === '完成'

export function ChapterProgress({ sessionId, space, store, refresh }: ViewProps) {
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
      <div className="nw-viz-stat"><span className="nw-viz-stat-label">全书章节</span><strong>{chapters.length}</strong></div><div className="nw-viz-stat"><span className="nw-viz-stat-label">已定稿</span><strong>{done}</strong></div>
      <div className="nw-viz-stat"><span className="nw-viz-stat-label">推进中</span><strong>{chapters.length - done}</strong></div><div className="nw-viz-stat"><span className="nw-viz-stat-label">卷数</span><strong>{volumes.length}</strong></div>
      <progress aria-label="全书定稿进度" max={Math.max(1, chapters.length)} value={done} />
    </div>
    <div className="nw-viz-toolbar">
      <Input className="nw-viz-search" icon={<IconSearch size={14} />} aria-label="搜索章节" placeholder="全书搜索章号、标题或状态" value={query} onChange={event => { setQuery(event.target.value); if (event.target.value.trim()) setVolume(0) }} />
      <SelectMenu label="筛选章节状态" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
    </div>
    <nav className="nw-volume-tabs" aria-label="按卷筛选">
      <Pill active={selectedVolume === 0} aria-pressed={selectedVolume === 0} onClick={() => setVolume(0)}>全书</Pill>
      {volumes.map(number => <Pill key={number} active={selectedVolume === number} aria-pressed={selectedVolume === number} onClick={() => setVolume(number)}>卷 {String(number).padStart(2, '0')}<small className="nw-volume-count">{chapters.filter(item => item.volume === number).length}</small></Pill>)}
    </nav>
    <div className="nw-chapter-list" role="list" aria-label="章节进度列表">
      {selected.slice(current * 40, (current + 1) * 40).map(item => <button type="button" role="listitem" className="nw-chapter-line" key={JSON.stringify([item.volume, item.chapter, item.title])}
        disabled={!item.source} title={item.source ? '打开章节来源' : '暂无可打开的来源'} onClick={() => { if (item.source) void store.open(sessionId, item.source) }}>
        <span className="nw-chapter-order">{item.chapter > 0 ? String(item.chapter).padStart(4, '0') : '待编号'}</span>
        <span className="nw-chapter-title"><strong>{item.title}</strong>{selectedVolume === 0 ? <small>卷 {item.volume}</small> : null}</span>
        <span className={'nw-chapter-state ' + (finalized(item) ? 'is-done' : '')}>{finalized(item) ? '已定稿' : item.status}</span><IconOpen size={14} className="nw-chapter-open" />
      </button>)}
      {!selected.length ? <p className="nw-empty">没有符合筛选条件的章节。</p> : null}
    </div>
    <footer className="nw-viz-pagination"><span className="nw-viz-page-info">{selected.length} 章 · 第 {current + 1} / {pages} 页</span>
      <HintTooltip tip="上一页"><button type="button" className="nw-icon" aria-label="上一页章节" disabled={current === 0} onClick={() => setPage(current - 1)}><IconChevronLeft size={16} /></button></HintTooltip>
      <HintTooltip tip="下一页"><button type="button" className="nw-icon" aria-label="下一页章节" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}><IconChevronRight size={16} /></button></HintTooltip>
    </footer>
  </>
}

type Mode = 'progress' | 'graph'
const STATUS_OPTIONS = [{ value: 'all', label: '全部状态' }, { value: 'active', label: '推进中' }, { value: 'done', label: '已定稿' }]
const MODES = [{ value: 'graph', label: '关系' }, { value: 'progress', label: '进度' }] as const satisfies readonly { value: Mode; label: string }[]

function WorkspaceVisual({ sessionId, store, host }: { sessionId: string; store: EditorStore; host: ClientHost }) {
  const preferences = usePreferences(host).value
  const state = useEditor(store, sessionId)
  const shelf = useStudy<StudyShelf>(sessionId, 'shelf', {}, state.refresh)
  const books = shelf.value?.books.filter(book => !book.error) ?? []
  const [choice, setChoice] = useState('')
  const [choiceMode, setMode] = useState<Mode>()
  const [factsAt, setFactsAt] = useState(0)
  const chapterSection = useRef<HTMLElement>(null), initialTarget = useRef('')
  const mode = choiceMode ?? (preferences.defaultVisualMode === 'graph' ? 'graph' : 'progress')
  const views = useId()
  const space = books.some(book => book.id === choice) ? choice : books[0]?.id
  useEffect(() => {
    if (!space || initialTarget.current === space) return
    initialTarget.current = space
    if (!choiceMode && preferences.defaultVisualMode === 'chapters') chapterSection.current?.scrollIntoView({ block: 'start' })
  }, [space, choiceMode, preferences.defaultVisualMode])
  return <div className="nw-viz">
    <header className="nw-viz-header"><SegmentedControl className="nw-viz-switch" id={views} label="可视化视图" value={mode} options={MODES} onChange={setMode} />
      <div className="nw-viz-header-actions"><SelectMenu className="nw-viz-book" label="选择可视化作品" value={space ?? ''} onChange={setChoice} options={books.map(book => ({ value: book.id, label: book.name }))} />
        <HintTooltip tip="打开视图设置" side="bottom"><button type="button" className="nw-icon" aria-label="打开视图设置" onClick={() => openPluginSettings(host, { kind: 'bundle', group: 'views' })}><IconSettings size={16} /></button></HintTooltip>
        <HintTooltip tip="刷新作品视图" side="bottom"><button type="button" className="nw-icon" aria-label="刷新作品视图" onClick={() => store.update(sessionId, { refresh: state.refresh + 1 })}><IconRefresh size={16} /></button></HintTooltip></div></header>
    {shelf.error ? <p className="nw-error">{shelf.error}</p> : null}
    {space ? <div key={space} id={`${views}-${mode}-panel`} role="tabpanel" aria-labelledby={`${views}-${mode}`}>{mode === 'graph' ? <RelationshipGraph host={host} preferences={preferences} {...{ sessionId, space, store, refresh: state.refresh }} /> : <>
      <WritingWorkflow compact onFactsChange={setFactsAt} {...{ sessionId, space, store, refresh: state.refresh }} />
      <section ref={chapterSection} className="nw-progress-chapters" aria-label="章节进度"><h3 className="nw-relation-section-title">章节进度</h3><ChapterProgress {...{ sessionId, space, store, refresh: state.refresh + factsAt }} /></section>
    </>}</div>
      : <p className="nw-empty">{shelf.loading ? '正在读取作品…' : '当前工作范围暂无作品。'}</p>}
  </div>
}

export function VisualView({ host, store }: StudyUI) {
  const sessionId = useSession(host)
  return <div className="webnovel nw-visual-root" data-conversation-composer-overlay="">{sessionId ? <WorkspaceVisual key={sessionId} {...{ sessionId, store, host }} /> : <p className="nw-empty">请先打开一个工作区会话</p>}</div>
}
