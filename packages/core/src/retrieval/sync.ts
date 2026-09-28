import { withBookLockAsync } from '../repo/lock'
import { canonicalizePath } from '../gate/canonical'
import { SearchCache } from './cache'
import { digest, readFinalizedBytes, scanFinalized, assertSourceSettled } from './source'
import { embeddingRevision, snapshotInputs, type IndexedEmbeddingInput } from './embedding'
import { normalizedVector } from './vectors'
import { SearchError, type EmbeddingProvider, type SceneProvider, type SearchSnapshot } from './types'
import { syncSceneBoundaries } from './scene-sync'
import { acquireIndexLease, changeIndexState, readIndexState, writeIndexState, type IndexFailure, type IndexSyncState } from './state'
import { DEFAULT_INDEX_RETRY, indexAbortable, indexFailure, retryDelayMs, waitIndexRetry, type IndexRetryPolicy } from './retry'

export interface IndexClock {
  now(): number
  random(): number
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}
export interface SyncIndexOptions {
  readonly getProvider: () => EmbeddingProvider | undefined
  readonly getSceneProvider?: () => SceneProvider | undefined
  readonly generation?: number
  readonly signal?: AbortSignal
  readonly retry?: Partial<IndexRetryPolicy>
  readonly clock?: IndexClock
  readonly onProgress?: (state: IndexSyncState) => void
}
export type SyncIndexResult = { readonly ok: true; readonly state: IndexSyncState }
  | { readonly ok: false; readonly failure: IndexFailure; readonly state?: IndexSyncState }

class IndexRunError extends Error {
  constructor(readonly failure: IndexFailure) { super(failure.message) }
}

