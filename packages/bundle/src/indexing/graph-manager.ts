import { canonicalizePath, documentHash, withBookLockAsync, type GraphModelProvider } from '@webnovel/core'
import { StudyService } from '../study/service'
import type { StoryGraph } from '../study/graph-types'
import { GRAPH_PROMPT_VERSION, extractionInput, extractionKey, graphIdentityHash, validateExtraction, type GraphExtraction } from '../study/graph-extraction'
import type { IndexBook } from './manager'
import { acquireGraphLease, changeGraphState, graphCacheSignature, readGraphCache, readGraphState, replaceGraphCache, saveGraphCache, writeGraphState, type GraphState } from './graph-storage'

export interface GraphPreview {
  readonly bookId: string
  readonly bookName: string
  readonly token: string
  readonly fingerprint: string
  readonly records: number
  readonly pending: number
  readonly inputChars: number
  readonly provider?: GraphModelProvider['metadata']
  readonly providerIssue?: string
  readonly state: GraphState
  readonly warnings: StoryGraph['warnings']
}
interface Active { controller: AbortController; promise: Promise<void>; fingerprint: string; generation: number }
interface Tracked { book: IndexBook; active?: Active; checking?: Promise<void> }
class GraphInvalidated extends Error { constructor() { super('图谱来源、模型或任务代次已变化') } }
const interrupted = () => new GraphInvalidated()
function boundedCall<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => { signal.removeEventListener('abort', stop); reject(signal.reason || interrupted()) }
    signal.addEventListener('abort', stop, { once: true })
    promise.then(value => { signal.removeEventListener('abort', stop); resolve(value) }, error => { signal.removeEventListener('abort', stop); reject(error) })
    if (signal.aborted) stop()
  })
}

