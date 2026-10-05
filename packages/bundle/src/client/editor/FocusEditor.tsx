import * as React from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Compartment, EditorState, Prec, StateEffect, Transaction } from '@codemirror/state'
import { EditorView, drawSelection, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, redo, redoDepth, selectAll, undo, undoDepth } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { closeSearchPanel, openSearchPanel, search } from '@codemirror/search'
import {
  ALargeSmall, ArrowDownToLine, ArrowUp, Bold, Check, ClipboardPaste, Copy, Ellipsis, Feather, FoldVertical,
  GitCompareArrows, Heading1, Heading2, Heading3, Italic, List, ListTree, LoaderCircle, MessageSquareQuote,
  PenLine, Pilcrow, Redo2, RotateCw, Save, ScanEye, Scissors, Search, SeparatorHorizontal, Sparkles,
  TextQuote, TextSelect, TriangleAlert, Undo2, UnfoldVertical, X, type LucideIcon,
} from 'lucide-react'
import type { BufferState, EditorStore } from '../store'
import type { EditorActions } from '../editor'
import type { EditorMemory } from './memory'
import { editorFocused, linkClicks, livePreview } from './live-preview'
import { LINE_PREFIX, countChars, insertRule, minimalChange, outlineOf, setLineKind, toggleWrap, unsavedChanges } from './commands'
import {
  acceptItem, addItems, collab, collabField, collapsedPending, dismissItem, expiredGhosts, findItem, focusedItem,
  isWriteIntent, removeItems, resolveAsk, restoreItem, type CommentItem, type Intent,
} from './collab'
import { createRequestId, type EditorRequests } from './requests'
import { isOwnSaveEcho } from './sync'
import type { SaveToastSource } from './save-toast'
import { ContextMenu, type MenuSection } from './Menu'
import { DEFAULT_TYPOGRAPHY, FindPanel, OutlinePanel, TypePanel, TYPE_LIMITS, type Typography } from './panels'
import { TooltipLayer } from './Tooltip'

type Icon = LucideIcon
interface Anchor { top: number; bottom: number; center: number }
type Panel = null | 'find' | 'replace' | 'type' | 'outline'

const FONTS = {
  serif: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", "SimSun", serif',
  sans: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", sans-serif',
}
const MEASURES = { narrow: '30em', medium: '38em', full: 'none' }
const TYPE_KEY = 'webnovel-editor-typography'
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const dismissedReadonly = new Set<string>()

function loadTypography(): Typography {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_TYPOGRAPHY
    const stored = JSON.parse(localStorage.getItem(TYPE_KEY) ?? '{}') as Partial<Typography>
    const font = stored.font === 'sans' ? 'sans' : 'serif'
    const measure = stored.measure === 'narrow' || stored.measure === 'full' ? stored.measure : 'medium'
    return {
      font,
      measure,
      size: clamp(typeof stored.size === 'number' ? stored.size : DEFAULT_TYPOGRAPHY.size, TYPE_LIMITS.sizeMin, TYPE_LIMITS.sizeMax),
      leading: clamp(typeof stored.leading === 'number' ? stored.leading : DEFAULT_TYPOGRAPHY.leading, TYPE_LIMITS.leadingMin, TYPE_LIMITS.leadingMax),
      indent: typeof stored.indent === 'boolean' ? stored.indent : true,
    }
  } catch { return DEFAULT_TYPOGRAPHY }
}

function Anchored({ anchor, bounds, prefer, className, children, gap = 8, ...rest }: {
  anchor: Anchor; bounds: { width: number; height: number }; prefer: 'above' | 'below'; className: string; children: React.ReactNode; gap?: number
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'className' | 'children'>) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const node = ref.current
    if (node && (node.offsetWidth !== size.width || node.offsetHeight !== size.height)) setSize({ width: node.offsetWidth, height: node.offsetHeight })
  })
  const left = clamp(anchor.center - size.width / 2, 8, Math.max(8, bounds.width - size.width - 8))
  const above = anchor.top - size.height - gap
  const below = anchor.bottom + gap
  const top = prefer === 'above'
    ? (above >= 8 ? above : below)
    : (below + size.height <= bounds.height - 8 ? below : Math.max(8, above))
  return <div ref={ref} className={className} style={{ left, top, opacity: size.width ? undefined : 0 }} {...rest}>{children}</div>
}

function Tool({ icon: IconComponent, tip, onClick, agent, danger, disabled }: {
  icon: Icon; tip: string; onClick: () => void; agent?: boolean; danger?: boolean; disabled?: boolean
}) {
  return <button type="button" className={'ed-icon' + (agent ? ' is-agent' : '') + (danger ? ' is-danger' : '')} aria-label={tip.split(' · ')[0]} data-tip={tip} disabled={disabled}
    onMouseDown={event => event.preventDefault()} onClick={onClick}><IconComponent size={16} strokeWidth={1.75} /></button>
}

