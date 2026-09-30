import React, { useEffect, useMemo, useRef } from 'react'
import { ArrowDownToLine, Check, Quote, Redo2, Save, Search, Undo2, X } from 'lucide-react'
import { EditorState, StateEffect } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { openSearchPanel, search, searchKeymap } from '@codemirror/search'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import type { BufferState, EditorStore } from './store'
import { useEditor } from './hooks'

const markdownRenderer = new MarkdownIt({ html: false, breaks: false, linkify: false })
markdownRenderer.renderer.rules.image = (tokens, index) => markdownRenderer.utils.escapeHtml(tokens[index]?.content ?? '图片')

export interface EditorActions {
  quote(sessionId: string): void
  close(sessionId: string): void
  openLink(sessionId: string, href: string, source: string): void
}
export type EditorMemory = Map<string, EditorState>

function CodeEditor({ identity, buffer, store, sessionId, bufferKey, memory, viewRef }: {
  identity: string; buffer: BufferState; store: EditorStore; sessionId: string; bufferKey: string; memory: EditorMemory; viewRef: React.MutableRefObject<EditorView | null>
}) {
  const mount = useRef<HTMLDivElement>(null)
  const initialText = useRef(buffer.text)
  useEffect(() => {
    if (!mount.current) return
    const extensions = [
      lineNumbers(), history(), markdown(), search({ top: true }), EditorView.lineWrapping,
      keymap.of([{ key: 'Mod-s', run: () => { void store.save(sessionId, bufferKey); return true } }, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.contentAttributes.of({ 'aria-label': '文档正文', spellcheck: 'false' }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '15px', background: 'transparent', color: 'inherit' },
        '.cm-scroller': { overflow: 'auto', fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif', lineHeight: '1.9' },
        '.cm-content': { padding: '18px 0' }, '.cm-line': { padding: '0 16px' },
        '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--nw-muted)', fontSize: '11px' },
        '&.cm-focused': { outline: 'none' },
        '.cm-cursor': { borderLeftColor: 'currentColor' },
        '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--nw-selection)' },
        '.cm-panels': { background: 'var(--nw-surface)', color: 'inherit' },
      }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) store.updateBuffer(sessionId, bufferKey, { text: update.state.doc.toString() })
        if (update.selectionSet || update.docChanged) {
          const { from, to } = update.state.selection.main
          store.update(sessionId, { selection: update.state.sliceDoc(from, to) })
        }
      }),
    ]
    const previous = memory.get(identity)
    const state = previous ? previous.update({ effects: StateEffect.reconfigure.of(extensions) }).state : EditorState.create({ doc: initialText.current, extensions })
    const view = new EditorView({ parent: mount.current, state })
    viewRef.current = view
    return () => { memory.set(identity, view.state); viewRef.current = null; view.destroy() }
  }, [identity, memory, store, sessionId, bufferKey, viewRef])
  useEffect(() => {
    const view = viewRef.current
    if (view && view.state.doc.toString() !== buffer.text) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: buffer.text } })
  }, [buffer.text, viewRef])
  return <div className="nw-code-editor" ref={mount} />
}

function Reading({ text, markdown: isMarkdown, selection, openLink }: { text: string; markdown: boolean; selection: (text: string) => void; openLink: (href: string) => void }) {
  const root = useRef<HTMLDivElement>(null)
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const html = useMemo(() => isMarkdown ? DOMPurify.sanitize(markdownRenderer.render(text), { FORBID_TAGS: ['img', 'iframe', 'style', 'form'] }) : '', [text, isMarkdown])
  useEffect(() => {
    const changed = () => {
      const selected = window.getSelection()
      if (!selected?.rangeCount) { selectionRef.current(''); return }
      const range = selected.getRangeAt(0)
      if (root.current?.contains(range.startContainer) && root.current.contains(range.endContainer)) selectionRef.current(selected.toString())
    }
    document.addEventListener('selectionchange', changed)
    return () => document.removeEventListener('selectionchange', changed)
  }, [])
  return <div ref={root} className="nw-reading" tabIndex={0} aria-label="文档预览" onClick={event => {
    const link = event.target instanceof Element ? event.target.closest('a') : null
    const href = link?.getAttribute('href')
    if (!href || href.startsWith('#')) return
    event.preventDefault(); openLink(href)
  }}>{isMarkdown ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <pre>{text}</pre>}</div>
}

