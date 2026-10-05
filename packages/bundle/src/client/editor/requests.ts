import type { EditorState, Transaction, TransactionSpec } from '@codemirror/state'
import type { EditorIntent, EditorReply, EditorRequestItem } from '../../study/editor-requests'
import { StudyApiError } from '../api'
import type { FileRef } from '../../study/types'
import {
  adoptedField, collabField, type CollabItem, type EditorSurface, planReply, planStatus, removeItems,
} from './collab'
import type { EditorMemory } from './memory'

export type EditorDecision = 'accepted' | 'rejected' | 'reopened' | 'cancelled' | 'expired'

export interface EditorAsk {
  sessionId: string
  key: string
  identity: string
  requestId: string
  intent: EditorIntent
  instruction?: string
  ref: FileRef
  hash: string
  dirty: boolean
  selection: { text: string; line: number; before: string; after: string }
}

export interface EditorOverlay {
  decision?: EditorDecision
  intent?: EditorIntent
}

interface Watch extends EditorAsk { phase: 'sending' | 'open' | 'settled'; cancelled: boolean }
interface Timer { cancel(): void }
interface DocRef { sessionId: string; key: string }

export interface EditorRequestsOptions {
  call: (sessionId: string, method: string, body?: object) => Promise<unknown>
  memory: EditorMemory
  hasBuffer: (sessionId: string, key: string) => boolean
  visible?: () => boolean
  schedule?: (run: () => Promise<void> | void, delay: number) => Timer
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const VISIBLE_DELAY = 1000
const HIDDEN_DELAY = 3000
/** Terminal rows kept per table. Open polls and undecided suggestions are never dropped to meet it. */
const RETAINED = 128

export function createRequestId(): string {
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  let id = ''
  for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length] ?? 'a'
  return id
}

function failureMessage(error: unknown): string {
  if (error instanceof StudyApiError) {
    if (error.code === 'conflict' || error.message.includes('磁盘版本已变化')) return '先处理磁盘版本冲突'
    return error.message
  }
  return error instanceof Error && error.message ? error.message : '主 Agent 没有收到请求'
}

function isReply(value: unknown): value is EditorReply {
  if (!value || typeof value !== 'object') return false
  const kind = (value as { kind?: unknown }).kind
  return kind === 'replace' || kind === 'insert' || kind === 'comments' || kind === 'none'
}

function itemOf(value: unknown): EditorRequestItem | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as { requestId?: unknown; state?: unknown; reply?: unknown }
  if (typeof record.requestId !== 'string' || typeof record.state !== 'string') return undefined
  const state = record.state
  if (state !== 'queued' && state !== 'working' && state !== 'replied' && state !== 'unanswered' && state !== 'cancelled' && state !== 'unknown') return undefined
  const reply = isReply(record.reply) ? record.reply : undefined
  return { requestId: record.requestId, state, ...(reply ? { reply } : {}) }
}

/**
 * Per-session registry and poller. Replies go to the mounted view, or to the cached EditorState
 * when the tab is closed but the buffer remains. A discarded buffer is reported as expired.
 */
export class EditorRequests {
  private readonly call: EditorRequestsOptions['call']
  private readonly memory: EditorMemory
  private readonly hasBuffer: EditorRequestsOptions['hasBuffer']
  private readonly visible: () => boolean
  private readonly schedule: NonNullable<EditorRequestsOptions['schedule']>
  private readonly watches = new Map<string, Watch>()
  private readonly surfaces = new Map<string, EditorSurface>()
  private readonly docs = new Map<string, DocRef>()
  private readonly submitted = new Map<string, Set<string>>()
  private readonly committedOps = new Set<string>()
  private readonly base = new Map<string, 'accepted' | 'rejected' | 'cancelled' | 'expired'>()
  private readonly shown = new Map<string, EditorDecision>()
  private readonly notes = new Map<string, string[]>()
  private readonly listeners = new Set<() => void>()
  private timer: Timer | undefined
  private stopped = false
  private readonly onVisibility = () => { this.timer?.cancel(); this.timer = undefined; this.arm() }

