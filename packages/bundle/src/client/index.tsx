import React from 'react'
import { BookOpen } from 'lucide-react'
import type { ClientHost, NativeOpenService } from './host'
import type { StudyDocument } from '../study/types'
import { callStudy } from './api'
import { installWorkspaceStudyTabs } from './workspace-slots'
import { VisualView } from './visualization'
import visualizationStyles from './visualization.css'
import workflowArtworkStyles from './workflow-artwork.css'
import { type EditorActions, EditorMemory } from './editor'
import editorStyles from './editor/editor.css'
import layoutSwapStyles from './layout-swap.css'
import { SwapHandle } from './layout-swap-handle'
import { useSession } from './hooks'
import { mainSessionOf } from './host'
import { installNativeDocuments, openWritingDocument } from './native-documents'
import { createEditorStore, fileKey } from './store'
import { bindEditorRequests, createEditorRequests } from './editor/requests'
import { documentQuote } from './quote'
import { parseStudyLink, studyFileLink } from '../study/links'
import styles from './styles.css'
import indexStyles from './indexing.css'
import { installIndexSidebar } from './indexing'
import { installNovelToolCards } from './tool-result-card'
import resultStyles from './tool-result.css'

export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs', 'conversation', 'sessions', 'uiWorkspace', 'remote', 'remote.workspaceFiles']

export function apply(host: ClientHost) {
  installNovelToolCards(host)
  const store = createEditorStore(id => openWritingDocument(host, store, id))
  const openIndex = installIndexSidebar(host)
  const memory = new EditorMemory()
  const requests = createEditorRequests({
    call: callStudy,
    memory,
    hasBuffer: (sessionId, key) => !!store.get(sessionId).buffers[key],
  })
  bindEditorRequests(requests)
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
    quote: (id, selection) => {
      if (mainSessionOf(host) !== id) return
      const state = store.get(id)
      const buffer = state.current ? state.buffers[state.current] : undefined
      const scope = host.sessions.scope(id)
      if (!buffer || !scope || !selection.text.trim()) return
      const input = host.conversation.input.for(scope)
      const previous = input.state.getSnapshot().draft
      input.setDraft(previous + (previous && !previous.endsWith('\n\n') ? '\n\n' : '') + documentQuote(buffer.document, buffer.text, selection.text, selection.line)
        + '\n[在书房打开原文](<' + studyFileLink(buffer.document.absolutePath) + '>)\n')
      store.update(id, { selection: '', notice: '已放进对话输入框，等你发送' })
      window.getSelection()?.removeAllRanges()
      if (window.innerWidth < 1024) actions.close(id)
    },
  }
  host.effect(() => {
    const style = document.createElement('style')
    style.dataset.webnovel = ''
    style.textContent = styles + '\n' + indexStyles + '\n' + visualizationStyles + '\n' + workflowArtworkStyles + '\n' + resultStyles + '\n' + editorStyles + '\n' + layoutSwapStyles
    document.head.append(style)
    const offMove = store.onMove((id, previous, next) => {
      memory.move(id, previous, next)
      requests.retarget(id, fileKey(previous.ref), fileKey(next.ref))
    })
    const offDiscard = store.onDiscard((id, key) => {
      memory.delete(id + ':' + key)
      requests.discard(id, key)
    })
    const preventLoss = (event: BeforeUnloadEvent) => { if (store.hasUnsaved()) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', preventLoss)
    return () => {
      offMove(); offDiscard(); window.removeEventListener('beforeunload', preventLoss)
      requests.dispose(); bindEditorRequests(undefined); store.dispose(); memory.clear(); style.remove()
    }
  }, 'webnovel: client lifetime')
  host.slots.inject('shell.overlay', () => host.slots.register({ name: 'shell.overlay', id: 'webnovel-layout-swap' }, SwapHandle))
  host.slots.inject('conversation.input.right', () => host.slots.register({ name: 'conversation.input.right', id: 'webnovel-open', order: 50 }, () => {
    const id = useSession(host)
    return <button type="button" className="webnovel nw-launch" disabled={!id} title="打开书稿与资料" aria-label="打开书稿与资料" onClick={() => { if (id) openWritingDocument(host, store, id) }}><BookOpen size={17} /><span>书稿</span></button>
  }))
  host.slots.inject('conversation.view', () => host.slots.register({ name: 'conversation.view', id: 'webnovel-visual', label: '可视化', order: 30, inject: () => ({ host, store, openIndex }) }, VisualView))
  installNativeDocuments(host, store, actions, memory, requests)
  host.effect(() => {
    const openLink = (link: NonNullable<ReturnType<typeof parseStudyLink>>) => {
      if (mainSessionOf(host) !== link.sessionId) host.uiWorkspace.openSession(link.sessionId)
      void store.open(link.sessionId, link.ref)
    }
    const intercept = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      const link = anchor ? parseStudyLink(anchor.getAttribute('href')!, window.location.href) : undefined
      if (!link) return
      event.preventDefault(); event.stopPropagation(); openLink(link)
    }
    document.addEventListener('click', intercept, true)
    const initial = parseStudyLink(window.location.href, window.location.href)
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
  installWorkspaceStudyTabs({ host, store, openIndex })
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