function SaveStatus({ buffer, store, sessionId, bufferKey }: { buffer: BufferState; store: EditorStore; sessionId: string; bufferKey: string }) {
  const saved = buffer.saved
  if (!saved) return null
  return <div className="nw-save-status" aria-live="polite">
    <span><Check size={13} />文件已保存{saved.previousPath !== saved.document.ref.path ? ' · 已生成新稿' : ''}</span>
    {saved.commit === 'saved' ? <span>版本已提交</span> : saved.commit === 'failed' ? <span className="nw-error">{saved.commitError}<button type="button" disabled={buffer.saving} onClick={() => void store.retry(sessionId, bufferKey, 'retry-commit')}>重试提交</button></span> : null}
    {saved.notification === 'delivered' ? <span>已交给主控，处理结果见对话</span> : saved.notification === 'failed' ? <span className="nw-error">{saved.notificationError ?? '主控通知失败'}<button type="button" disabled={buffer.saving} onClick={() => void store.retry(sessionId, bufferKey, 'notify')}>重试通知</button></span> : null}
  </div>
}

export function EditorPanel({ sessionId, store, actions, memory, documentKey, embedded = false, plainText = false }: {
  sessionId: string; store: EditorStore; actions: EditorActions; memory: EditorMemory; documentKey?: string; embedded?: boolean; plainText?: boolean
}) {
  const state = useEditor(store, sessionId)
  const key = documentKey ?? state.current
  const buffer = key ? state.buffers[key] : undefined
  const view = useRef<EditorView | null>(null)
  if (!key || !buffer) return <div className="webnovel nw-panel"><p className="nw-empty">暂无打开的文档</p></div>
  const dirty = buffer.text !== buffer.document.body
  const mode = embedded ? buffer.mode ?? 'read' : state.mode
  const editing = mode === 'edit' && !buffer.document.readOnly
  const editorCommand = (run: (view: EditorView) => boolean) => { if (view.current) { run(view.current); view.current.focus() } }
  return <div className="webnovel nw-panel" onPointerDownCapture={() => { if (embedded && state.current !== key) store.update(sessionId, { current: key }) }} onFocusCapture={() => { if (embedded && state.current !== key) store.update(sessionId, { current: key }) }}>
    {!embedded && <div className="nw-document-tabs" role="tablist" aria-label="已打开文档">{Object.entries(state.buffers).map(([tabKey, tab]) => <div key={tabKey} className={tabKey === key ? 'is-selected' : ''}>
      <button type="button" role="tab" aria-selected={tabKey === key} title={`${tab.document.owner} / ${tab.document.ref.path}`} onClick={() => store.update(sessionId, { current: tabKey, selection: '', mode: state.mode === 'changes' ? 'read' : state.mode })}>{tab.document.name}{tab.text !== tab.document.body ? <span className="nw-dirty" aria-label="未保存">●</span> : null}</button>
      <button type="button" aria-label={`关闭 ${tab.document.name}`} title={`关闭 ${tab.document.name}`} disabled={tab.saving} onClick={() => { if (store.close(sessionId, tabKey)) memory.delete(sessionId + ':' + tabKey) }}><X size={12} /></button>
    </div>)}</div>}
    <div className="nw-document-source"><strong>{buffer.document.owner}</strong>{!embedded && <span title={buffer.document.absolutePath}>{buffer.document.ref.path}</span>}<small>{buffer.document.badge ? buffer.document.badge + ' · ' : ''}{buffer.document.version === null ? '无版本字段' : '版本 ' + buffer.document.version}{dirty ? ' · 未保存修改' : ''}</small></div>
    <div className="nw-editor-toolbar">
      <div className="nw-segment" role="group" aria-label="文档视图">{(['read', 'edit', 'changes'] as const).map(nextMode => <button type="button" key={nextMode} aria-pressed={mode === nextMode} disabled={nextMode === 'edit' && !!buffer.document.readOnly || nextMode === 'changes' && !buffer.saved} onClick={() => { if (embedded) store.updateBuffer(sessionId, key, { mode: nextMode }); else store.update(sessionId, { mode: nextMode, selection: '' }) }}>{nextMode === 'read' ? '阅读' : nextMode === 'edit' ? '编辑' : '改动'}</button>)}</div>
      <div className="nw-edit-tools"><button type="button" className="nw-icon" disabled={!editing} aria-label="撤销" title="撤销" onClick={() => editorCommand(undo)}><Undo2 size={15} /></button><button type="button" className="nw-icon" disabled={!editing} aria-label="重做" title="重做" onClick={() => editorCommand(redo)}><Redo2 size={15} /></button><button type="button" className="nw-icon" disabled={!editing} aria-label="搜索文档" title="搜索文档" onClick={() => editorCommand(openSearchPanel)}><Search size={15} /></button></div>
    </div>
    {buffer.document.readOnly ? <p className="nw-readonly">{buffer.document.readOnly}</p> : null}
    {state.notice ? <p className="nw-readonly" role="status">{state.notice}</p> : null}
    {buffer.error ? <div className="nw-error nw-error-bar" role="alert"><span>{buffer.error}</span><button type="button" disabled={buffer.saving} onClick={() => void store.compare(sessionId, key)}>比较磁盘版本</button></div> : null}
    {buffer.disk ? <div className="nw-conflict" role="status"><strong>磁盘内容已变化，未保存的编辑已保留</strong><details><summary>比较磁盘版本</summary><pre>{buffer.disk.body}</pre></details><p>对照当前编辑后选择处理方式；保留编辑会采用此磁盘版本作为新的保存基线。</p><div><button type="button" onClick={() => store.useDisk(sessionId, key, false)}><ArrowDownToLine size={14} />载入磁盘内容</button><button type="button" onClick={() => store.useDisk(sessionId, key, true)}>已比较，保留我的编辑</button></div></div> : null}
    <div className="nw-editor-content">{mode === 'changes' ? <div className="nw-changes"><p>{buffer.saved?.route}</p>{buffer.saved?.changes.map((change, index) => <pre key={index} className={change.added ? 'nw-added' : 'nw-removed'}><span>{change.added ? '+ ' : '− '}</span>{change.value}</pre>)}</div>
      : editing ? <CodeEditor key={sessionId + ':' + key} identity={sessionId + ':' + key} buffer={buffer} store={store} sessionId={sessionId} bufferKey={key} memory={memory} viewRef={view} />
        : <Reading text={buffer.text} markdown={!plainText && /\.md$/i.test(buffer.document.name)} selection={text => store.update(sessionId, { selection: text })} openLink={href => actions.openLink(sessionId, href, buffer.document.absolutePath)} />}</div>
    <SaveStatus {...{ buffer, store, sessionId }} bufferKey={key} />
    <footer className="nw-editor-footer"><button type="button" className="nw-quote" disabled={!state.selection.trim()} onMouseDown={event => event.preventDefault()} onClick={() => actions.quote(sessionId)}><Quote size={15} />引用到对话{state.selection ? ` · ${Array.from(state.selection).length} 字` : ''}</button>
      <span className="nw-count">{Array.from(buffer.text).length.toLocaleString()} 字</span>
      <button type="button" className="nw-primary" disabled={buffer.saving || !!buffer.document.readOnly || !dirty && !buffer.attempt} onClick={() => void store.save(sessionId, key)}><Save size={15} />{buffer.saving ? '保存中…' : buffer.attempt ? '重试保存' : '保存'}</button></footer>
  </div>
}
