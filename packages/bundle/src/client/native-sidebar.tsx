import React, { useEffect } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { mainSessionOf, type ClientHost } from './host'
import { EditorPanel, type EditorActions, type EditorMemory } from './editor'
import { useEditor } from './hooks'
import type { EditorStore } from './store'

export const WRITING_TAB_ID = '@webnovel/bundle/writing'
export const WRITING_TAB_KIND = 'webnovel-writing'

/** Never let a late document response open a tab in a different active session. */
export function revealWriting(host: Pick<ClientHost, 'sessions' | 'sidebarRight'>, sessionId: string): void {
  if (mainSessionOf(host) === sessionId) host.sidebarRight.openTab(WRITING_TAB_KIND)
}

type WritingTabProps = PropsRuntime<'sidebar.right.pane.tab'> & {
  sessionId: string; store: EditorStore; actions: EditorActions; memory: EditorMemory
}

function WritingTab({ sessionId, store, actions, memory, useTabInfo }: WritingTabProps) {
  const { tab } = useTabInfo()
  useEffect(() => {
    const closed = () => store.cancelOpen(sessionId)
    tab.signal.addEventListener('abort', closed, { once: true })
    return () => tab.signal.removeEventListener('abort', closed)
  }, [sessionId, store, tab.signal])
  return <div className="nw-native-writing" role="complementary" aria-label="书稿与资料">
    <EditorPanel sessionId={sessionId} store={store} actions={actions} memory={memory} />
  </div>
}

function WritingTitle({ sessionId, store }: { sessionId: string; store: EditorStore }) {
  const state = useEditor(store, sessionId)
  const dirty = Object.values(state.buffers).some(buffer => buffer.text !== buffer.document.body || buffer.attempt)
  return <span>书稿与资料{dirty ? <span aria-label="未保存修改"> ●</span> : null}</span>
}

export function installWritingSidebar(host: ClientHost, store: EditorStore, actions: EditorActions, memory: EditorMemory): void {
  host.effect(() => host.sidebarRightTabs.register({
    id: WRITING_TAB_ID, kind: WRITING_TAB_KIND, title: () => '书稿与资料',
    guide: [{ id: WRITING_TAB_ID, order: 50, title: () => '书稿与资料', description: () => '阅读、编辑书稿并引用到对话。关闭标签后，未保存内容可重新打开继续编辑。' }],
  }), 'webnovel: native writing tab')
  host.slots.inject('sidebar.right.pane.tab', () => host.slots.register({
    name: 'sidebar.right.pane.tab', key: WRITING_TAB_ID,
    inject: (sessionId: string) => ({ sessionId, store, actions, memory }),
  }, WritingTab))
  host.slots.inject('sidebar.right.pane.tab.title', () => host.slots.register({
    name: 'sidebar.right.pane.tab.title', key: WRITING_TAB_ID,
    inject: (sessionId: string) => ({ sessionId, store }),
  }, WritingTitle))
}
