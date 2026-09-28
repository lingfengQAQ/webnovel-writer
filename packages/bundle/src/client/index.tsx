import React from 'react'
import { BookOpen } from 'lucide-react'
import type { ClientHost, NativeEntry, NativeOpenService, WorkspaceProps } from './host'
import type { StudyDocument } from '../study/types'
import { callStudy } from './api'
import { WorkspaceStudyTabs } from './browser'
import { VisualView } from './visualization'
import visualizationStyles from './visualization.css'
import { type EditorActions, type EditorMemory } from './editor'
import { useSession } from './hooks'
import { mainSessionOf } from './host'
import { installWritingSidebar, revealWriting } from './native-sidebar'
import { createEditorStore } from './store'
import { documentQuote } from './quote'
import { parseStudyLink, studyLink } from '../study/links'
import styles from './styles.css'
import indexStyles from './indexing.css'
import { installIndexSidebar } from './indexing'

export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs', 'conversation', 'sessions', 'uiWorkspace']

export function apply(host: ClientHost) {
  const store = createEditorStore(id => revealWriting(host, id))
  const openIndex = installIndexSidebar(host)
  const memory: EditorMemory = new Map()
  const actions: EditorActions = {
    close: id => {
      store.cancelOpen(id)
      if (mainSessionOf(host) === id && host.sidebarRight.isExpanded()) host.sidebarRight.toggleExpanded()
    },
    openLink: (id, href, source) => {
      if (/^https?:\/\//i.test(href)) { window.open(href, '_blank', 'noopener,noreferrer'); return }
      try {
        const raw = source.replace(/\\/g, '/')
        const base = new URL('file://' + (raw.startsWith('/') ? '' : '/') + raw)
        const url = new URL(href, base)
        if (url.protocol !== 'file:') return
        const target = decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:\/)/, '$1')
        const remote = host.get('remote.session') as NativeOpenService | undefined
        if (remote) void remote.openWorkspacePath({ path: target }).catch(error => store.update(id, { error: error instanceof Error ? error.message : '文档链接无法打开' }))
      } catch { store.update(id, { error: '文档链接格式不正确' }) }
    },
    quote: id => {
      if (mainSessionOf(host) !== id) return
      const state = store.get(id)
      const buffer = state.current ? state.buffers[state.current] : undefined
      const scope = host.sessions.scope(id)
      if (!buffer || !scope || !state.selection.trim()) return
      const input = host.conversation.input.for(scope)
      const previous = input.state.getSnapshot().draft
      input.setDraft(previous + (previous && !previous.endsWith('\n\n') ? '\n\n' : '') + documentQuote(buffer.document, buffer.text, state.selection)
        + '\n[在书房打开原文](<' + studyLink(window.location.origin, id, buffer.document.ref) + '>)\n')
      store.update(id, { selection: '', notice: '引用已放入当前对话输入框，等待你发送' })
      window.getSelection()?.removeAllRanges()
      if (window.innerWidth < 1024) actions.close(id)
    },
  }
  host.effect(() => {
    const style = document.createElement('style')
    style.dataset.webnovel = ''
    style.textContent = styles + '\n' + indexStyles + '\n' + visualizationStyles
    document.head.append(style)
    const preventLoss = (event: BeforeUnloadEvent) => { if (store.hasUnsaved()) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', preventLoss)
    return () => { window.removeEventListener('beforeunload', preventLoss); store.dispose(); memory.clear(); style.remove() }
  }, 'webnovel: client lifetime')
  host.slots.inject('conversation.input.right', () => host.slots.register({ name: 'conversation.input.right', id: 'webnovel-open', order: 50 }, () => {
    const id = useSession(host)
    return <button type="button" className="webnovel nw-launch" disabled={!id} title="打开书稿与资料" aria-label="打开书稿与资料" onClick={() => { if (id) revealWriting(host, id) }}><BookOpen size={17} /><span>书稿</span></button>
  }))
  host.slots.inject('conversation.view', () => host.slots.register({ name: 'conversation.view', id: 'webnovel-visual', label: '可视化', order: 30, inject: () => ({ host, store, openIndex }) }, VisualView))
  installWritingSidebar(host, store, actions, memory)
  host.effect(() => {
    const openLink = (link: NonNullable<ReturnType<typeof parseStudyLink>>) => {
      if (mainSessionOf(host) !== link.sessionId) host.uiWorkspace.openSession(link.sessionId)
      void store.open(link.sessionId, link.ref)
    }
    const intercept = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      const link = anchor ? parseStudyLink(anchor.getAttribute('href')!, window.location.origin) : undefined
      if (!link) return
      event.preventDefault(); event.stopPropagation(); openLink(link)
    }
    document.addEventListener('click', intercept, true)
    const initial = parseStudyLink(window.location.href, window.location.origin)
    let offInitial = () => {}
    if (initial) {
      const openInitial = () => {
        if (!host.sessions.list.getSnapshot().byId[initial.sessionId]) return
        offInitial(); openLink(initial)
        const url = new URL(window.location.href); url.searchParams.delete('webnovel'); window.history.replaceState(null, '', url)
      }
      offInitial = host.sessions.list.subscribe(openInitial)
      openInitial()
    }
    return () => { offInitial(); document.removeEventListener('click', intercept, true) }
  }, 'webnovel: conversation document links')
  host.slots.inject('sidebar.workspaces.directoryFlow', () => {
    const original = host.slots.entries('sidebar.workspaces')[0]
    if (!original) return
    const NativeWorkspaces = original.component
    const offRegion = host.slots.register({ name: 'sidebar.workspaces', priority: -40, children: { 'webnovel.workspaces': { kind: 'single', scope: 'root' } }, inject: () => ({ host, store, openIndex }) }, WorkspaceStudyTabs)
    const nativeOptions = (entry: NativeEntry) => ({ ...(entry.store ? { store: entry.store } : {}), ...(entry.locale ? { locale: entry.locale } : {}), ...(entry.inject ? { inject: entry.inject } : {}) })
    const offNative = host.slots.register({ name: 'webnovel.workspaces', ...nativeOptions(original), children: { 'webnovel.directoryFlow': { kind: 'single', scope: 'root' } } }, (props: WorkspaceProps) => <NativeWorkspaces {...props} renderSlot={(_key, owner, options) => props.renderSlot('webnovel.directoryFlow', owner, options)} />)
    let offFlow: (() => void) | undefined
    let previous: NativeEntry | undefined
    const syncFlow = () => {
      const flow = host.slots.entries('sidebar.workspaces.directoryFlow')[0]
      if (flow === previous) return
      offFlow?.(); offFlow = undefined; previous = flow
      if (flow) offFlow = host.slots.register({ name: 'webnovel.directoryFlow', ...nativeOptions(flow) }, flow.component)
    }
    const offSubscribe = host.slots.subscribe('sidebar.workspaces.directoryFlow', syncFlow)
    syncFlow()
    return () => { offSubscribe(); offFlow?.(); offNative(); offRegion() }
  })
  host.inject(['remote.session'], scope => scope.effect(() => {
    const remote = scope.get('remote.session') as NativeOpenService | undefined
    if (!remote || typeof remote.openWorkspacePath !== 'function') return () => {}
    const original = remote.openWorkspacePath
    const descriptor = Object.getOwnPropertyDescriptor(remote, 'openWorkspacePath')
    const intercepted: NativeOpenService['openWorkspacePath'] = async (request, signal) => {
      const id = mainSessionOf(host)
      if (id) {
        try {
          const document = await callStudy<StudyDocument | null>(id, 'resolve', { path: request.path.replace(/#L\d+(?:-L?\d+)?$/, '') }, signal)
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
          if (document) {
            if (mainSessionOf(host) !== id) return { ok: true, value: { opened: false } }
            await store.open(id, document.ref)
            return { ok: true, value: { opened: !store.get(id).error } }
          }
        } catch (error) { if (signal?.aborted) throw error }
      }
      return original.call(remote, request, signal)
    }
    Object.defineProperty(remote, 'openWorkspacePath', { configurable: true, enumerable: true, writable: true, value: intercepted })
    return () => {
      if (remote.openWorkspacePath !== intercepted) return
      if (descriptor) Object.defineProperty(remote, 'openWorkspacePath', descriptor)
      else Reflect.deleteProperty(remote, 'openWorkspacePath')
    }
  }, 'webnovel: native document links'))
}