/** Shares book discovery and the polling lifecycle with BookIndexManager, with separate controls and storage. */
export class GraphIndexManager {
  private readonly books = new Map<string, Tracked>()
  private closing = false
  private providerIssue?: string
  constructor(private readonly getProvider: () => GraphModelProvider | undefined) {}
  private provider(): GraphModelProvider | undefined {
    try {
      const provider = this.getProvider()
      if (provider && (!Number.isSafeInteger(provider.metadata.timeoutMs) || provider.metadata.timeoutMs < 100)) {
        this.providerIssue = '图谱模型没有有效的请求超时设置'; return undefined
      }
      this.providerIssue = undefined
      return provider
    } catch { this.providerIssue = '图谱模型暂不可用，请核对 DSH 路由和模型配置'; return undefined }
  }
  track(book: IndexBook): void {
    const root = canonicalizePath(book.root), item = this.books.get(root)
    if (item) item.book = { ...book, root }; else this.books.set(root, { book: { ...book, root } })
  }
  private source(book: IndexBook): StoryGraph {
    const service = new StudyService(book.workspace), actual = service.indexBook('book:' + book.bookId)
    if (canonicalizePath(actual.root) !== canonicalizePath(book.root)) throw new Error('图谱作品身份或位置已变化')
    return service.graphSource('book:' + book.bookId)
  }
  private inputs(graph: StoryGraph) {
    const explicit = new Set(graph.edges.filter(edge => edge.relation).map(edge => edge.evidenceId))
    return (graph.evidence ?? []).filter(source => source.eligible && !explicit.has(source.id))
  }
  preview(book: IndexBook, action = 'update'): GraphPreview {
    const graph = this.source(book), state = readGraphState(book.root, book.bookId), provider = this.provider()
    const cache = readGraphCache(book.root, book.bookId)
    const sources = this.inputs(graph)
    const pending = provider ? sources.filter(source => action === 'rebuild' || !cache.extractions.some(row => row.version === GRAPH_PROMPT_VERSION && row.key === extractionKey(graph, source, provider) && (action !== 'retry' || !row.error))) : sources
    const inputChars = provider ? pending.reduce((sum, source) => sum + provider.inputChars(extractionInput(graph, source)), 0) : 0
    const identity = { bookId: book.bookId, root: canonicalizePath(book.root), fingerprint: graph.fingerprint,
      revision: provider?.metadata.revision, generation: state.generation,
      pending: pending.length, inputChars, action, cacheSignature: graphCacheSignature(book.root) }
    return { bookId: book.bookId, bookName: book.name, token: documentHash(JSON.stringify(identity)), fingerprint: graph.fingerprint!,
      records: sources.length, pending: pending.length, inputChars,
      provider: provider?.metadata, providerIssue: this.providerIssue, state, warnings: graph.warnings }
  }
  async control(book: IndexBook, action: string, token?: string): Promise<GraphState> {
    if (!['build', 'enable', 'update', 'pause', 'resume', 'disable', 'retry', 'rebuild'].includes(action)) throw new Error('未知图谱操作')
    if (this.closing) throw new Error('图谱服务正在关闭')
    this.track(book)
    const tracked = this.books.get(canonicalizePath(book.root))!
    if (action === 'pause' || action === 'disable') {
      this.source(book)
      const state = await changeGraphState(book.root, book.bookId, previous => ({ ...previous,
        enabled: action === 'disable' ? false : previous.enabled, paused: action === 'pause',
        phase: action === 'disable' ? 'disabled' : 'paused', generation: previous.generation + 1, updatedAt: Date.now() }))
      tracked.active?.controller.abort(); return state
    }
    const preview = this.preview(book, action)
    if (token !== preview.token) throw new Error('来源或配置已变化，请重新预览后确认')
    if (action !== 'build' && !preview.provider) throw new Error('请先配置独立的图谱聊天模型')
    const next = await withBookLockAsync(book.root, async () => {
      if (this.preview(book, action).token !== token) throw new Error('来源或配置已变化，请重新预览后确认')
      const graph = this.source(book), previous = readGraphState(book.root, book.bookId)
      if (graph.format && !graph.format.ok && graph.format.kind !== 'unversioned') throw new Error('当前作品格式无法安全解释，未启动图谱任务')
      if (action === 'build') {
        saveGraphCache(book.root, graph)
        const state: GraphState = { ...previous, updatedAt: Date.now(),
          ...(!previous.enabled ? { phase: 'ready', fingerprint: graph.fingerprint } : {}) }
        writeGraphState(book.root, state)
        return state
      }
      const value: GraphState = { ...previous, enabled: true, paused: false,
        phase: 'queued', generation: previous.generation + 1, updatedAt: Date.now(), error: undefined,
        revision: preview.provider?.revision, model: preview.provider?.model }
      if (action === 'rebuild') { replaceGraphCache(book.root, book.bookId); saveGraphCache(book.root, graph) }
      if (action === 'retry') this.retryKeys.delete(book.root)
      writeGraphState(book.root, value); return value
    })
    if (action === 'build') return next
    tracked.active?.controller.abort()
    if (action === 'retry') this.retryKeys.add(book.root)
    void this.refresh()
    return next
  }
  private readonly retryKeys = new Set<string>()
  async refresh(): Promise<void> {
    if (this.closing) return
    for (const tracked of this.books.values()) {
      if (tracked.checking) continue
      const checking = this.check(tracked).catch(() => { /* Read endpoints retain the original failure; never repair from a poll. */ })
      tracked.checking = checking
      try { await checking } finally { tracked.checking = undefined }
    }
  }
  private async check(tracked: Tracked): Promise<void> {
    const { book } = tracked
    let state = readGraphState(book.root, book.bookId)
    if (!state.enabled || state.paused || state.phase === 'model-changed') return
    const provider = this.provider()
    if (!provider) {
      tracked.active?.controller.abort()
      if (state.phase !== 'unconfigured') await changeGraphState(book.root, book.bookId, previous => ({ ...previous, phase: 'unconfigured', error: this.providerIssue, generation: previous.generation + 1, updatedAt: Date.now() }))
      return
    }
    if (state.revision !== provider.metadata.revision) {
      tracked.active?.controller.abort()
      await changeGraphState(book.root, book.bookId, previous => ({ ...previous, phase: 'model-changed', paused: true, generation: previous.generation + 1, updatedAt: Date.now() }))
      return
    }
    const graph = this.source(book)
    if (state.phase === 'failed') {
      if (!state.fingerprint || state.fingerprint === graph.fingerprint) return
      state = await changeGraphState(book.root, book.bookId, previous => ({ ...previous, phase: 'queued', generation: previous.generation + 1, updatedAt: Date.now() }))
    }
    if (tracked.active && tracked.active.fingerprint !== graph.fingerprint) {
      tracked.active.controller.abort()
      state = await changeGraphState(book.root, book.bookId, previous => ({ ...previous, phase: 'queued', generation: previous.generation + 1, updatedAt: Date.now() }))
    }
    if (tracked.active || [...this.books.values()].some(item => item.active)) return
    if (state.fingerprint === graph.fingerprint && state.phase === 'ready') {
      const cache = readGraphCache(book.root, book.bookId)
      if (cache.status === 'ready' && cache.fingerprint === graph.fingerprint && cache.extractions.every(row => row.version === GRAPH_PROMPT_VERSION)) return
      // Only an already-enabled worker may recreate a missing cache. The read API
      // continues to report missing/invalid without creating or repairing files.
    }
    const controller = new AbortController(), generation = state.generation
    const promise = this.run(book, graph, provider, generation, controller.signal)
    tracked.active = { controller, promise, fingerprint: graph.fingerprint!, generation }
    void promise.finally(() => {
      if (tracked.active?.promise === promise) tracked.active = undefined
      try {
        const latest = readGraphState(book.root, book.bookId)
        if (!this.closing && latest.phase === 'queued' && latest.generation !== generation) void this.refresh()
      } catch { /* source or state may have been removed */ }
    })
  }
  private async run(book: IndexBook, graph: StoryGraph, provider: GraphModelProvider, generation: number, signal: AbortSignal): Promise<void> {
    let release: (() => void) | undefined
    const check = () => {
      signal.throwIfAborted()
      const state = readGraphState(book.root, book.bookId)
      if (this.closing || !state.enabled || state.paused || state.generation !== generation || this.provider() !== provider
        || this.source(book).fingerprint !== graph.fingerprint) throw interrupted()
      return state
    }
    const retryLock = async <T>(operation: () => Promise<T>): Promise<T> => {
      const deadline = Date.now() + 10000
      for (;;) {
        signal.throwIfAborted()
        try { return await operation() } catch (error) {
          if (!['book-locked', 'book-busy'].includes(String((error as { code?: unknown }).code)) || Date.now() >= deadline) throw error
          await boundedCall(new Promise<void>(resolve => setTimeout(resolve, 100)), signal)
        }
      }
    }
    const transaction = <T>(operation: () => Promise<T>) => retryLock(() => withBookLockAsync(book.root, operation))
    const publish = (extraction?: GraphExtraction, patch?: Partial<GraphState>) => transaction(async () => {
      const state = check(); saveGraphCache(book.root, graph, extraction)
      writeGraphState(book.root, { ...state, ...patch, updatedAt: Date.now() })
    })
    try {
      release = await retryLock(() => acquireGraphLease(book.root))
      const sources = this.inputs(graph), cache = readGraphCache(book.root, book.bookId), retry = this.retryKeys.delete(book.root)
      if (cache.status === 'invalid') throw new Error(cache.error)
      await publish(undefined, { phase: 'running', total: sources.length, completed: 0 })
      let completed = 0, failures = 0
      for (const evidence of sources) {
        check()
        const key = extractionKey(graph, evidence, provider), input = extractionInput(graph, evidence)
        const cached = cache.extractions.find(row => row.version === GRAPH_PROMPT_VERSION && row.key === key && (!retry || !row.error))
        if (cached) {
          failures += cached.error ? 1 : 0
          await publish({ ...cached, evidenceId: evidence.id, sourceHash: evidence.location.hash, identityHash: graphIdentityHash(graph) }, { completed: ++completed })
          continue
        }
        await transaction(async () => {
          const state = check()
          writeGraphState(book.root, { ...state, calls: state.calls + 1, updatedAt: Date.now() })
        })
        let result: Awaited<ReturnType<GraphModelProvider['extract']>> | undefined, parsed: ReturnType<typeof validateExtraction> | undefined, error: string | undefined
        const active = AbortSignal.any([signal, AbortSignal.timeout(provider.metadata.timeoutMs)])
        try {
          const completedResult = await boundedCall(Promise.resolve().then(() => { active.throwIfAborted(); return provider.extract(input, active) }), active)
          result = completedResult
          parsed = validateExtraction(completedResult.data, input)
        }
        catch (failure) {
          signal.throwIfAborted()
          error = active.aborted || failure instanceof Error && failure.name === 'TimeoutError'
            ? '本条沉淀抽取超时，可显式重试' : '本条沉淀抽取失败，可显式重试'
          failures++
        }
        const state = check()
        await publish({ version: GRAPH_PROMPT_VERSION, key, evidenceId: evidence.id, sourceHash: evidence.location.hash, identityHash: graphIdentityHash(graph),
          revision: provider.metadata.revision, model: provider.metadata.model, relations: parsed?.relations ?? [], rejected: parsed?.rejected ?? 0, error },
        { completed: ++completed, inputTokens: state.inputTokens + (result?.usage?.inputTokens ?? 0), outputTokens: state.outputTokens + (result?.usage?.outputTokens ?? 0) })
      }
      await publish(undefined, { phase: failures ? 'failed' : 'ready', fingerprint: graph.fingerprint, error: failures ? `${failures} 条沉淀未完成，其他结果已保留` : undefined })
    } catch (error) {
      if (error instanceof Error && error.message === '另一图谱任务正在运行') return
      if (!signal.aborted && !this.closing) {
        try {
          this.source(book)
          const nextProvider = this.provider()
          await changeGraphState(book.root, book.bookId, state => {
            if (state.generation !== generation) return state
            if (error instanceof GraphInvalidated) return { ...state, generation: state.generation + 1,
              phase: !nextProvider ? 'unconfigured' : nextProvider.metadata.revision !== state.revision ? 'model-changed' : 'queued',
              paused: !!nextProvider && nextProvider.metadata.revision !== state.revision, updatedAt: Date.now() }
            return { ...state, phase: 'failed', fingerprint: graph.fingerprint, error: error instanceof Error ? error.message : '图谱任务未完成', updatedAt: Date.now() }
          })
        } catch { /* Preserve source/control failure; a future explicit action can retry. */ }
      }
    } finally { release?.() }
  }
  async close(): Promise<void> {
    this.closing = true
    for (const item of this.books.values()) item.active?.controller.abort()
    await Promise.allSettled([...this.books.values()].flatMap(item => [item.active?.promise, item.checking].filter((p): p is Promise<void> => !!p)))
    this.books.clear()
  }
}