/** Batch checkpoints survive cancellation, provider changes and host restarts. */
export async function syncFinalizedIndex(bookRoot: string, options: SyncIndexOptions): Promise<SyncIndexResult> {
  const root = canonicalizePath(bookRoot)
  const signal = options.signal
  const clock: IndexClock = options.clock ?? { now: Date.now, random: Math.random, sleep: waitIndexRetry }
  const policy = { ...DEFAULT_INDEX_RETRY, ...options.retry }
  let generation: number | undefined
  let release: (() => void) | undefined
  let provider: EmbeddingProvider | undefined
  let revision: string | undefined
  const progress = (state: IndexSyncState) => { try { options.onProgress?.(state) } catch { /* A view cannot break indexing. */ } }
  const checkGeneration = () => {
    signal?.throwIfAborted()
    const state = readIndexState(root)
    if (state.generation !== generation || state.paused) throw new SearchError('cancelled', '索引任务已被暂停或替换')
    return state
  }
  const checkProvider = () => {
    checkGeneration()
    const current = options.getProvider()
    if (current !== provider || embeddingRevision(current) !== revision) throw new SearchError('provider-changed', '嵌入配置已变化')
  }
  const update = async (patch: Partial<IndexSyncState>) => {
    const next = await changeIndexState(root, state => {
      if (state.generation !== generation) throw new SearchError('cancelled', '索引任务已被替换')
      return { ...state, ...patch, updatedAt: clock.now() }
    })
    progress(next)
    return next
  }
  try {
    signal?.throwIfAborted()
    const initialState = readIndexState(root)
    generation = options.generation ?? initialState.generation
    checkGeneration()
    release = await acquireIndexLease(root)
    await update({ phase: 'scanning', startedAt: clock.now(), finishedAt: undefined, retryAt: undefined,
      generated: 0, reused: 0, failed: 0, attempt: 0, maxRetries: policy.maxRetries, lastError: undefined, notice: undefined, errors: [] })
    provider = options.getProvider()
    revision = embeddingRevision(provider)
    if (!provider) throw new SearchError('provider-unconfigured', '嵌入提供方未配置')
    const dimensions = provider.metadata.dimensions
    if (!Number.isInteger(dimensions) || dimensions! < 1 || dimensions! > 65_536) throw new SearchError('invalid-embedding', '提供方维数无效')
    if (!provider.embedBatch) throw new SearchError('provider-upgrade-required', '需要支持单次批量调用的提供方')
    if (options.getSceneProvider) await syncSceneBoundaries(root, { getProvider: options.getSceneProvider, check: checkProvider, signal, clock, policy, progress })
    const providerInfo = { name: provider.metadata.provider, model: provider.metadata.model, dimensions: dimensions!, revision: revision! }
    const first = await withBookLockAsync(root, async () => {
      checkProvider()
      const snapshot = await scanFinalized(root, signal)
      const cache = await SearchCache.open(root)
      try {
        // A direct manual sync can adopt its own initial cache recovery. Managed
        // runs keep their assigned generation so the manager cancels/requeues it.
        if (options.generation === undefined && cache.state !== 'ready') generation = readIndexState(root).generation
        checkProvider()
        if (checkGeneration().rebuild) cache.clearEmbeddings()
        const vectors = cache.vectors(snapshot, revision!, dimensions!)
        cache.publish(snapshot, new Map(), undefined, signal)
        const state = checkGeneration()
        writeIndexState(root, { ...state, rebuild: false, provider: providerInfo, updatedAt: clock.now() })
        return { snapshot, vectors }
      } finally { cache.close() }
    })
    const inputs = snapshotInputs(first.snapshot, revision!)
    const completed = new Set(first.vectors.keys())
    const missing = [...inputs.values()].filter(input => !input.chunkIds.every(id => completed.has(id)))
    const total = first.snapshot.documents.reduce((sum, doc) => sum + doc.chunks.length, 0)
    const countChapters = (snapshot: SearchSnapshot) => snapshot.documents.filter(doc => doc.chunks.every(chunk => completed.has(chunk.id))).length
    await update({ provider: providerInfo, chapters: first.snapshot.documents.length, chunks: total,
      completedChunks: completed.size, completedChapters: countChapters(first.snapshot), reused: completed.size, issues: first.snapshot.issues })
    const requestedSize = provider.metadata.batchSize ?? 32
    const batchSize = Number.isInteger(requestedSize) && requestedSize > 0 ? Math.min(requestedSize, 128) : 32
    let generated = 0
    for (let offset = 0; offset < missing.length; offset += batchSize) {
      const batch = missing.slice(offset, offset + batchSize)
      const started = clock.now()
      let vectors: Map<string, Float32Array>
      for (let attempt = 0; ; attempt++) {
        checkProvider()
        await update({ phase: 'embedding', attempt, retryAt: undefined })
        try {
          const result = await indexAbortable(provider.embedBatch(batch.map(input => input.input), 'document', signal), signal)
          if (!Array.isArray(result) || result.length !== batch.length) throw new SearchError('invalid-embedding', '批次数量不匹配')
          vectors = new Map()
          for (let index = 0; index < batch.length; index++) vectors.set(batch[index]!.key, normalizedVector(result[index], dimensions))
          break
        } catch (error) {
          checkProvider()
          const failure = indexFailure(error)
          const delay = retryDelayMs(attempt + 1, policy, failure.retryAfterMs, clock.random)
          const canRetry = failure.retryable && attempt < policy.maxRetries && clock.now() - started + delay < policy.budgetMs
          const state = readIndexState(root)
          await update({ lastError: failure, attempt: attempt + 1,
            errors: [...state.errors, { at: clock.now(), attempt: attempt + 1, error: failure }].slice(-20) })
          if (!canRetry) throw new IndexRunError({ ...failure, message: failure.message + (failure.retryable ? '；自动重试预算已用尽' : '') })
          await update({ phase: 'retrying', retryAt: clock.now() + delay })
          await clock.sleep(delay, signal)
        }
      }
      await withBookLockAsync(root, async () => {
        checkProvider()
        assertSourceSettled(root)
        const documents = new Map(batch.flatMap(input => [...input.documents]))
        for (const document of documents.values()) {
          if (digest(await readFinalizedBytes(root, document.path, signal)) !== document.hash) throw new SearchError('source-changed', '定稿在嵌入期间已变化')
        }
        checkProvider()
        const cache = await SearchCache.open(root)
        try { checkProvider(); cache.saveEmbeddings(batch, vectors, revision!, signal) } finally { cache.close() }
        for (const input of batch) for (const id of input.chunkIds) completed.add(id)
        generated += batch.reduce((sum, input) => sum + input.chunkIds.length, 0)
        const state = checkGeneration()
        const next: IndexSyncState = { ...state, phase: 'embedding', completedChunks: completed.size,
          completedChapters: countChapters(first.snapshot), generated, failed: 0, attempt: 0, retryAt: undefined, lastError: undefined, updatedAt: clock.now() }
        writeIndexState(root, next)
        progress(next)
      })
    }
    const state = await withBookLockAsync(root, async () => {
      checkProvider()
      const snapshot = await scanFinalized(root, signal)
      if (snapshot.fingerprint !== first.snapshot.fingerprint) throw new SearchError('source-changed', '定稿在同步期间已变化')
      if (snapshot.issues.length) throw new SearchError('source-incomplete', '部分定稿来源异常')
      const cache = await SearchCache.open(root)
      try {
        checkProvider()
        cache.publish(snapshot, new Map(), undefined, signal)
        cache.pruneEmbeddings(snapshot, revision!)
      } finally { cache.close() }
      const current = checkGeneration()
      const next: IndexSyncState = { ...current, phase: 'ready', completedChunks: total, completedChapters: snapshot.documents.length,
        indexedHead: current.head, fingerprint: snapshot.fingerprint, finishedAt: clock.now(), updatedAt: clock.now(), retryAt: undefined, lastError: undefined, notice: undefined }
      writeIndexState(root, next)
      return next
    })
    progress(state)
    return { ok: true, state }
  } catch (error) {
    const failure = error instanceof IndexRunError ? error.failure : indexFailure(error)
    const cancelled = signal?.aborted || error instanceof SearchError && error.code === 'cancelled'
    let state: IndexSyncState | undefined
    try {
      if (generation !== undefined && release && readIndexState(root).generation === generation) {
        const previous = readIndexState(root)
        const reschedule = ['source-changed', 'provider-changed', 'book-busy', 'index-busy'].includes(failure.code)
        state = await update({ phase: cancelled ? 'paused' : reschedule ? 'queued' : failure.code === 'provider-unconfigured' ? 'unconfigured' : 'failed',
          retryAt: undefined, finishedAt: clock.now(), lastError: cancelled || reschedule ? undefined : failure,
          failed: cancelled || reschedule ? 0 : Math.max(0, previous.chunks - previous.completedChunks),
          notice: cancelled || reschedule || failure.code === 'provider-unconfigured' ? undefined : { id: digest(JSON.stringify([generation, revision, previous.head, failure])).slice(0, 32),
            generation, error: failure, attempts: previous.attempt, completed: previous.completedChunks, total: previous.chunks,
            head: previous.head, sessionId: previous.recipientSession } })
      }
    } catch { /* Preserve the initiating failure if recording it is also unavailable. */ }
    return { ok: false, failure: cancelled ? { code: 'cancelled', message: '索引任务已取消', retryable: false } : failure, ...(state ? { state } : {}) }
  } finally { release?.() }
}
