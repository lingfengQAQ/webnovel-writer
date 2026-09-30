import React, { useEffect, useState } from 'react'
import { BookOpen, ChevronRight, Database, FileText, Folder, FolderOpen, RefreshCw, Search } from 'lucide-react'
import type { FileRef, StudyShelf, TreeEntry } from '../study/types'
import type { ClientHost, WorkspaceProps } from './host'
import type { EditorStore } from './store'
import { fileKey } from './store'
import { useEditor, useSession, useStudy } from './hooks'
import { useDirectoryWatch } from './watch'
import type { OpenIndex } from './indexing'

export interface StudyUI { readonly host: ClientHost; readonly store: EditorStore; readonly openIndex?: OpenIndex }

function Tree({ sessionId, refValue, store, host, absolutePath, depth = 0 }: { sessionId: string; refValue: FileRef; store: EditorStore; host: ClientHost; absolutePath?: string; depth?: number }) {
  useDirectoryWatch(host, sessionId, absolutePath, store)
  const state = useEditor(store, sessionId)
  const { value, error, loading } = useStudy<readonly TreeEntry[]>(sessionId, 'tree', { ref: refValue }, state.refresh)
  if (loading && !value) return <p className="nw-empty">读取中…</p>
  if (error) return <p className="nw-error" role="alert">{error}</p>
  if (!value?.length) return <p className="nw-empty">空目录</p>
  return <ul className="nw-tree" aria-label={refValue.path || '文件目录'}>{value.map(entry => <TreeRow key={fileKey(entry.ref)} {...{ sessionId, entry, store, host, depth }} />)}</ul>
}

function TreeRow({ sessionId, entry, store, host, depth }: { sessionId: string; entry: TreeEntry; store: EditorStore; host: ClientHost; depth: number }) {
  const [expanded, setExpanded] = useState(false)
  const state = useEditor(store, sessionId)
  const key = fileKey(entry.ref)
  const buffer = state.buffers[key]
  const dirty = !!buffer && buffer.text !== buffer.document.body
  return <li>
    <button type="button" className={`nw-tree-row ${entry.draft ? 'nw-draft' : ''} ${state.current === key ? 'is-selected' : ''}`} style={{ paddingLeft: 8 + depth * 13 }}
      aria-expanded={entry.directory ? expanded : undefined} disabled={!!entry.error} title={entry.error ?? entry.ref.path}
      onClick={() => entry.directory ? setExpanded(!expanded) : void store.open(sessionId, entry.ref)}>
      {entry.directory ? <><ChevronRight size={12} className={expanded ? 'nw-rotate' : ''} />{expanded ? <FolderOpen size={15} /> : <Folder size={15} />}</> : <><span className="nw-tree-spacer" /><FileText size={15} /></>}
      <span className="nw-file-name">{entry.name}</span>{dirty ? <span className="nw-dirty" title="未保存修改">●</span> : null}
      {entry.badge ? <span className="nw-badge">{entry.badge}</span> : entry.name === '草稿区' ? <span className="nw-badge">工作中</span> : null}
    </button>
    {entry.error ? <small className="nw-error">{entry.error}</small> : null}
    {entry.directory && expanded ? <Tree sessionId={sessionId} refValue={entry.ref} store={store} host={host} absolutePath={entry.absolutePath} depth={depth + 1} /> : null}
  </li>
}

function Book({ sessionId, book, store, host, initial }: { sessionId: string; book: StudyShelf['books'][number]; store: EditorStore; host: ClientHost; initial: boolean }) {
  const [expanded, setExpanded] = useState(initial)
  return <section className="nw-book">
    <button type="button" className="nw-book-row" aria-expanded={expanded} disabled={!!book.error} onClick={() => setExpanded(!expanded)}>
      <ChevronRight size={13} className={expanded ? 'nw-rotate' : ''} /><span className="nw-book-icon"><BookOpen size={21} /></span>
      <span className="nw-book-description"><strong>{book.name}</strong><small>{book.error ?? book.progress}</small></span>
    </button>
    {expanded && !book.error ? <Tree sessionId={sessionId} refValue={{ space: book.id, path: '' }} store={store} host={host} absolutePath={book.absolutePath} /> : null}
  </section>
}