  constructor(options: EditorRequestsOptions) {
    this.call = options.call
    this.memory = options.memory
    this.hasBuffer = options.hasBuffer
    this.visible = options.visible ?? (() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
    this.schedule = options.schedule ?? ((run, delay) => {
      const timer = setTimeout(() => { void run() }, delay)
      return { cancel: () => clearTimeout(timer) }
    })
    if (typeof document !== 'undefined' && !options.schedule) document.addEventListener('visibilitychange', this.onVisibility)
  }

  mount(sessionId: string, key: string, identity: string, surface: EditorSurface): void {
    this.docs.set(identity, { sessionId, key })
    this.surfaces.set(identity, surface)
    this.prune()
  }

  unmount(identity: string): void {
    const surface = this.surfaces.get(identity)
    if (!surface) return
    for (const [key, value] of this.surfaces) if (value === surface) this.surfaces.delete(key)
    this.prune()
  }

  /** A save that creates a new draft keeps the open view and its requests on the new identity. */
  retarget(sessionId: string, fromKey: string, toKey: string): void {
    const from = sessionId + ':' + fromKey
    const to = sessionId + ':' + toKey
    if (from === to) return
    const surface = this.surfaces.get(from)
    if (surface) this.surfaces.set(to, surface)
    const doc = this.docs.get(from)
    if (doc) this.docs.set(to, { sessionId, key: toKey })
    const sent = this.submitted.get(from)
    if (sent) {
      const next = this.submitted.get(to) ?? new Set<string>()
      for (const id of sent) next.add(id)
      this.submitted.set(to, next)
      this.submitted.delete(from)
    }
    for (const watch of this.watches.values()) {
      if (watch.identity === from) {
        watch.identity = to
        watch.key = toKey
      }
    }
    this.prune()
  }

  /** Dispatch into the mounted view, or into the cached state when the tab is closed. */
  paint(sessionId: string, key: string, identity: string, spec: TransactionSpec): void {
    this.write({ sessionId, key, identity }, spec)
  }

  async submit(ask: EditorAsk): Promise<{ ok: true; busy: boolean } | { ok: false; message: string }> {
    if (this.stopped) return { ok: false, message: '编辑器已关闭' }
    const watch: Watch = { ...ask, phase: 'sending', cancelled: false }
    this.watches.set(ask.requestId, watch)
    this.docs.set(ask.identity, { sessionId: ask.sessionId, key: ask.key })
    this.prune()
    try {
      const value = await this.call(ask.sessionId, 'ask', {
        requestId: ask.requestId,
        intent: ask.intent,
        ...(ask.instruction ? { instruction: ask.instruction } : {}),
        ref: ask.ref,
        hash: ask.hash,
        dirty: ask.dirty,
        selection: ask.selection,
      })
      const busy = !!value && typeof value === 'object' && (value as { busy?: unknown }).busy === true
      if (watch.cancelled) {
        this.settle(watch.requestId)
        await this.sendCancel(watch.sessionId, [watch])
        return { ok: true, busy }
      }
      watch.phase = 'open'
      const current = this.read(watch)
      const effect = current ? planStatus(current, watch.requestId, busy ? 'queued' : 'working') : undefined
      if (effect) this.write(watch, { effects: effect })
      this.arm()
      return { ok: true, busy }
    } catch (error) {
      this.write(watch, { effects: removeItems.of([watch.requestId]) })
      this.settle(watch.requestId)
      const message = failureMessage(error)
      if (!watch.cancelled && !this.stopped) this.notify(watch.identity, message)
      return { ok: false, message }
    }
  }

  async cancel(sessionId: string, requestIds: readonly string[]): Promise<void> {
    const open: Watch[] = []
    for (const id of requestIds) {
      const watch = this.watches.get(id)
      if (!watch || watch.sessionId !== sessionId || watch.phase === 'settled' || watch.cancelled) continue
      watch.cancelled = true
      this.write(watch, { effects: removeItems.of([id]) })
      // Keep sending rows until ask acknowledges the id, then send cancellation exactly once.
      if (watch.phase === 'open') { open.push(watch); this.settle(id) }
      this.record(id, 'cancelled')
    }
    await this.sendCancel(sessionId, open)
  }

  private async sendCancel(sessionId: string, open: readonly Watch[]): Promise<void> {
    if (!open.length) return
    try {
      await this.call(sessionId, 'ask-cancel', { requestIds: open.map(watch => watch.requestId) })
    } catch (error) {
      const identity = open[0]?.identity
      if (identity && !this.stopped) this.notify(identity, failureMessage(error))
    }
  }

  /** Buffer dropped: cancel sending and open requests so late responses cannot revive them. */
  discard(sessionId: string, key: string): void {
    const ids = [...this.watches.values()].filter(watch => watch.phase !== 'settled' && watch.sessionId === sessionId && watch.key === key).map(watch => watch.requestId)
    if (ids.length) void this.cancel(sessionId, ids)
  }

  expire(requestId: string): void {
    this.record(requestId, 'expired')
  }

  record(requestId: string, decision: 'accepted' | 'rejected' | 'cancelled' | 'expired'): void {
    this.base.set(requestId, decision)
    this.shown.set(requestId, decision)
    this.prune()
    this.emit()
  }

  /** Undo put a decided suggestion back. An accepted id leaves the set that the next save will send. */
  reopen(identity: string, requestId: string): void {
    this.submitted.get(identity)?.delete(requestId)
    const base = this.base.get(requestId)
    if (base === 'accepted') this.shown.set(requestId, 'reopened')
    else if (base === 'rejected') this.shown.delete(requestId)
    this.emit()
  }

  /** Redo applied the original accept or reject again. */
  replay(requestId: string): void {
    const base = this.base.get(requestId)
    if (!base) return
    this.shown.set(requestId, base)
    this.emit()
  }

  meta(requestId: string): { intent: EditorIntent; instruction?: string } | undefined {
    const watch = this.watches.get(requestId)
    if (!watch) return undefined
    return { intent: watch.intent, ...(watch.instruction ? { instruction: watch.instruction } : {}) }
  }

  unsent(identity: string, state: EditorState): readonly string[] {
    const sent = this.submitted.get(identity)
    return (state.field(adoptedField, false) ?? []).filter(id => !sent?.has(id))
  }

  /** First successful save for this operation keeps the list. Undo of an accept releases that id for a later save. */
  commit(identity: string, operationId: string, ids: readonly string[]): void {
    if (this.committedOps.has(operationId)) return
    this.committedOps.add(operationId)
    this.prune()
    if (!ids.length) return
    const set = this.submitted.get(identity) ?? new Set<string>()
    for (const id of ids) set.add(id)
    this.submitted.set(identity, set)
  }

  overlay(requestId: string): EditorOverlay | undefined {
    const decision = this.shown.get(requestId)
    const intent = this.watches.get(requestId)?.intent
    if (!decision && !intent) return undefined
    return { ...(decision ? { decision } : {}), ...(intent ? { intent } : {}) }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  pull(identity: string): readonly string[] {
    const queued = this.notes.get(identity) ?? []
    this.notes.delete(identity)
    return queued
  }

  dispose(): void {
    this.stopped = true
    this.timer?.cancel()
    this.timer = undefined
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility)
    this.listeners.clear()
    const sessions = new Set([...this.watches.values()].map(watch => watch.sessionId))
    for (const sessionId of sessions) {
      const ids = [...this.watches.values()].filter(watch => watch.sessionId === sessionId && watch.phase !== 'settled').map(watch => watch.requestId)
      void this.cancel(sessionId, ids)
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private notify(identity: string, text: string): void {
    const queued = this.notes.get(identity) ?? []
    queued.push(text)
    this.notes.set(identity, queued)
    this.emit()
  }

  private settle(requestId: string): void {
    const watch = this.watches.get(requestId)
    if (watch) watch.phase = 'settled'
    this.prune()
  }

  /** Drop the oldest finished rows once a table passes the cap. Polling and undecided items stay. */
  private prune(): void {
    const live = this.liveRequestIds()
    this.dropOldest(this.watches, (id, watch) => watch.phase !== 'settled' || live.has(id))
    const polling = (id: string) => live.has(id) || this.watches.get(id)?.phase === 'open' || this.watches.get(id)?.phase === 'sending'
    this.dropOldest(this.base, polling)
    this.dropOldest(this.shown, polling)
    this.dropOldest(this.docs, identity => this.docHeld(identity, live))
    this.dropOldestSet(this.committedOps)
  }

  private liveRequestIds(): Set<string> {
    const ids = new Set<string>()
    const seen = new Set<EditorState>()
    const take = (state: EditorState | undefined) => {
      if (!state || seen.has(state)) return
      seen.add(state)
      const items = state.field(collabField, false)
      if (!items) return
      for (const item of items) if (item.kind === 'pending' || item.kind === 'suggestion' || item.kind === 'ghost') ids.add(item.id)
    }
    for (const surface of this.surfaces.values()) take(surface.state)
    for (const identity of this.docs.keys()) take(this.memory.get(identity))
    for (const watch of this.watches.values()) take(this.memory.get(watch.identity))
    return ids
  }

  private docHeld(identity: string, live: ReadonlySet<string>): boolean {
    if (this.surfaces.has(identity)) return true
    for (const watch of this.watches.values()) {
      if (watch.identity === identity && (watch.phase !== 'settled' || live.has(watch.requestId))) return true
    }
    const cached = this.memory.get(identity)
    const items: readonly CollabItem[] | undefined = cached?.field(collabField, false)
    return !!items?.some(item => (item.kind === 'pending' || item.kind === 'suggestion' || item.kind === 'ghost') && live.has(item.id))
  }

  private dropOldest<T>(map: Map<string, T>, hold: (id: string, value: T) => boolean): void {
    if (map.size <= RETAINED) return
    for (const [id, value] of map) {
      if (map.size <= RETAINED) return
      if (hold(id, value)) continue
      map.delete(id)
    }
  }

  private dropOldestSet(ids: Set<string>): void {
    if (ids.size <= RETAINED) return
    for (const id of ids) {
      if (ids.size <= RETAINED) return
      ids.delete(id)
    }
  }

  private openIds(sessionId: string): string[] {
    const ids: string[] = []
    for (const watch of this.watches.values()) if (watch.phase === 'open' && watch.sessionId === sessionId) ids.push(watch.requestId)
    return ids
  }

  private arm(): void {
    if (this.stopped || this.timer) return
    if (![...this.watches.values()].some(watch => watch.phase === 'open')) return
    const delay = this.visible() ? VISIBLE_DELAY : HIDDEN_DELAY
    this.timer = this.schedule(async () => {
      this.timer = undefined
      await this.poll()
    }, delay)
  }

  private async poll(): Promise<void> {
    const sessions = new Set<string>()
    for (const watch of this.watches.values()) if (watch.phase === 'open') sessions.add(watch.sessionId)
    await Promise.all([...sessions].map(async sessionId => {
      const requestIds = this.openIds(sessionId)
      if (!requestIds.length) return
      try {
        const value = await this.call(sessionId, 'suggestions', { requestIds })
        const items = value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)
          ? (value as { items: unknown[] }).items.flatMap(item => {
            const parsed = itemOf(item)
            return parsed ? [parsed] : []
          })
          : []
        for (const item of items) this.ingest(sessionId, item)
      } catch { /* the next tick retries; a blip does not drop the request */ }
    }))
    this.arm()
  }

  private ingest(sessionId: string, item: EditorRequestItem): void {
    const watch = this.watches.get(item.requestId)
    if (!watch || watch.phase !== 'open' || watch.sessionId !== sessionId) return
    if (item.state === 'queued' || item.state === 'working') {
      const current = this.read(watch)
      const effect = current ? planStatus(current, item.requestId, item.state) : undefined
      if (effect) this.write(watch, { effects: effect })
      return
    }
    if (item.state === 'replied' && item.reply) {
      const current = this.read(watch)
      if (!current) {
        if (!this.hasBuffer(watch.sessionId, watch.key)) this.record(item.requestId, 'expired')
        this.settle(item.requestId)
        return
      }
      const plan = planReply(current, item.requestId, item.reply)
      const placed = plan.effects.length ? this.write(watch, { effects: plan.effects }) : this.place(watch)
      if (placed === 'dropped' || plan.status === 'expired') this.record(item.requestId, 'expired')
      else if (plan.message) this.notify(watch.identity, plan.message)
      this.settle(item.requestId)
      return
    }
    if (item.state === 'unanswered') {
      this.write(watch, { effects: removeItems.of([item.requestId]) })
      this.notify(watch.identity, '主 Agent 没有交回修改，见对话')
      this.settle(item.requestId)
      return
    }
    if (item.state === 'cancelled') {
      this.write(watch, { effects: removeItems.of([item.requestId]) })
      this.record(item.requestId, 'cancelled')
      this.settle(item.requestId)
      return
    }
    if (item.state === 'unknown') {
      this.write(watch, { effects: removeItems.of([item.requestId]) })
      this.record(item.requestId, 'expired')
      this.notify(watch.identity, '请求已失效，请重新发起')
      this.settle(item.requestId)
    }
  }

  private read(watch: Watch): EditorState | undefined {
    const surface = this.surfaces.get(watch.identity)
    if (surface) return surface.state
    if (!this.hasBuffer(watch.sessionId, watch.key)) return undefined
    return this.memory.get(watch.identity)
  }

  private place(watch: Watch): 'view' | 'cache' | 'dropped' {
    if (this.surfaces.has(watch.identity)) return 'view'
    if (!this.hasBuffer(watch.sessionId, watch.key) || !this.memory.get(watch.identity)) return 'dropped'
    return 'cache'
  }

  private write(target: { identity: string; sessionId: string; key: string }, spec: TransactionSpec): 'view' | 'cache' | 'dropped' {
    const surface = this.surfaces.get(target.identity)
    if (surface) {
      surface.dispatch(spec)
      return 'view'
    }
    if (!this.hasBuffer(target.sessionId, target.key)) return 'dropped'
    const cached = this.memory.get(target.identity)
    if (!cached) return 'dropped'
    this.memory.set(target.identity, cached.update(spec).state)
    return 'cache'
  }
}

export function createEditorRequests(options: EditorRequestsOptions): EditorRequests {
  return new EditorRequests(options)
}

let bound: EditorRequests | undefined

export function bindEditorRequests(client: EditorRequests | undefined): void {
  bound = client
}

export function editorLiveOverlay(requestId: string): EditorOverlay | undefined {
  return bound?.overlay(requestId)
}

export function subscribeEditorOverlay(listener: () => void): () => void {
  return bound?.subscribe(listener) ?? (() => {})
}
