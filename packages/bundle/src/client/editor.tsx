import * as React from 'react'
import { useEditor } from './hooks'
import type { EditorStore } from './store'
import { FocusEditor } from './editor/FocusEditor'
import { EditorMemory } from './editor/memory'
import type { EditorRequests } from './editor/requests'

export { EditorMemory }
export interface EditorActions {
  quote(sessionId: string, selection: { text: string; line?: number }): void
  close(sessionId: string): void
  openLink(sessionId: string, href: string, source: string): void
}

export function EditorPanel({ sessionId, store, actions, memory, requests, documentKey, embedded = false, plainText = false }: {
  sessionId: string
  store: EditorStore
  actions: EditorActions
  memory: EditorMemory
  requests: EditorRequests
  documentKey?: string
  embedded?: boolean
  plainText?: boolean
}) {
  const state = useEditor(store, sessionId)
  const key = documentKey ?? state.current
  const buffer = key ? state.buffers[key] : undefined
  if (!key || !buffer) return <div className="webnovel nw-panel"><p className="nw-empty">暂无打开的文档</p></div>
  const identity = sessionId + ':' + key
  return <div className="webnovel nw-panel" onPointerDownCapture={() => { if (embedded && state.current !== key) store.update(sessionId, { current: key }) }} onFocusCapture={() => { if (embedded && state.current !== key) store.update(sessionId, { current: key }) }}>
    <FocusEditor key={identity} {...{ identity, buffer, store, sessionId, bufferKey: key, memory, actions, requests, plainText, notice: state.notice }} />
  </div>
}