export function FocusEditor({ identity, buffer, store, sessionId, bufferKey, memory, actions, requests, plainText, notice }: {
  identity: string
  buffer: BufferState
  store: EditorStore
  sessionId: string
  bufferKey: string
  memory: EditorMemory
  actions: EditorActions
  requests: EditorRequests
  plainText: boolean
  notice?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const bufferRef = useRef(buffer)
  bufferRef.current = buffer
  const loadHistory = useRef(false)
  const dragging = useRef(false)
  const queueRef = useRef<string[]>([])
  const draining = useRef(false)
  const toastSeq = useRef(0)
  const [tick, setTick] = useState(0)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [toast, setToast] = useState<{ text: string; seq: number } | null>(null)
  const [suppressed, setSuppressed] = useState(false)
  const [typography, setTypography] = useState<Typography>(loadTypography)
  const [showChanges, setShowChanges] = useState(false)
  const [compareDisk, setCompareDisk] = useState(false)
  const [confirmLoad, setConfirmLoad] = useState(false)
  const [prompt, setPrompt] = useState<{ from: number; to: number; mode: 'edit' | 'continue' } | null>(null)
  const [promptText, setPromptText] = useState('')
  const [comment, setComment] = useState<string | null>(null)
  const [readonlyClosed, setReadonlyClosed] = useState(() => dismissedReadonly.has(identity))
  const [failureHidden, setFailureHidden] = useState('')
  const changesCompartment = useMemo(() => new Compartment(), [])
  const readOnlyCompartment = useMemo(() => new Compartment(), [])
  const refresh = () => setTick(value => value + 1)
  const pushToast = useCallback((text: string) => {
    queueRef.current.push(text)
    if (draining.current) return
    const next = queueRef.current.shift()
    if (!next) return
    draining.current = true
    setToast({ text: next, seq: ++toastSeq.current })
  }, [])

  const readOnly = !!buffer.document.readOnly
  const dirty = buffer.text !== buffer.document.body || !!buffer.attempt
  const asking = useRef<string | null>(null)

  function save() {
    const current = viewRef.current
    if (!current || bufferRef.current.document.readOnly || bufferRef.current.saving) return
    if (current.state.doc.toString() === bufferRef.current.document.body && !bufferRef.current.attempt) {
      pushToast('没有需要保存的改动')
      return
    }
    const accepted = requests.unsent(identity, current.state)
    void store.save(sessionId, bufferKey, accepted)
  }
  async function ask(intent: Intent, instruction?: string, range?: { from: number; to: number }) {
    const current = viewRef.current
    if (!current || asking.current) return
    if (readOnly && isWriteIntent(intent)) { pushToast('只读文档只允许审读'); return }
    const target = resolveAsk(current.state, intent, range)
    if (!target.ok) { pushToast(target.message); return }
    const trimmed = instruction?.trim()
    if (intent === 'custom' && !trimmed) return
    const id = createRequestId()
    asking.current = id
    setMenu(null)
    setPrompt(null)
    setComment(null)
    const pending = { kind: 'pending' as const, id, intent, from: target.from, to: target.to, original: target.text, status: 'sending' as const, touched: false }
    current.dispatch({ effects: addItems.of([pending]), selection: { anchor: target.to } })
    current.focus()
    try {
      await requests.submit({
        sessionId, key: bufferKey, identity, requestId: id, intent,
        ...(trimmed ? { instruction: trimmed } : {}),
        ref: bufferRef.current.document.ref,
        hash: bufferRef.current.document.hash,
        dirty: bufferRef.current.text !== bufferRef.current.document.body || !!bufferRef.current.attempt,
        selection: { text: target.text, line: target.line, before: target.before, after: target.after },
      })
    } finally { if (asking.current === id) asking.current = null }
  }
  function accept(id: string) {
    const current = viewRef.current
    if (!current) return
    if (acceptItem(id)(current)) requests.record(id, 'accepted')
    current.focus()
  }
  function reject(id: string) {
    const current = viewRef.current
    if (!current || !findItem(current.state, id)) return
    if (dismissItem(id)(current)) requests.record(id, 'rejected')
    current.focus()
  }
  function retry(id: string) {
    const current = viewRef.current
    const item = current && findItem(current.state, id)
    if (!current || !item || (item.kind !== 'suggestion' && item.kind !== 'ghost')) return
    const previous = requests.meta(id)
    if (dismissItem(id)(current)) requests.record(id, 'rejected')
    void ask(item.intent, previous?.instruction, { from: item.from, to: item.kind === 'ghost' ? item.from : item.to })
  }
  function cancel(id: string) {
    if (asking.current === id) asking.current = null
    void requests.cancel(sessionId, [id])
  }
  function jump(delta: number): boolean {
    const current = viewRef.current
    if (!current) return false
    const items = [...(current.state.field(collabField, false) ?? [])].sort((a, b) => a.from - b.from)
    if (!items.length) return false
    const head = current.state.selection.main.head
    const next = delta > 0 ? items.find(item => item.from > head) ?? items[0] : [...items].reverse().find(item => item.from < head) ?? items[items.length - 1]
    if (!next) return false
    current.dispatch({ selection: { anchor: next.from }, effects: EditorView.scrollIntoView(next.from, { y: 'center' }) })
    current.focus()
    return true
  }
  function openPrompt() {
    const current = viewRef.current
    if (!current) return
    if (readOnly) { pushToast('只读文档只允许审读'); return }
    const { from, to } = current.state.selection.main
    setMenu(null)
    setComment(null)
    setPromptText('')
    setPrompt(from === to ? { from: current.state.doc.lineAt(to).to, to: current.state.doc.lineAt(to).to, mode: 'continue' } : { from, to, mode: 'edit' })
  }
  function submitPrompt() {
    if (!prompt) return
    const text = promptText.trim()
    if (prompt.mode === 'edit' && !text) return
    const next = prompt
    setPrompt(null)
    void ask(next.mode === 'continue' ? 'continue' : 'custom', text || undefined, { from: next.from, to: next.to })
  }
  function quote() {
    const current = viewRef.current
    if (!current) return
    const { from, to } = current.state.selection.main
    const line = current.state.doc.lineAt(from)
    const text = from === to ? line.text.replace(LINE_PREFIX, '') : current.state.sliceDoc(from, to)
    if (!text.trim()) { pushToast('先选中要引用的文字'); return }
    actions.quote(sessionId, { text, line: line.number })
    setSuppressed(true)
  }
  function openPanel(next: Panel) {
    setMenu(null)
    setPanel(current => current === next && next !== 'replace' ? null : next)
  }
  function escape(): boolean {
    const current = viewRef.current
    if (!current) return false
    if (comment) { setComment(null); return true }
    if (prompt) { setPrompt(null); return true }
    if (!current.state.selection.main.empty && !suppressed) { setSuppressed(true); return true }
    const item = focusedItem(current.state)
    if (item) { reject(item.id); return true }
    if (panel) { setPanel(null); return true }
    return false
  }
  function contextMenu(event: MouseEvent) {
    event.preventDefault()
    const current = viewRef.current
    const root = rootRef.current
    if (!current || !root) return
    const pos = current.posAtCoords({ x: event.clientX, y: event.clientY })
    const sel = current.state.selection.main
    if (pos !== null && (sel.empty || pos < sel.from || pos > sel.to)) current.dispatch({ selection: { anchor: pos } })
    const rect = root.getBoundingClientRect()
    setPanel(null)
    setMenu({ x: event.clientX - rect.left, y: event.clientY - rect.top })
  }
  function menuAtCaret() {
    const current = viewRef.current
    const root = rootRef.current
    if (!current || !root) return
    const coords = current.coordsAtPos(current.state.selection.main.head)
    const rect = root.getBoundingClientRect()
    setPanel(null)
    setMenu({ x: (coords?.left ?? rect.left + 40) - rect.left, y: (coords?.bottom ?? rect.top + 40) - rect.top + 4 })
  }
  async function clipboard(action: 'cut' | 'copy' | 'paste') {
    const current = viewRef.current
    if (!current) return
    try {
      if (action === 'paste') {
        const text = await navigator.clipboard.readText()
        current.dispatch(current.state.replaceSelection(text))
      } else {
        const { from, to } = current.state.selection.main
        await navigator.clipboard.writeText(current.state.sliceDoc(from, to))
        if (action === 'cut') current.dispatch(current.state.update({ changes: { from, to }, userEvent: 'delete.cut' }))
      }
    } catch { pushToast(action === 'paste' ? '浏览器不允许读取剪贴板，请按 Ctrl V' : '浏览器不允许写入剪贴板，请按 Ctrl C') }
    current.focus()
  }

  const handlers = useRef({ save, escape, openPanel, openPrompt, contextMenu, menuAtCaret, accept, jump, cancel, ask })
  handlers.current = { save, escape, openPanel, openPrompt, contextMenu, menuAtCaret, accept, jump, cancel, ask }

  useEffect(() => {
    const parent = mountRef.current
    if (!parent) return
    const h = () => handlers.current
    const extensions = [
      history(), drawSelection(), EditorView.lineWrapping,
      ...(plainText ? [] : [markdown({ base: markdownLanguage }), livePreview, linkClicks(href => actions.openLink(sessionId, href, bufferRef.current.document.absolutePath))]),
      collab,
      search({ createPanel: () => { const dom = document.createElement('div'); dom.hidden = true; return { dom, top: true } } }),
      changesCompartment.of([]),
      readOnlyCompartment.of(EditorState.readOnly.of(!!bufferRef.current.document.readOnly)),
      Prec.highest(keymap.of([
        { key: 'Tab', run: view => { const item = focusedItem(view.state); if (!item) return false; h().accept(item.id); return true } },
        { key: 'Escape', run: () => h().escape() },
        { key: 'Mod-k', run: () => { h().openPrompt(); return true }, preventDefault: true },
        { key: 'Mod-s', run: () => { h().save(); return true }, preventDefault: true },
        { key: 'Mod-b', run: toggleWrap('**') },
        { key: 'Mod-i', run: toggleWrap('*') },
        { key: 'Mod-1', run: setLineKind('h1') },
        { key: 'Mod-2', run: setLineKind('h2') },
        { key: 'Mod-3', run: setLineKind('h3') },
        { key: 'Mod-0', run: setLineKind('p') },
        { key: 'Mod-f', run: () => { h().openPanel('find'); return true }, preventDefault: true },
        { key: 'Mod-h', run: () => { h().openPanel(bufferRef.current.document.readOnly ? 'find' : 'replace'); return true }, preventDefault: true },
        { key: 'Mod-Shift-o', run: () => { h().openPanel('outline'); return true }, preventDefault: true },
        { key: 'Alt-]', run: () => h().jump(1) },
        { key: 'Alt-[', run: () => h().jump(-1) },
        { key: 'Shift-F10', run: () => { h().menuAtCaret(); return true }, preventDefault: true },
        { key: 'ContextMenu', run: () => { h().menuAtCaret(); return true }, preventDefault: true },
      ])),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.contentAttributes.of({ 'aria-label': '文档正文', spellcheck: 'false', autocorrect: 'off' }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          const text = update.state.doc.toString()
          if (text !== bufferRef.current.text) store.updateBuffer(sessionId, bufferKey, { text })
        }
        if (update.selectionSet) setSuppressed(false)
        const cancelIds: string[] = []
        for (const tr of update.transactions) {
          cancelIds.push(...collapsedPending(tr))
          for (const id of expiredGhosts(tr)) requests.expire(id)
          if (!tr.isUserEvent('undo') && !tr.isUserEvent('redo')) continue
          for (const effect of tr.effects) {
            if (effect.is(restoreItem) && effect.value.kind !== 'pending') requests.reopen(identity, effect.value.id)
            else if (effect.is(removeItems)) for (const id of effect.value) requests.replay(id)
          }
        }
        if (cancelIds.length) queueMicrotask(() => {
          if (asking.current && cancelIds.includes(asking.current)) asking.current = null
          void requests.cancel(sessionId, cancelIds)
        })
        refresh()
      }),
      EditorView.domEventHandlers({
        contextmenu: event => { h().contextMenu(event); return true },
        mousedown: event => { if (event.button === 0) dragging.current = true; return false },
        focus: () => { refresh(); return false },
        blur: () => { refresh(); return false },
      }),
    ]
    const cached = memory.get(identity)
    const state = cached
      ? cached.update({ effects: StateEffect.reconfigure.of(extensions) }).state
      : EditorState.create({ doc: bufferRef.current.text, extensions })
    const view = new EditorView({ parent, state })
    viewRef.current = view
    requests.mount(sessionId, bufferKey, identity, view)
    const release = () => { if (dragging.current) { dragging.current = false; refresh() } }
    const scrolled = () => refresh()
    document.addEventListener('mouseup', release)
    view.scrollDOM.addEventListener('scroll', scrolled, { passive: true })
    refresh()
    return () => {
      document.removeEventListener('mouseup', release)
      view.scrollDOM.removeEventListener('scroll', scrolled)
      requests.unmount(identity)
      memory.set(identity, view.state)
      viewRef.current = null
      view.destroy()
    }
  }, [actions, bufferKey, changesCompartment, identity, memory, plainText, readOnlyCompartment, requests, sessionId, store])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const next = buffer.text
    const current = view.state.doc.toString()
    if (current === next) return
    const record = loadHistory.current
    loadHistory.current = false
    const change = minimalChange(current, next)
    view.dispatch(view.state.update(record
      ? { changes: change }
      : { changes: change, annotations: Transaction.addToHistory.of(false) }))
    // 外部干净重载会先清掉 saved；保存回写保留同一份 document，规范化换行不该当成别人的同步。
    if (!record && !isOwnSaveEcho(buffer.saved, buffer.document)) pushToast('磁盘上的新版本已同步')
  }, [buffer.document, buffer.saved, buffer.text, pushToast])

  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.readOnly === readOnly) return
    view.dispatch({ effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)) })
  }, [readOnly, readOnlyCompartment])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const diskBody = compareDisk ? buffer.disk?.body : undefined
    const extension = diskBody !== undefined
      ? unsavedChanges(() => diskBody)
      : showChanges ? unsavedChanges(() => buffer.document.body) : []
    view.dispatch({ effects: changesCompartment.reconfigure(extension) })
  }, [buffer.disk, buffer.document.body, buffer.document.hash, changesCompartment, compareDisk, showChanges])

  useEffect(() => { setCompareDisk(false); setConfirmLoad(false) }, [buffer.disk?.hash])
  useEffect(() => {
    if (!confirmLoad) return
    const timer = window.setTimeout(() => setConfirmLoad(false), 3000)
    return () => window.clearTimeout(timer)
  }, [confirmLoad])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => {
      const next = queueRef.current.shift()
      if (next) setToast({ text: next, seq: ++toastSeq.current })
      else { draining.current = false; setToast(null) }
    }, 2200)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    try { localStorage.setItem(TYPE_KEY, JSON.stringify(typography)) } catch { /* private mode */ }
    viewRef.current?.requestMeasure()
  }, [typography])
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (panel === 'find' || panel === 'replace') openSearchPanel(view)
    else closeSearchPanel(view)
    if (!panel) view.focus()
  }, [panel])

  useEffect(() => {
    const flush = () => { for (const text of requests.pull(identity)) pushToast(text) }
    const off = requests.subscribe(flush)
    flush()
    return off
  }, [identity, pushToast, requests])
  useEffect(() => {
    const saved = buffer.saved
    if (saved?.operationId) requests.commit(identity, saved.operationId, buffer.accepted ?? [])
  }, [buffer.accepted, buffer.saved, identity, requests])
  useEffect(() => {
    const saved = buffer.saved
    const source: SaveToastSource | undefined = saved && {
      operationId: saved.operationId,
      changed: saved.changed,
      previousPath: saved.previousPath,
      path: saved.document.ref.path,
      commit: saved.commit,
      notification: saved.notification,
    }
    const claimed = memory.noteSave(source)
    if (!claimed.text) return
    pushToast(claimed.text)
    // 新稿会立刻换挂载。提示还没站住就卸载时把记录退回，让新实例再提示一次。
    let settled = false
    const timer = window.setTimeout(() => { settled = true }, 400)
    return () => {
      window.clearTimeout(timer)
      if (!settled) claimed.undo()
    }
  }, [buffer.saved, memory, pushToast])
  const noticeSeen = useRef(notice)
  useEffect(() => {
    if (notice && notice !== noticeSeen.current && notice !== '文档已保存' && notice !== '文档没有变化') pushToast(notice)
    noticeSeen.current = notice
  }, [notice, pushToast])

  const view = viewRef.current
  const state = view?.state
  const rootRect = rootRef.current?.getBoundingClientRect()
  const bounds = { width: rootRect?.width ?? 0, height: rootRect?.height ?? 0 }
  const narrow = bounds.width > 0 && bounds.width < 360
  const anchorOf = (from: number, to: number): Anchor | null => {
    if (!view || !rootRect) return null
    const start = view.coordsAtPos(from, 1)
    const end = view.coordsAtPos(to, -1)
    if (!start || !end) return null
    const top = Math.min(start.top, end.top) - rootRect.top
    const bottom = Math.max(start.bottom, end.bottom) - rootRect.top
    if (bottom < 0 || top > bounds.height) return null
    const sameLine = Math.abs(start.top - end.top) < 4
    return { top, bottom, center: (sameLine ? (start.left + end.right) / 2 : start.left + 140) - rootRect.left }
  }
  const sel = state?.selection.main
  const focused = !!view && editorFocused(view)
  const bubble = view && sel && !sel.empty && !dragging.current && !menu && !prompt && !panel && !suppressed && focused ? anchorOf(sel.from, sel.to) : null
  let spark: { left: number; top: number } | null = null
  if (view && sel && rootRect && sel.empty && focused && !readOnly && !menu && !prompt && !panel && !state!.doc.lineAt(sel.head).text.trim()) {
    const coords = view.coordsAtPos(sel.head)
    if (coords) spark = { left: Math.max(4, coords.left - rootRect.left - 30), top: (coords.top + coords.bottom) / 2 - rootRect.top - 12 }
  }
  const promptAnchor = prompt ? anchorOf(prompt.from, prompt.to) : null
  const items = state?.field(collabField, false) ?? []
  const openComment = comment ? items.find((item): item is CommentItem => item.kind === 'comment' && item.id === comment) : undefined
  const commentAnchor = openComment ? anchorOf(openComment.to, openComment.to) : null
  const pendingCount = items.filter(item => item.kind === 'pending').length
  const readyCount = items.filter(item => item.kind === 'suggestion' || item.kind === 'ghost').length
  const noteCount = items.filter(item => item.kind === 'comment').length
  const run = (command: (current: EditorView) => boolean) => () => {
    const current = viewRef.current
    if (current) { command(current); current.focus() }
  }
  const selected = state && sel ? state.sliceDoc(sel.from, sel.to) : ''
  const sections: MenuSection[] = !menu || !state ? [] : [
    { id: 'edit', row: true, items: [
      { id: 'cut', icon: Scissors, label: '剪切', shortcut: 'Ctrl X', disabled: readOnly || !selected, run: () => void clipboard('cut') },
      { id: 'copy', icon: Copy, label: '复制', shortcut: 'Ctrl C', disabled: !selected, run: () => void clipboard('copy') },
      { id: 'paste', icon: ClipboardPaste, label: '粘贴', shortcut: 'Ctrl V', disabled: readOnly, run: () => void clipboard('paste') },
      { id: 'all', icon: TextSelect, label: '全选', shortcut: 'Ctrl A', run: run(selectAll) },
      { id: 'undo', icon: Undo2, label: '撤销', shortcut: 'Ctrl Z', disabled: readOnly || !undoDepth(state), run: run(undo) },
      { id: 'redo', icon: Redo2, label: '重做', shortcut: 'Ctrl Shift Z', disabled: readOnly || !redoDepth(state), run: run(redo) },
      { id: 'save', icon: Save, label: dirty ? '保存' : '已保存', shortcut: 'Ctrl S', disabled: readOnly || buffer.saving || !dirty, run: save },
    ] },
    { id: 'agent', items: [
      ...(!readOnly ? [
        { id: 'polish', icon: Feather, label: '润色', agent: true, run: () => void ask('polish') },
        { id: 'expand', icon: UnfoldVertical, label: '扩写', agent: true, run: () => void ask('expand') },
        { id: 'condense', icon: FoldVertical, label: '精简', agent: true, run: () => void ask('condense') },
        { id: 'continue', icon: PenLine, label: '从这里续写', agent: true, run: () => void ask('continue') },
        { id: 'custom', icon: Sparkles, label: '按我的要求改…', shortcut: 'Ctrl K', agent: true, run: openPrompt },
      ] : []),
      { id: 'review', icon: ScanEye, label: '审读', agent: true, run: () => void ask('review') },
      { id: 'quote', icon: MessageSquareQuote, label: '引用到对话', run: quote },
    ] },
    { id: 'tools', items: [
      { id: 'format', icon: Pilcrow, label: '段落格式', disabled: readOnly, submenu: [
        { id: 'h1', icon: Heading1, label: '章标题', shortcut: 'Ctrl 1', run: run(viewFor => setLineKind('h1')(viewFor)) },
        { id: 'h2', icon: Heading2, label: '小节标题', shortcut: 'Ctrl 2', run: run(viewFor => setLineKind('h2')(viewFor)) },
        { id: 'h3', icon: Heading3, label: '三级标题', shortcut: 'Ctrl 3', run: run(viewFor => setLineKind('h3')(viewFor)) },
        { id: 'p', icon: Pilcrow, label: '正文', shortcut: 'Ctrl 0', run: run(viewFor => setLineKind('p')(viewFor)) },
        { id: 'quote-block', icon: TextQuote, label: '引文', run: run(viewFor => setLineKind('quote')(viewFor)) },
        { id: 'list', icon: List, label: '列表', run: run(viewFor => setLineKind('list')(viewFor)) },
        { id: 'rule', icon: SeparatorHorizontal, label: '场景分隔', run: run(insertRule) },
        { id: 'bold', icon: Bold, label: '加粗', shortcut: 'Ctrl B', disabled: !selected, run: run(viewFor => toggleWrap('**')(viewFor)) },
        { id: 'italic', icon: Italic, label: '楷体强调', shortcut: 'Ctrl I', disabled: !selected, run: run(viewFor => toggleWrap('*')(viewFor)) },
      ] },
      { id: 'find', icon: Search, label: '查找替换', shortcut: 'Ctrl F', run: () => openPanel('find') },
      { id: 'outline', icon: ListTree, label: '大纲', shortcut: 'Ctrl Shift O', disabled: plainText, run: () => openPanel('outline') },
      { id: 'type', icon: ALargeSmall, label: '排版', run: () => openPanel('type') },
      { id: 'changes', icon: GitCompareArrows, label: '标出未保存改动', checked: showChanges, disabled: readOnly || (!dirty && !showChanges), run: () => setShowChanges(value => !value) },
    ] },
  ]
  const header = menu && state ? `${selected ? `选中 ${countChars(selected)} 字` : '当前段落'} · 全文 ${countChars(state.doc.toString()).toLocaleString()} 字` : ''
  const outline = panel === 'outline' && state && !plainText ? outlineOf(state) : []
  const outlineCurrent = panel === 'outline' && sel ? outline.reduce((index, entry, i) => entry.from <= sel.head ? i : index, -1) : -1
  const failureText = [
    buffer.error,
    buffer.saved?.commit === 'failed' ? (buffer.saved.commitError ?? '版本提交失败') : undefined,
    buffer.saved?.notification === 'failed' ? (buffer.saved.notificationError ?? '主控通知失败') : undefined,
  ].filter((item): item is string => !!item)
  const failureKey = failureText.join('\n')
  const showFailure = failureText.length > 0 && failureHidden !== failureKey && !buffer.disk
  const showReadonly = readOnly && !readonlyClosed && !buffer.disk && !showFailure && !!buffer.document.readOnly

  return <div ref={rootRef}
    className={'nw-focus' + (typography.indent ? ' is-indent' : '') + (narrow ? ' is-narrow' : '') + (plainText ? ' is-plain' : '')}
    style={{ '--ed-font': FONTS[typography.font], '--ed-size': typography.size + 'px', '--ed-leading': String(typography.leading), '--ed-measure': MEASURES[typography.measure] } as React.CSSProperties}
    onMouseDown={event => { if ((event.target as HTMLElement).closest('[data-collab-action]')) event.preventDefault() }}
    onClick={event => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-collab-action]')
      if (!target) return
      const id = target.dataset.collabId
      const action = target.dataset.collabAction
      if (!id) return
      if (action === 'accept') accept(id)
      else if (action === 'reject') reject(id)
      else if (action === 'retry') retry(id)
      else if (action === 'cancel') cancel(id)
      else if (action === 'reveal') pushToast('请在对话里查看这条请求（#' + id + '）')
      else if (action === 'comment-open') setComment(current => current === id ? null : id)
    }}>
    <TooltipLayer />
    <div ref={mountRef} className="ed-mount" />
    {buffer.disk && <div className="ed-float ed-attention" role="alert">
      <div className="ed-attention-row">
        <TriangleAlert size={16} className="ed-attention-icon" />
        <span>磁盘上的这份文档被改动了，你未保存的编辑都还在。</span>
        <Tool icon={GitCompareArrows} tip={compareDisk ? '收起差异' : '在正文中标出与磁盘版本的差异'} onClick={() => setCompareDisk(value => !value)} />
        <Tool icon={ArrowDownToLine} danger={confirmLoad} tip={confirmLoad ? '再点一次：放弃我的编辑，载入磁盘版本' : '载入磁盘版本（放弃我的编辑）'} onClick={() => {
          if (!confirmLoad) { setConfirmLoad(true); return }
          loadHistory.current = true
          store.useDisk(sessionId, bufferKey, false)
          setConfirmLoad(false)
        }} />
        <Tool icon={Check} tip="已比较，保留我的编辑" onClick={() => {
          store.useDisk(sessionId, bufferKey, true)
          pushToast('已保留你的编辑，保存时以磁盘新版本为基线')
        }} />
      </div>
      {compareDisk && <div className="ed-attention-legend">
        <span className="cm-chg-ins">只在你的版本里</span>
        <span className="cm-chg-del">只在磁盘版本里</span>
      </div>}
    </div>}
    {showFailure && <div className="ed-float ed-attention" role="alert">
      <div className="ed-attention-row">
        <TriangleAlert size={16} className="ed-attention-icon" />
        <span>{failureText.join(' ')}</span>
        {buffer.error && <Tool icon={RotateCw} tip="重试保存" disabled={buffer.saving || readOnly} onClick={() => void store.save(sessionId, bufferKey)} />}
        {buffer.errorCode === 'conflict' && <Tool icon={GitCompareArrows} tip="比较磁盘版本" disabled={buffer.saving} onClick={() => void store.compare(sessionId, bufferKey)} />}
        {buffer.saved?.commit === 'failed' && <Tool icon={RotateCw} tip="重试提交" disabled={buffer.saving} onClick={() => void store.retry(sessionId, bufferKey, 'retry-commit')} />}
        {buffer.saved?.notification === 'failed' && <Tool icon={RotateCw} tip="重试通知" disabled={buffer.saving} onClick={() => void store.retry(sessionId, bufferKey, 'notify')} />}
        <Tool icon={X} tip="关闭" onClick={() => setFailureHidden(failureKey)} />
      </div>
    </div>}
    {showReadonly && <div className="ed-float ed-attention" role="status">
      <div className="ed-attention-row">
        <TriangleAlert size={16} className="ed-attention-icon" />
        <span>{buffer.document.readOnly}</span>
        <Tool icon={X} tip="关闭" onClick={() => { dismissedReadonly.add(identity); setReadonlyClosed(true) }} />
      </div>
    </div>}
    {bubble && <Anchored anchor={bubble} bounds={bounds} prefer="above" className="ed-float ed-bubble" role="toolbar" aria-label="选区操作" onMouseDown={event => event.preventDefault()}>
      <div className="ed-group is-agent">
        {!readOnly && <>
          <Tool agent icon={Feather} tip="让主 Agent 润色" onClick={() => void ask('polish')} />
          <Tool agent icon={UnfoldVertical} tip="让主 Agent 扩写" onClick={() => void ask('expand')} />
          <Tool agent icon={FoldVertical} tip="让主 Agent 精简" onClick={() => void ask('condense')} />
        </>}
        <Tool agent icon={ScanEye} tip="让主 Agent 审读" onClick={() => void ask('review')} />
        {!readOnly && <Tool agent icon={Sparkles} tip="按我的要求改 · Ctrl K" onClick={openPrompt} />}
      </div>
      <span className="ed-sep" />
      <Tool icon={MessageSquareQuote} tip="引用到对话" onClick={quote} />
      {!narrow && !readOnly && <>
        <span className="ed-sep" />
        <Tool icon={Bold} tip="加粗 · Ctrl B" onClick={run(viewFor => toggleWrap('**')(viewFor))} />
        <Tool icon={Italic} tip="楷体强调 · Ctrl I" onClick={run(viewFor => toggleWrap('*')(viewFor))} />
      </>}
      <Tool icon={Ellipsis} tip="更多 · 右键" onClick={() => { setPanel(null); setPrompt(null); setMenu({ x: bubble.center - 110, y: bubble.bottom + 6 }) }} />
    </Anchored>}
    {spark && <button type="button" className="ed-spark" style={{ left: spark.left, top: spark.top }} aria-label="让主 Agent 从这里续写" data-tip="让主 Agent 从这里续写 · Ctrl K"
      onMouseDown={event => event.preventDefault()} onClick={openPrompt}><Sparkles size={14} strokeWidth={1.75} /></button>}
    {prompt && promptAnchor && <Anchored anchor={promptAnchor} bounds={bounds} prefer="below" className="ed-float ed-prompt" role="dialog" aria-label="交给主 Agent">
      <Sparkles size={16} className="ed-prompt-lead" aria-hidden="true" />
      <input autoFocus value={promptText} aria-label="给主 Agent 的要求"
        placeholder={prompt.mode === 'continue' ? '后文想怎么走？留空直接续写' : '告诉主 Agent 怎么改这段'}
        onChange={event => setPromptText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); submitPrompt() }
          else if (event.key === 'Escape') { event.preventDefault(); setPrompt(null); viewRef.current?.focus() }
        }}
        onBlur={() => window.setTimeout(() => { if (!rootRef.current?.querySelector('.ed-prompt:focus-within')) setPrompt(null) }, 120)} />
      <button type="button" className="ed-icon is-send" aria-label="发送给主 Agent" data-tip="发送给主 Agent · Enter"
        disabled={prompt.mode === 'edit' && !promptText.trim()} onMouseDown={event => event.preventDefault()} onClick={submitPrompt}><ArrowUp size={16} /></button>
    </Anchored>}
    {openComment && commentAnchor && <Anchored anchor={commentAnchor} bounds={bounds} prefer="below" className="ed-float ed-note" role="dialog" aria-label="审读批注">
      <p>{openComment.note}</p>
      <div className="ed-note-actions">
        {!readOnly && <Tool agent icon={Feather} tip="按这条批注修改" onClick={() => {
          const current = viewRef.current
          if (!current) return
          const line = current.state.doc.lineAt(openComment.from)
          current.dispatch({ effects: removeItems.of([openComment.id]) })
          setComment(null)
          void ask('custom', '按审读意见修改：' + openComment.note, { from: line.from + (LINE_PREFIX.exec(line.text)?.[0].length ?? 0), to: line.to })
        }} />}
        <Tool icon={MessageSquareQuote} tip="带着批注去对话里讨论" onClick={() => {
          const current = viewRef.current
          if (!current) return
          const line = current.state.doc.lineAt(openComment.from)
          actions.quote(sessionId, { text: line.text + '\n\n审读批注：' + openComment.note, line: line.number })
          pushToast('已放进对话输入框，等你发送')
        }} />
        <Tool icon={Check} tip="知道了，移除批注" onClick={() => { viewRef.current?.dispatch({ effects: removeItems.of([openComment.id]) }); setComment(null) }} />
      </div>
    </Anchored>}
    {menu && <ContextMenu x={menu.x} y={menu.y} bounds={bounds} sections={sections} header={header}
      onClose={refocus => { setMenu(null); if (refocus) viewRef.current?.focus() }} />}
    {menu && <div className="ed-scrim" onMouseDown={event => { event.preventDefault(); setMenu(null); viewRef.current?.focus() }} onContextMenu={event => { event.preventDefault(); setMenu(null) }} />}
    {view && (panel === 'find' || panel === 'replace') && <FindPanel view={view} replace={panel === 'replace'} tick={tick} writable={!readOnly} onClose={() => setPanel(null)} />}
    {panel === 'type' && <TypePanel value={typography} onChange={patch => setTypography(current => ({ ...current, ...patch }))} onClose={() => setPanel(null)} />}
    {panel === 'outline' && <OutlinePanel entries={outline} current={outlineCurrent} onClose={() => setPanel(null)} onPick={entry => {
      const current = viewRef.current
      if (!current) return
      current.dispatch({ selection: { anchor: entry.from }, effects: EditorView.scrollIntoView(entry.from, { y: 'start', yMargin: 24 }) })
      current.focus()
      setPanel(null)
    }} />}
    {(pendingCount || readyCount || noteCount) ? <button type="button" className="ed-float ed-collab-pill" onMouseDown={event => event.preventDefault()} onClick={() => jump(1)}
      aria-label="跳到下一条主 Agent 建议" data-tip={`${pendingCount ? pendingCount + ' 条处理中 ' : ''}${readyCount ? readyCount + ' 条建议待定 ' : ''}${noteCount ? noteCount + ' 条批注 ' : ''}· Alt ]`}>
      {pendingCount ? <span><LoaderCircle size={14} className="ed-spin" />{pendingCount}</span> : null}
      {readyCount ? <span className="is-ready"><Sparkles size={14} />{readyCount}</span> : null}
      {noteCount ? <span className="is-note"><ScanEye size={14} />{noteCount}</span> : null}
    </button> : null}
    {toast && <div key={toast.seq} className="ed-toast" role="status">{toast.text}</div>}
  </div>
}
