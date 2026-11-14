import React, { useEffect, useId, useState } from 'react'
import { FileTypeIcon, Input, PathLabel, SegmentedTabs, Tag, classifyFileType, type TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FileRef, StudyShelf, TreeEntry } from '../study/types'
import { IconBook, IconChevronRight, IconDatabase, IconFolder, IconFolderOpen, IconRefresh, IconSearch, IconSettings } from './icons'
import { openPluginSettings } from './plugin-nav'
import { HintTooltip } from './tooltip'
import type { ClientHost, WorkspaceProps } from './host'
import type { EditorStore } from './store'
import { fileKey } from './store'
import { useEditor, useSession, useStudy } from './hooks'
import { useDirectoryWatch } from './watch'
import type { OpenIndex } from './indexing'

export interface StudyUI { readonly host: ClientHost; readonly store: EditorStore; readonly openIndex?: OpenIndex }

const depthStyle = (depth: number) => ({ '--nw-depth': depth }) as React.CSSProperties
const BADGE_TONES: Readonly<Record<string, TagTone>> = { 格式异常: 'danger', 待审稿: 'warning', 作者手改: 'warning', 工作中: 'warning' }

/** DSH's own file-type glyph, the same one its file sidebar draws at 16px; the kind stays readable for probes. */
function FileIcon({ name }: { name: string }) {
  const kind = classifyFileType(name)
  return <span className="nw-file-icon" data-file-type={kind}><FileTypeIcon kind={kind} size={16} /></span>
}

function Badge({ text }: { text: string }) {
  return <Tag className="nw-badge" tone={BADGE_TONES[text] ?? 'neutral'}>{text}</Tag>
}

function Tree({ sessionId, refValue, store, host, absolutePath, depth = 0 }: { sessionId: string; refValue: FileRef; store: EditorStore; host: ClientHost; absolutePath?: string; depth?: number }) {
  useDirectoryWatch(host, sessionId, absolutePath, store)
  const state = useEditor(store, sessionId)
  const { value, error, loading } = useStudy<readonly TreeEntry[]>(sessionId, 'tree', { ref: refValue }, state.refresh)
  if (loading && !value) return <div className="nw-tree-skeleton" style={depthStyle(depth)} role="status" aria-label="读取中…"><span className="nw-tree-skeleton-line" /><span className="nw-tree-skeleton-line" /></div>
  if (error) return <p className="nw-error nw-tree-note" style={depthStyle(depth)} role="alert">{error}</p>
  if (!value?.length) return <p className="nw-empty nw-tree-note" style={depthStyle(depth)}>空目录</p>
  return <ul className="nw-tree" style={depthStyle(depth)} aria-label={refValue.path || '文件目录'}>{value.map(entry => <TreeRow key={fileKey(entry.ref)} {...{ sessionId, entry, store, host, depth }} />)}</ul>
}

function TreeRow({ sessionId, entry, store, host, depth }: { sessionId: string; entry: TreeEntry; store: EditorStore; host: ClientHost; depth: number }) {
  const [expanded, setExpanded] = useState(false)
  const state = useEditor(store, sessionId)
  const key = fileKey(entry.ref)
  const buffer = state.buffers[key]
  const dirty = !!buffer && buffer.text !== buffer.document.body
  return <li>
    <button type="button" className={`nw-tree-row ${entry.draft ? 'nw-draft' : ''} ${state.current === key ? 'is-selected' : ''}`}
      aria-expanded={entry.directory ? expanded : undefined} disabled={!!entry.error} title={entry.error ?? entry.ref.path}
      onClick={() => entry.directory ? setExpanded(!expanded) : void store.open(sessionId, entry.ref)}>
      {entry.directory ? <><IconChevronRight size={12} className={`nw-chevron ${expanded ? 'nw-rotate' : ''}`} />{expanded ? <IconFolderOpen size={16} className="nw-folder" /> : <IconFolder size={16} className="nw-folder" />}</> : <><span className="nw-tree-spacer" /><FileIcon name={entry.name} /></>}
      <span className="nw-file-name">{entry.name}</span>{dirty ? <span className="nw-dirty" title="未保存修改">●</span> : null}
      {entry.badge ? <Badge text={entry.badge} /> : entry.name === '草稿区' ? <Badge text="工作中" /> : null}
    </button>
    {entry.error ? <small className="nw-error">{entry.error}</small> : null}
    {entry.directory && expanded ? <Tree sessionId={sessionId} refValue={entry.ref} store={store} host={host} absolutePath={entry.absolutePath} depth={depth + 1} /> : null}
  </li>
}

