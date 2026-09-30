import type { ISessions, SessionBinding, SessionEventLikeEntry, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { UiSession } from '@deepseek-ai/dsh-client-ui-session/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { CompanionStore } from './state'

export interface SessionHost { sessions: ISessions; uiSession: Pick<UiSession, 'sessionStatus'>; connection: Pick<ConnectionHandle, 'generation'> }

/** Subscribe to existing main-view ownership; never retain, start or control an Agent. */
export function watchSession(host: SessionHost, store: CompanionStore): () => void {
  let binding: SessionBinding | undefined
  let stops: (() => void)[] = []
  let disposed = false
  let textSeen = false
  let terminal = false
  let currentTurn: number | undefined
  let revision = -1
  let generation = host.connection.generation.getSnapshot()
  const clear = () => { for (const stop of stops) stop(); stops = []; binding = undefined }

  const sync = () => {
    if (disposed) return
    if (!host.connection.generation.getSnapshot()) { store.setActivity('idle', '连接中断，等待恢复'); return }
    if (!binding) { store.setActivity('idle'); return }
    const state = binding.session.getSnapshot()
    const status = host.uiSession.sessionStatus.getSnapshot().get(binding.sessionId)
    if (state.removed || state.openState === 'error') { store.setActivity('idle', '会话暂时不可用'); return }
    if (status?.pendingInteraction) { store.setActivity('waiting'); return }
    if ((status?.running ?? state.running) && !terminal) { store.setActivity(textSeen ? 'writing' : 'thinking'); return }
    store.setActivity('idle', state.lastAgentError ? '这次运行遇到问题' : '陪你写作')
  }
  const consume = (entries: readonly SessionEventLikeEntry[], live: boolean) => {
    let completed = false
    for (const { event } of entries) {
      if (event.type === 'turn/start') { currentTurn = event.data.turn; terminal = false; textSeen = false }
      if (event.type === 'assistant/live-chunk' && !terminal) {
        if (event.data.chunk.type === 'text-delta') textSeen = true
        if (event.data.chunk.type === 'block-start' && event.data.chunk.blockType !== 'text') textSeen = false
      }
      if (event.type === 'turn/end') {
        // A baseline may establish the current turn, but never causes celebration.
        if (currentTurn === undefined || currentTurn === event.data.turn) {
          terminal = true; textSeen = false
          if (live && currentTurn === event.data.turn && event.data.reason.kind === 'completed') completed = true
        }
      }
    }
    sync()
    if (completed && terminal && host.connection.generation.getSnapshot()) store.complete()
  }
  const connect = () => {
    if (disposed) return
    const list = host.sessions.list.getSnapshot()
    const row = (Object.values(list.byId) as SessionSummary[]).find(row => (row.retainedBy.mainView ?? 0) > 0)
    const next = row ? host.sessions.binding(row.id) : undefined
    if (next === binding) { sync(); return }
    clear(); binding = next
    textSeen = false; terminal = false; currentTurn = undefined; revision = -1
    store.reset()
    if (next) {
      const baseline = next.eventSource.getSnapshot()
      revision = baseline.revision; consume(baseline.entries, false)
      // The Host can be running before turn/start has reached this Client.
      if (next.session.getSnapshot().running) terminal = false
      stops.push(next.session.subscribe(sync), next.eventSource.subscribe(() => {
        if (binding !== next || disposed) return
        const window = next.eventSource.getSnapshot()
        if (window.revision === revision) return
        revision = window.revision
        if (window.change.kind === 'replace') {
          textSeen = false; terminal = false; currentTurn = undefined
          store.reset(); consume(window.entries, false)
        } else if (window.change.kind === 'append') consume(window.change.entries, true)
        else sync()
      }))
    }
    sync()
  }
  const offList = host.sessions.list.subscribe(connect)
  const offStatus = host.uiSession.sessionStatus.subscribe(sync)
  const offConnection = host.connection.generation.subscribe(() => {
    const next = host.connection.generation.getSnapshot()
    if (next === generation) return
    generation = next; clear(); store.reset(); connect()
  })
  connect()
  return () => { disposed = true; clear(); offList(); offStatus(); offConnection() }
}
