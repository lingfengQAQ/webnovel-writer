import * as fs from 'node:fs'
import {
  canonicalizePath, changeIndexState, embeddingRevision, emptyIndexState, indexFailure, onBookCommit,
  readIndexState, syncFinalizedIndex, forgetSceneBoundaries,
  type EmbeddingProvider, type SceneProvider, type IndexAction, type IndexFailure, type IndexNotice, type IndexRetryPolicy, type IndexSyncState,
} from '@webnovel/core'
import { scanBooks } from '../bookshelf'
import { bookGitWatchPaths, bookHead, finalizedChanged } from './git'

export interface IndexBook { readonly root: string; readonly bookId: string; readonly name: string; readonly workspace: string }
export interface IndexView extends IndexSyncState { readonly bookId: string; readonly bookName: string; readonly providerConfigured: boolean; readonly sceneConfigured: boolean }
export interface IndexManagerOptions {
  readonly getProvider: () => EmbeddingProvider | undefined
  readonly getSceneProvider?: () => SceneProvider | undefined
  readonly workspaces?: () => readonly string[]
  readonly notify?: (book: IndexBook, notice: IndexNotice) => boolean | Promise<boolean>
  readonly pollMs?: number
  readonly debounceMs?: number
  readonly maxConcurrent?: number
  readonly retry?: Partial<IndexRetryPolicy>
}
interface TrackedBook {
  book: IndexBook
  watchers: fs.FSWatcher[]
  watched: boolean
  probing?: Promise<void>
  active?: { generation: number; controller: AbortController; promise: Promise<void> }
  timer?: ReturnType<typeof setTimeout>
  lastProvider?: EmbeddingProvider
  lastSceneProvider?: SceneProvider
  providerSeen: boolean
  reschedules: number
  delivering: boolean
  controls?: Promise<void>
  localError?: IndexFailure
  identityError?: IndexFailure
}
const resumable = (state: IndexSyncState) => !state.paused && ['queued', 'scanning', 'scenes', 'embedding', 'retrying', 'paused'].includes(state.phase)

/** Book-owned work survives agent inactivity. Only this plugin's lifetime stops its workers. */
export class BookIndexManager {
  private readonly books = new Map<string, TrackedBook>()
  private readonly workspaces = new Set<string>()
  private readonly interval: ReturnType<typeof setInterval>
  private readonly offCommit: () => void
  private closing = false
  private refreshing: Promise<void> | undefined

  constructor(private readonly options: IndexManagerOptions) {
    this.interval = setInterval(() => { void this.refresh() }, options.pollMs ?? 5000)
    this.interval.unref()
    this.offCommit = onBookCommit(event => {
      const record = this.books.get(canonicalizePath(event.bookRoot))
      if (record) void this.probe(record, event.sessionId)
      else void this.refresh()
    })
  }

  addWorkspace(workspace: string): void {
    if (!workspace || this.closing) return
    this.workspaces.add(canonicalizePath(workspace))
    void this.refresh()
  }

  private track(book: IndexBook): TrackedBook {
    const root = canonicalizePath(book.root)
    let record = this.books.get(root)
    if (!record) {
      record = { book: { ...book, root }, watchers: [], watched: false, providerSeen: false, reschedules: 0, delivering: false }
      this.books.set(root, record)
    } else record.book = { ...book, root }
    return record
  }

  async refresh(): Promise<void> {
    if (this.closing) return
    if (this.refreshing) return this.refreshing
    const running = (async () => {
      let configured: readonly string[] = []
      try { configured = this.options.workspaces?.() ?? [] } catch { /* Services can be between lifecycle generations. */ }
      const roots = new Set([...this.workspaces, ...configured].filter(Boolean).map(canonicalizePath))
      for (const workspace of roots) {
        for (const book of scanBooks(workspace)) {
          if (book.bookId) this.track({ ...book, bookId: book.bookId, workspace })
        }
      }
      await Promise.allSettled([...this.books.values()].map(record => this.probe(record)))
    })()
    this.refreshing = running
    try { await running } finally { this.refreshing = undefined }
  }