function Book({ sessionId, book, store, host, initial }: { sessionId: string; book: StudyShelf['books'][number]; store: EditorStore; host: ClientHost; initial: boolean }) {
  const [expanded, setExpanded] = useState(initial)
  return <section className="nw-book">
    <button type="button" className="nw-book-row" aria-expanded={expanded} disabled={!!book.error} onClick={() => setExpanded(!expanded)}>
      <IconChevronRight size={14} className={`nw-chevron ${expanded ? 'nw-rotate' : ''}`} /><span className="nw-book-icon"><IconBook size={20} /></span>
      <span className="nw-book-description"><strong>{book.name}</strong><small>{book.error ?? book.progress}</small></span>
    </button>
    {expanded && !book.error ? <Tree sessionId={sessionId} refValue={{ space: book.id, path: '' }} store={store} host={host} absolutePath={book.absolutePath} /> : null}
  </section>
}

function StudyBrowser({ sessionId, store, host, openIndex, useSectionScroller }: { sessionId: string; store: EditorStore; host: ClientHost; openIndex?: OpenIndex; useSectionScroller?: WorkspaceProps['useSectionScroller'] }) {
  const sectionScroller = useSectionScroller?.()
  const state = useEditor(store, sessionId)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => { const timer = window.setTimeout(() => setSearch(query.trim()), 200); return () => window.clearTimeout(timer) }, [query])
  const shelf = useStudy<StudyShelf>(sessionId, 'shelf', {}, state.refresh)
  const watchError = useDirectoryWatch(host, sessionId, shelf.value?.workspace, store)
  const found = useStudy<{ entries: readonly TreeEntry[]; limited: boolean }>(sessionId, search ? 'search' : null, { query: search }, state.refresh)
  return <div className="nw-study">
    <div className="nw-search-row"><Input className="nw-search" icon={<IconSearch size={14} />} aria-label="搜索书名或文件" placeholder="搜索书名或文件…" value={query} onChange={event => setQuery(event.target.value)} />
      <HintTooltip tip="打开插件设置" side="bottom"><button type="button" className="nw-icon" aria-label="打开插件设置" onClick={() => openPluginSettings(host, { kind: 'bundle' })}><IconSettings size={16} /></button></HintTooltip>
      {openIndex ? <HintTooltip tip="检索索引" side="bottom"><button type="button" className="nw-icon" aria-label="查看检索索引" disabled={!shelf.value?.books.some(book => !book.error)} onClick={() => openIndex(sessionId)}><IconDatabase size={16} /></button></HintTooltip> : null}
      <HintTooltip tip="刷新目录与已打开正文" side="bottom"><button type="button" className="nw-icon" aria-label="刷新书房" onClick={() => void store.refresh(sessionId)}><IconRefresh size={16} /></button></HintTooltip></div>
    {watchError ? <p className="nw-empty" role="status">{watchError}</p> : null}
    {state.error || shelf.error ? <p className="nw-error" role="alert">{state.error ?? shelf.error}</p> : null}
    <div className="nw-shelf-scroll" ref={sectionScroller?.bindScrollerRef}>
      {shelf.loading && !shelf.value ? <p className="nw-empty">正在读取书房…</p> : null}
      {query.trim() ? <>
        {found.error ? <p className="nw-error" role="alert">{found.error}</p> : null}
        {found.loading && !found.value || search !== query.trim() ? <p className="nw-empty">搜索中…</p> : null}
        {found.value?.entries.map(entry => <button type="button" className="nw-search-result" key={fileKey(entry.ref)} onClick={() => void store.open(sessionId, entry.ref)}>
          <FileIcon name={entry.name} /><span className="nw-search-result-text"><strong>{entry.name}</strong><small>{entry.ref.space === 'shared' ? '共享资料' : shelf.value?.books.find(book => book.id === entry.ref.space)?.name} / {entry.ref.path}</small></span>
        </button>)}
        {found.value && !found.value.entries.length ? <p className="nw-empty">没有匹配的书稿或资料</p> : null}
        {found.value?.limited ? <p className="nw-empty">结果较多，请缩小搜索范围</p> : null}
      </> : shelf.value ? <>
        <div className="nw-section-title"><span>我的作品</span><span>{shelf.value.books.length}</span></div>
        {shelf.value.books.map((book, index) => <Book key={book.id} sessionId={sessionId} book={book} store={store} host={host} initial={index === 0} />)}
        {!shelf.value.books.length ? <p className="nw-empty">当前工作范围还没有作品。可在对话中开始构想，或切换到已有书仓的工作区。</p> : null}
        <div className="nw-section-title"><span>共享资料</span></div>
        {shelf.value.shared ? <Tree sessionId={sessionId} refValue={{ space: 'shared', path: '' }} store={store} host={host} absolutePath={shelf.value.workspace + '/书房'} /> : <p className={shelf.value.sharedError ? 'nw-error' : 'nw-empty'}>{shelf.value.sharedError ?? '当前书房暂无共享资料'}</p>}
      </> : null}
    </div>
    {shelf.value ? <footer className="nw-workspace-path"><PathLabel path={shelf.value.workspace} /></footer> : null}
  </div>
}

