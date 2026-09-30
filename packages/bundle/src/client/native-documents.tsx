import React, { useEffect, useState, type ComponentType } from 'react'
import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-workspace-files/client'
import { parseFileAddress, sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { callStudy } from './api'
import { mainSessionOf, type ClientHost } from './host'
import { useEditor } from './hooks'
import { fileKey, type EditorStore } from './store'
import { EditorPanel, type EditorActions, type EditorMemory } from './editor'
import type { StudyDocument } from '../study/types'

const BODY_SLOT = 'sidebar.right.tab.document'
const RENDERERS = ['@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown', '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text']

type TitleProps = PropsRuntime<'sidebar.right.pane.tab.title'>
function WritingFileTitle({ props, Native, store }: { props: TitleProps; Native: ComponentType<TitleProps>; store: EditorStore }) {
  const { tab } = props.useTabInfo()
  const address = parseFileAddress(tab.contentId)
  const id = address?.scope === 'session' ? address.sessionId : ''
  const state = useEditor(store, id)
  const path = address?.path.replace(/\\/g, '/')
  const buffer = Object.values(state.buffers).find(item => item.document.absolutePath.replace(/\\/g, '/') === path)
  const dirty = buffer && (buffer.text !== buffer.document.body || buffer.attempt)
  return <><Native {...props} />{dirty ? <span aria-label="未保存修改" title="未保存修改；关闭标签后重新打开可继续"> ●</span> : null}</>
}

export function openWritingDocument(host: ClientHost, store: EditorStore, sessionId: string): void {
  if (mainSessionOf(host) !== sessionId) return
  const state = store.get(sessionId), document = state.current ? state.buffers[state.current]?.document : undefined
  if (!document) { window.dispatchEvent(new Event('webnovel:show-study')); return }
  const address = sessionFileAddress(sessionId, document.absolutePath)
  if (host.sidebarRight.mounted.getSnapshot() === sessionId) host.sidebarRight.openResource(address)
  else {
    const off = host.sidebarRight.mounted.subscribe(() => {
      if (mainSessionOf(host) !== sessionId) { off(); return }
      if (host.sidebarRight.mounted.getSnapshot() === sessionId) { off(); host.sidebarRight.openResource(address) }
    })
  }
}

function BookDocument({ nativeProps, Native, host: _host, store, actions, memory, plainText }: {
  nativeProps: DocumentPreviewProps; Native: ComponentType<DocumentPreviewProps>; host: ClientHost
  store: EditorStore; actions: EditorActions; memory: EditorMemory; plainText: boolean
}) {
  const address = parseFileAddress(nativeProps.resourceAddress)
  const sessionId = address?.scope === 'session' ? address.sessionId : ''
  const meta = nativeProps.useResource<'file'>(nativeProps.resourceAddress)
  const { tab } = nativeProps.useTabInfo()
  const state = useEditor(store, sessionId)
  const [resolved, setResolved] = useState<{ path: string; document: StudyDocument | null }> ()
  const absolutePath = meta.value?.absolutePath
  const buffered = Object.entries(state.buffers).find(([, buffer]) => buffer.document.absolutePath === absolutePath)
  const key = buffered?.[0]
  const saving = buffered?.[1].saving, attempt = buffered?.[1].attempt
  useEffect(() => {
    if (!absolutePath || !sessionId || saving || attempt) return
    let live = true
    const abort = new AbortController()
    const expected = Object.values(store.get(sessionId).buffers).find(buffer => buffer.document.absolutePath === absolutePath)?.document
    void callStudy<StudyDocument | null>(sessionId, 'resolve', { path: absolutePath }, abort.signal).then(document => {
      if (!live) return
      if (document) {
        const current = store.get(sessionId).buffers[fileKey(document.ref)]
        if (!current || current.document === expected) store.receive(sessionId, document)
      }
      setResolved({ path: absolutePath, document })
    }, () => { if (live) setResolved({ path: absolutePath, document: null }) })
    return () => { live = false; abort.abort() }
  }, [absolutePath, meta.value?.version, nativeProps.content, sessionId, state.refresh, saving, attempt, store])
  useEffect(() => store.onMove((id, previous, next) => {
    if (id === sessionId && previous.absolutePath === absolutePath) {
      tab.actions.openResource(sessionFileAddress(id, next.absolutePath), { replaceTab: true })
    }
  }), [store, sessionId, absolutePath, tab.actions])
  const document = resolved && resolved.path === absolutePath ? resolved.document : undefined
  const selectedKey = key ?? (document ? fileKey(document.ref) : undefined)
  useEffect(() => {
    if (selectedKey && tab.visible && state.current !== selectedKey) store.update(sessionId, { current: selectedKey })
  }, [selectedKey, tab.visible, store, sessionId])
  useEffect(() => {
    if (document && sessionFileAddress(sessionId, document.absolutePath) !== nativeProps.resourceAddress) {
      tab.actions.openResource(sessionFileAddress(sessionId, document.absolutePath), { replaceTab: true })
    }
  }, [document?.absolutePath, sessionId, nativeProps.resourceAddress, tab.actions])
  if (!selectedKey || !state.buffers[selectedKey]) return <Native {...nativeProps} />
  return <EditorPanel {...{ sessionId, store, actions, memory, plainText }} documentKey={selectedKey} embedded />
}

/** Extend the native document body; native file identity, tabs, icons and refresh remain the owner. */
export function installNativeDocuments(host: ClientHost, store: EditorStore, actions: EditorActions, memory: EditorMemory): void {
  host.slots.inject('sidebar.right.pane.tab.title', () => {
    const key = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview'
    const original = host.slots.entries('sidebar.right.pane.tab.title').find(entry => entry.options?.key === key)
    if (!original) return
    const Native = original.component as unknown as ComponentType<TitleProps>
    return host.slots.register({ name: 'sidebar.right.pane.tab.title', key, priority: -40,
      ...(original.locale ? { locale: original.locale } : {}), ...(original.store ? { store: original.store } : {}),
      ...(original.inject ? { inject: original.inject } : {}),
    }, (props: TitleProps) => <WritingFileTitle {...{ props, Native, store }} />)
  })
  host.effect(() => {
    let live = true, queued = false
    const retire = () => {
      if (queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        if (!live) return
        const id = host.sidebarRight.mounted.getSnapshot()
        for (const tab of host.sidebarRight.openTabs.getSnapshot()) {
          if (tab.sessionId === id && tab.kind === 'webnovel-writing') host.sidebarRight.close(tab.tabId)
        }
      })
    }
    const offTabs = host.sidebarRight.openTabs.subscribe(retire)
    const offMounted = host.sidebarRight.mounted.subscribe(retire)
    retire()
    return () => { live = false; offTabs(); offMounted() }
  }, 'webnovel: retire legacy page tabs')
  host.slots.inject(BODY_SLOT, () => {
    const offs: (() => void)[] = []
    for (const key of RENDERERS) {
      const original = host.slots.entries(BODY_SLOT).find(entry => entry.options?.key === key)
      if (!original) continue
      const Native = original.component as unknown as ComponentType<DocumentPreviewProps>
      offs.push(host.slots.register({ name: BODY_SLOT, key, priority: -40,
        ...(original.locale ? { locale: original.locale } : {}),
        ...(original.inject ? { inject: original.inject } : {}),
        ...(original.store ? { store: original.store } : {}),
      }, (props: DocumentPreviewProps) => <BookDocument nativeProps={props} plainText={key.endsWith('/text')} {...{ Native, host, store, actions, memory }} />))
    }
    return () => { for (const off of offs.reverse()) off() }
  })
}