  private async watch(record: TrackedBook): Promise<void> {
    if (record.watched || this.closing) return
    record.watched = true
    for (const directory of await bookGitWatchPaths(record.book.root)) {
      if (this.closing) return
      try {
        const watcher = fs.watch(directory, { recursive: directory.endsWith('refs'), persistent: false }, (_event, filename) => {
          const name = filename?.toString().replaceAll('\\', '/')
          if (directory.endsWith('refs') || !name || /^(HEAD|packed-refs|refs)(\/|$)/.test(name)) {
            this.scheduleProbe(record)
          }
        })
        watcher.on('error', () => { watcher.close() })
        record.watchers.push(watcher)
      } catch { /* Periodic HEAD checks and reopen calibration cover missed events. */ }
    }
  }

  private scheduleProbe(record: TrackedBook): void {
    if (this.closing || record.timer) return
    record.timer = setTimeout(() => { record.timer = undefined; void this.probe(record) }, this.options.debounceMs ?? 250)
    record.timer.unref()
  }

  private provider(): EmbeddingProvider | undefined { return this.options.getProvider() }

  /** Re-read identity at dispatch and publication boundaries, not just discovery. */
  private hasIdentity(record: TrackedBook): boolean {
    const matches = scanBooks(record.book.workspace).filter(book => book.bookId === record.book.bookId)
    if (matches.length === 1 && canonicalizePath(matches[0]!.root) === record.book.root) {
      record.identityError = undefined
      return true
    }
    record.identityError = { code: matches.length > 1 ? 'duplicate-book-id' : 'book-identity-changed', retryable: false,
      message: matches.length > 1 ? `当前工作范围书id「${record.book.bookId}」重复，确认唯一后才能继续索引`
        : '书仓身份已变化或不可读取，确认唯一身份后才能继续索引' }
    record.active?.controller.abort()
    if (record.timer) { clearTimeout(record.timer); record.timer = undefined }
    return false
  }

  private requireIdentity(record: TrackedBook): void {
    if (!this.hasIdentity(record)) throw new Error(record.identityError!.message)
  }

  private async probe(record: TrackedBook, sessionId?: string): Promise<void> {
    if (this.closing || !this.hasIdentity(record)) return
    if (record.probing) return record.probing
    const running = (async () => {
      try {
        let state = readIndexState(record.book.root)
        if (record.active && (state.paused || state.generation !== record.active.generation)) record.active.controller.abort()
        await this.deliver(record)
        if (!state.auto && !resumable(state)) return
        await this.watch(record)
        let provider: EmbeddingProvider | undefined
        try { provider = this.provider() } catch { /* Configuration is reported by the worker. */ }
        const revision = embeddingRevision(provider)
        let sceneProvider: SceneProvider | undefined
        try { sceneProvider = this.options.getSceneProvider?.() } catch { /* Worker reports configuration errors. */ }
        const changedProvider = record.providerSeen && (provider !== record.lastProvider || sceneProvider !== record.lastSceneProvider)
        const sceneRevision = sceneProvider?.metadata.revision
        const changedScene = sceneRevision !== state.sceneRevision
        record.lastSceneProvider = sceneProvider
        record.providerSeen = true
        record.lastProvider = provider
        const head = await bookHead(record.book.root)
        if (this.closing || !this.hasIdentity(record) || state.paused) return
        const changedHead = head !== state.head
        if (state.auto && (changedHead || revision !== state.targetRevision || changedProvider || changedScene)) {
          if (changedHead && state.phase === 'ready' && revision === state.targetRevision && !changedProvider && !changedScene
            && !await finalizedChanged(record.book.root, state.indexedHead, head)) {
            await changeIndexState(record.book.root, latest => {
              this.requireIdentity(record)
              return latest.generation === state.generation ? { ...latest, head, indexedHead: head, updatedAt: Date.now() } : latest
            })
          } else {
            state = await this.enqueue(record, head, revision, sessionId, sceneRevision)
          }
        }
        state = readIndexState(record.book.root)
        // Cache recovery queues its own new generation even when HEAD and model
        // are unchanged. Disabled/paused recoveries remain non-resumable.
        if (resumable(state)) this.scheduleRun(record)
        record.localError = undefined
      } catch (error) {
        record.localError = indexFailure(error)
        this.scheduleProbe(record)
      }
    })()
    record.probing = running
    try { await running } finally { record.probing = undefined }
  }

