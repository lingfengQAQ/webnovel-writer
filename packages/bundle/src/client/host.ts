import type { ComponentType, ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

export interface SessionListRow {
  readonly cwd?: string
  readonly blank?: boolean
  /** DSH 0.1.7 local reference counts; the main session is the row retained by the mainView source. */
  readonly retainedBy?: Readonly<Record<string, number | undefined>>
}

export interface SessionList {
  readonly byId: Record<string, SessionListRow>
}
export type UseSessions = <T>(selector: (state: SessionList) => T) => T
export type RenderSlot = (name: string, owner: object, options?: object) => ReactNode
export interface NativeEntry {
  readonly component: ComponentType<WorkspaceProps>
  readonly store?: unknown
  readonly locale?: string
  readonly inject?: (...args: never[]) => unknown
}
export interface WorkspaceProps {
  readonly wide: boolean
  readonly expandSidebar: () => void
  readonly renderSlot: RenderSlot
  readonly useSessions: UseSessions
}

export interface ClientHost {
  slots: {
    inject(name: string, callback: () => (() => void) | void): unknown
    register<P>(options: { name: string; id?: string; key?: string; label?: string; priority?: number; order?: number; children?: Record<string, { kind: string; scope: string }>; store?: unknown; locale?: string; inject?: (...args: never[]) => unknown }, component: ComponentType<P>): () => void
    entries(name: string): readonly NativeEntry[]
    subscribe(name: string, listener: () => void): () => void
  }
  sidebarRight: Context['sidebarRight']
  sidebarRightTabs: Context['sidebarRightTabs']
  sessions: {
    scope(id: string): object | undefined
    list: { getSnapshot(): SessionList; subscribe(listener: () => void): () => void }
  }
  /** DSH 0.1.7 navigation service: select a session and show its conversation. */
  uiWorkspace: { openSession(target: string): void }
  conversation: { input: { for(scope: object): { state: { getSnapshot(): { draft: string } }; setDraft(text: string): void } } }
  effect(callback: () => (() => void), label?: string): unknown
  inject(names: readonly string[], callback: (context: ClientHost) => unknown): unknown
  get(name: string): unknown
}

export interface NativeOpenService {
  openWorkspacePath(request: { path: string }, signal?: AbortSignal): Promise<unknown>
}

const mainSessionCache = new WeakMap<object, { snapshot: SessionList; id: string | undefined }>()

/**
 * DSH 0.1.7 removed `sessions.list.current` and the `sessions.open` verb: the
 * main session is now the row retained by the mainView source, and navigation
 * belongs to `uiWorkspace.openSession`. This mirrors the rule ui-session itself
 * applies when it projects the main binding. The derived id is cached per list
 * snapshot so useSyncExternalStore keeps seeing one stable value.
 */
export function mainSessionOf(host: Pick<ClientHost, 'sessions'>): string | undefined {
  const list = host.sessions.list
  const snapshot = list.getSnapshot()
  const cached = mainSessionCache.get(list)
  if (cached && cached.snapshot === snapshot) return cached.id
  let id: string | undefined
  for (const [sessionId, row] of Object.entries(snapshot.byId)) {
    if ((row?.retainedBy?.mainView ?? 0) > 0) { id = sessionId; break }
  }
  mainSessionCache.set(list, { snapshot, id })
  return id
}