function StudyBrowser({ sessionId, store, host, openIndex }: { sessionId: string; store: EditorStore; host: ClientHost; openIndex?: OpenIndex }) {
  const state = useEditor(store, sessionId)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => { const timer = window.setTimeout(() => setSearch(query.trim()), 200); return () => window.clearTimeout(timer) }, [query])
  const shelf = useStudy<StudyShelf>(sessionId, 'shelf', {}, state.refresh)
  const watchError = useDirectoryWatch(host, sessionId, shelf.value?.workspace, store)
  const found = useStudy<{ entries: readonly TreeEntry[]; limited: boolean }>(sessionId, search ? 'search' : null, { query: search }, state.refresh)
  return <div className="nw-study">
    <div className="nw-search-row"><label className="nw-search"><Search size={15} /><input aria-label="搜索书名或文件" placeholder="搜索书名或文件…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {openIndex ? <button type="button" className="nw-icon" aria-label="查看检索索引" title="检索索引" disabled={!shelf.value?.books.some(book => !book.error)} onClick={() => openIndex(sessionId)}><Database size={15} /></button> : null}
      <button type="button" className="nw-icon" aria-label="刷新书房" title="刷新目录与已打开正文" onClick={() => void store.refresh(sessionId)}><RefreshCw size={15} /></button></div>
    {watchError ? <p className="nw-empty" role="status">{watchError}</p> : null}
    {state.error || shelf.error ? <p className="nw-error" role="alert">{state.error ?? shelf.error}</p> : null}
    <div className="nw-shelf-scroll">
      {shelf.loading ? <p className="nw-empty">正在读取书房…</p> : null}
      {query.trim() ? <>
        {found.error ? <p className="nw-error" role="alert">{found.error}</p> : null}
        {found.loading || search !== query.trim() ? <p className="nw-empty">搜索中…</p> : null}
        {found.value?.entries.map(entry => <button type="button" className="nw-search-result" key={fileKey(entry.ref)} onClick={() => void store.open(sessionId, entry.ref)}>
          <FileText size={16} /><span><strong>{entry.name}</strong><small>{entry.ref.space === 'shared' ? '共享资料' : shelf.value?.books.find(book => book.id === entry.ref.space)?.name} / {entry.ref.path}</small></span>
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
    {shelf.value ? <footer className="nw-workspace-path" title={shelf.value.workspace}>{shelf.value.workspace}</footer> : null}
  </div>
}

export function WorkspaceStudyTabs({ wide, expandSidebar, renderSlot, host, store, openIndex }: WorkspaceProps & StudyUI) {
  const [tab, setTab] = useState<'workspace' | 'study'>('study')
  const sessionId = useSession(host)
  useEffect(() => { const show = () => setTab('study'); window.addEventListener('webnovel:show-study', show); return () => window.removeEventListener('webnovel:show-study', show) }, [])
  if (!wide) return <div className="webnovel nw-rail"><button type="button" className="nw-icon" title="展开书房" aria-label="展开书房" onClick={expandSidebar}><BookOpen size={20} /></button></div>
  return <div className="webnovel nw-left">
    <div className="nw-tabs" role="tablist" aria-label="导航分类"><button type="button" role="tab" aria-selected={tab === 'workspace'} onClick={() => setTab('workspace')}><Folder size={15} />工作区</button><button type="button" role="tab" aria-selected={tab === 'study'} onClick={() => setTab('study')}><BookOpen size={15} />书房</button></div>
    <div className="nw-native-workspaces" hidden={tab !== 'workspace'}>{renderSlot('webnovel.workspaces', { wide, expandSidebar })}</div>
    {tab === 'study' ? sessionId ? <StudyBrowser key={sessionId} sessionId={sessionId} store={store} host={host} openIndex={openIndex} /> : <p className="nw-empty">打开一个工作区会话后，即可浏览作品与共享资料。</p> : null}
  </div>
}