export function WorkspaceStudyTabs({ wide, expandSidebar, renderSlot, useSectionScroller, host, store, openIndex }: WorkspaceProps & StudyUI) {
  const [tab, setTab] = useState<'workspace' | 'study'>('study')
  const sessionId = useSession(host)
  const id = useId()
  useEffect(() => { const show = () => setTab('study'); window.addEventListener('webnovel:show-study', show); return () => window.removeEventListener('webnovel:show-study', show) }, [])
  if (!wide) return <div className="webnovel nw-rail"><HintTooltip tip="展开书房" side="right"><button type="button" className="nw-icon" aria-label="展开书房" onClick={expandSidebar}><IconBook size={20} /></button></HintTooltip></div>
  const tabs = [
    { value: 'workspace' as const, id: id + 'workspace', panelId: id + 'workspace-panel', label: <><IconFolder size={14} />工作区</> },
    { value: 'study' as const, id: id + 'study', panelId: id + 'study-panel', label: <><IconBook size={14} />书房</> },
  ] as const
  return <div className="webnovel nw-left" data-section-scroller={useSectionScroller ? '' : undefined}>
    <SegmentedTabs className="nw-tabs" label="导航分类" items={tabs} value={tab} onChange={setTab} />
    <div className="nw-native-workspaces" id={tabs[0].panelId} role="tabpanel" aria-labelledby={tabs[0].id} hidden={tab !== 'workspace'}>{renderSlot('webnovel.workspaces', { wide: wide && tab === 'workspace', expandSidebar, ...(useSectionScroller ? { useSectionScroller } : {}) })}</div>
    {tab === 'study' ? <div className="nw-study-panel" id={tabs[1].panelId} role="tabpanel" aria-labelledby={tabs[1].id}>
      {sessionId ? <StudyBrowser key={sessionId} sessionId={sessionId} store={store} host={host} openIndex={openIndex} useSectionScroller={useSectionScroller} /> : <p className="nw-empty">打开一个工作区会话后，即可浏览作品与共享资料。</p>}
    </div> : null}
  </div>
}