  private async enqueue(record: TrackedBook, head: string | undefined, revision: string | undefined, sessionId?: string, sceneRevision?: string): Promise<IndexSyncState> {
    record.reschedules = 0
    const next = await changeIndexState(record.book.root, state => {
      this.requireIdentity(record)
      if (!state.auto || state.paused || state.head === head && state.targetRevision === revision && state.sceneRevision === sceneRevision && resumable(state)) return state
      return { ...state, generation: state.generation + 1, phase: 'queued', head, targetRevision: revision, sceneRevision,
        recipientSession: sessionId ?? state.recipientSession, retryAt: undefined, lastError: undefined, notice: undefined, updatedAt: Date.now() }
    })
    if (record.active && record.active.generation !== next.generation) record.active.controller.abort()
    return next
  }

  private scheduleRun(record: TrackedBook, delay = this.options.debounceMs ?? 250): void {
    if (this.closing || record.active || record.timer || record.controls || !this.hasIdentity(record)) return
    record.timer = setTimeout(() => { record.timer = undefined; void this.run(record) }, delay)
    record.timer.unref()
  }

  private async run(record: TrackedBook): Promise<void> {
    if (this.closing || record.active || record.controls || !this.hasIdentity(record)) return
    const activeCount = [...this.books.values()].filter(item => item.active).length
    if (activeCount >= (this.options.maxConcurrent ?? 2)) { this.scheduleRun(record, 500); return }
    let state: IndexSyncState
    try { state = readIndexState(record.book.root) } catch (error) { record.localError = indexFailure(error); return }
    if (!resumable(state)) return
    const controller = new AbortController()
    const generation = state.generation
    const promise = (async () => {
      const result = await syncFinalizedIndex(record.book.root, {
        getProvider: () => { this.requireIdentity(record); return this.provider() }, generation, signal: controller.signal, retry: this.options.retry,
        ...(this.options.getSceneProvider ? { getSceneProvider: () => { this.requireIdentity(record); return this.options.getSceneProvider?.() } } : {}),
      })
      if (result.ok) record.localError = undefined
      if (!result.ok && !this.closing) {
        if (result.failure.code === 'index-busy' || result.failure.code === 'book-busy') {
          // Another instance can finish the same persisted generation for us.
          record.localError = result.failure
        } else if (['source-changed', 'provider-changed'].includes(result.failure.code)) {
          record.reschedules++
          if (record.reschedules > 3) await this.fail(record, generation, { code: 'source-unstable', message: '定稿或配置持续变化，已暂停自动尝试，请稳定后重试', retryable: false })
        } else if (!result.state && result.failure.code !== 'cancelled') {
          await this.fail(record, generation, result.failure)
        }
      }
      await this.deliver(record)
    })().catch(error => { record.localError = indexFailure(error) }).finally(() => {
      record.active = undefined
      if (!this.closing) {
        try { if (resumable(readIndexState(record.book.root))) this.scheduleRun(record, 1000) } catch { /* State error remains visible. */ }
      }
    })
    record.active = { generation, controller, promise }
    await promise
  }

  private async fail(record: TrackedBook, generation: number, failure: IndexFailure): Promise<void> {
    await changeIndexState(record.book.root, state => !this.hasIdentity(record) || state.generation !== generation ? state : ({ ...state, phase: 'failed', lastError: failure,
      updatedAt: Date.now(), notice: { id: `${generation}-${failure.code}`, generation, error: failure, attempts: state.attempt,
        completed: state.completedChunks, total: state.chunks, head: state.head, sessionId: state.recipientSession } }))
  }

  private async deliver(record: TrackedBook): Promise<void> {
    if (record.delivering || this.closing || !this.options.notify || !this.hasIdentity(record)) return
    const notice = readIndexState(record.book.root).notice
    if (!notice || notice.delivered || !notice.sessionId) return
    record.delivering = true
    try {
      const delivered = await this.options.notify(record.book, notice)
      if (delivered) await changeIndexState(record.book.root, state => state.notice?.id === notice.id
        ? { ...state, notice: { ...state.notice, delivered: true, deliveryError: undefined } } : state)
    } catch {
      await changeIndexState(record.book.root, state => state.notice?.id === notice.id
        ? { ...state, notice: { ...state.notice, deliveryError: '主会话暂时不可用，恢复后重试投递' } } : state)
    } finally { record.delivering = false }
  }

  async status(book: IndexBook): Promise<IndexView> {
    const record = this.track(book)
    if (this.hasIdentity(record)) void this.probe(record)
    let state: IndexSyncState
    try { state = readIndexState(record.book.root) } catch (error) { state = { ...emptyIndexState(), phase: 'failed', lastError: indexFailure(error) } }
    let providerConfigured = false
    try { providerConfigured = !!this.provider() } catch { /* Shown as configuration unavailable. */ }
    return { ...state, ...(record.localError && !state.lastError ? { lastError: record.localError } : {}),
      ...(record.identityError ? { phase: 'failed', lastError: record.identityError } as const : {}),
      bookId: book.bookId, bookName: book.name, providerConfigured, sceneConfigured: this.sceneConfigured() }
  }

  private sceneConfigured(): boolean { try { return !!this.options.getSceneProvider?.() } catch { return false } }

  async control(book: IndexBook, action: IndexAction, sessionId: string, chapter?: number): Promise<IndexView> {
    if (!['enable', 'disable', 'update', 'pause', 'resume', 'retry', 'rebuild', 'rescan-scenes'].includes(action)) throw new Error('未知索引操作')
    if (this.closing) throw new Error('索引服务正在关闭，请稍后重试')
    const record = this.track(book)
    this.requireIdentity(record)
    const operation = (record.controls ?? Promise.resolve()).then(() => this.applyControl(record, action, sessionId, chapter))
    const settled = operation.then(() => {}, () => {})
    record.controls = settled
    try { return await operation }
    finally {
      if (record.controls === settled) {
        record.controls = undefined
        try { if (resumable(readIndexState(record.book.root))) this.scheduleRun(record) } catch { /* Reported by the control. */ }
      }
    }
  }

  private async applyControl(record: TrackedBook, action: IndexAction, sessionId: string, chapter?: number): Promise<IndexView> {
    if (this.closing) throw new Error('索引服务正在关闭，请稍后重试')
    this.requireIdentity(record)
    if (record.timer) { clearTimeout(record.timer); record.timer = undefined }
    record.active?.controller.abort()
    // Abort first; wait until its short source snapshot/book lock has been released.
    await record.active?.promise
    this.requireIdentity(record)
    if (record.timer) { clearTimeout(record.timer); record.timer = undefined }
    if (action === 'rescan-scenes') {
      if (!this.sceneConfigured()) throw new Error('请先启用并配置场景识别模型')
      await forgetSceneBoundaries(record.book.root, chapter)
    }
    const head = action === 'pause' || action === 'disable' ? readIndexState(record.book.root).head : await bookHead(record.book.root)
    let revision: string | undefined
    try { revision = embeddingRevision(this.provider()) } catch { /* Worker reports the invalid configuration. */ }
    await changeIndexState(record.book.root, state => {
      this.requireIdentity(record)
      const base = { ...state, generation: state.generation + 1, recipientSession: sessionId, updatedAt: Date.now(), retryAt: undefined, notice: undefined, lastError: undefined }
      if (action === 'pause') return { ...base, paused: true, phase: 'paused' }
      if (action === 'disable') return { ...base, auto: false, paused: false, phase: 'disabled' }
      return { ...base, sceneRevision: this.options.getSceneProvider?.()?.metadata.revision, auto: action === 'enable' ? true : state.auto, paused: false, phase: 'queued', head, targetRevision: revision,
        rebuild: action === 'rebuild' || state.rebuild, generated: 0, failed: 0 }
    })
    record.localError = undefined
    record.reschedules = 0
    if (action !== 'disable' && action !== 'pause') { await this.watch(record); this.scheduleRun(record) }
    return this.status(record.book)
  }

  async close(): Promise<void> {
    this.closing = true
    clearInterval(this.interval)
    this.offCommit()
    for (const record of this.books.values()) {
      if (record.timer) clearTimeout(record.timer)
      for (const watcher of record.watchers) watcher.close()
      record.active?.controller.abort()
    }
    await Promise.allSettled([...this.books.values()].flatMap(record => [record.active?.promise, record.probing, record.controls].filter((item): item is Promise<void> => !!item)))
    this.books.clear()
  }
}
