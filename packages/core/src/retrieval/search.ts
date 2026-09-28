import * as fs from 'node:fs'
import { withBookLockAsync } from '../repo/lock'
import { annotate } from '../provenance'
import { SearchCache } from './cache'
import { digest, readFinalizedBytes, scanFinalized } from './source'
import { cosine, fuseRanks, normalizedVector } from './vectors'
import { SearchError, type EmbeddingProvider, type FinalizedSearchResult, type SearchDocument, type SearchChunk, type RerankingProvider } from './types'
import { embeddingRevision } from './embedding'
import { readIndexState } from './state'
import { indexFailure } from './retry'
import { rerankTimeoutMs } from './policy'

export interface SearchOptions {
  readonly query: string
  readonly mode?: 'hybrid' | 'keyword'
  readonly rerank?: boolean
  readonly getReranker?: () => RerankingProvider | undefined
  readonly limit?: number
  readonly provider?: EmbeddingProvider
  readonly getProvider?: () => EmbeddingProvider | undefined
  readonly signal?: AbortSignal
}

function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new SearchError('cancelled', '检索已取消')) }
    signal.addEventListener('abort', abort, { once: true })
    operation.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
    if (signal.aborted) abort()
  })
}

/** Derived data only. Both source scans are locked, while all external calls are unlocked. */
export async function searchFinalized(root: string, options: SearchOptions): Promise<FinalizedSearchResult> {
  const signal = options.signal
  try {
    signal?.throwIfAborted()
    const query = typeof options.query === 'string' ? options.query.trim() : ''
    const limit = options.limit ?? 10
    if (options.mode !== undefined && !['hybrid', 'keyword'].includes(options.mode) || options.rerank !== undefined && typeof options.rerank !== 'boolean') throw new SearchError('invalid-query', '检索模式或重排开关无效')
    let reranker: RerankingProvider | undefined
    let rerankReason: string | undefined
    try { if (options.rerank !== false) reranker = options.getReranker?.() } catch { rerankReason = '重排配置不可用，本次使用原排序' }
    const rerankRevision = reranker?.metadata.revision
    const rerankTimeout = rerankTimeoutMs(reranker?.metadata.timeoutMs)
    const requestedCandidates = reranker?.metadata.candidates ?? 40
    const rerankBudget = Number.isInteger(requestedCandidates) ? Math.max(limit, Math.min(200, Math.max(1, requestedCandidates))) : Math.max(limit, 40)
    if (!query || query.length > 256 || query.includes('\0') || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new SearchError('invalid-query', '查询须为 1–256 个字符，返回条数须为 1–50 的整数')
    }
    try {
      if (!fs.statSync(root).isDirectory()) throw new Error('not a directory')
    } catch { throw new SearchError('source-error', '书仓目录不存在或无法读取') }
    let provider: EmbeddingProvider | undefined
    try { provider = options.getProvider ? options.getProvider() : options.provider }
    catch { /* Invalid provider configuration degrades to a local keyword query. */ }
    const originalProvider = provider
    const revision = embeddingRevision(provider)
    const dimensions = provider?.metadata.dimensions
    let degraded: string | undefined = provider ? undefined : '未启用或未配置嵌入提供方，本次仅检索关键词'
    if (provider && (!Number.isInteger(dimensions) || dimensions! < 1 || dimensions! > 65_536)) {
      provider = undefined; degraded = '嵌入提供方未声明有效维度，本次仅检索关键词'
    }
    const first = await withBookLockAsync(root, async () => {
      const snapshot = await scanFinalized(root, signal)
      const cache = await SearchCache.open(root)
      try {
        const vectors = provider ? cache.vectors(snapshot, revision!, dimensions!) : new Map<string, Float32Array>()
        cache.publish(snapshot, new Map(), undefined, signal)
        return { snapshot, state: cache.state, vectors, sync: readIndexState(root) }
      }
      finally { cache.close() }
    })
    const indexed = new Map<string, { document: SearchDocument; chunk: SearchChunk }>()
    for (const document of first.snapshot.documents) for (const chunk of document.chunks) indexed.set(chunk.id, { document, chunk })
    const missing = indexed.size - first.vectors.size
    const ready = !!provider && missing === 0 && !first.sync.paused && !first.sync.rebuild && first.sync.phase !== 'failed'
    let queryVector: Float32Array | undefined
    if (provider && !ready) degraded = `语义索引尚未就绪（${first.vectors.size}/${indexed.size} 片段），本次仅检索关键词；可在索引页查看或启动后台更新`
    if (options.mode === 'keyword') degraded = '本次指定关键词模式'
    if (provider && ready && indexed.size && options.mode !== 'keyword') {
      try {
        signal?.throwIfAborted()
        const result = await abortable(provider.embed([{ text: query }], 'query', signal), signal)
        if (result.length !== 1) throw new SearchError('invalid-embedding', '查询嵌入结果数量不匹配')
        queryVector = normalizedVector(result[0], dimensions)
      } catch (error) {
        signal?.throwIfAborted()
        if (error instanceof SearchError && error.code === 'cancelled') throw error
        degraded = indexFailure(error).message + '，本次仅检索关键词'
      }
    }
    const preliminary = await withBookLockAsync(root, async () => {
      signal?.throwIfAborted()
      const current = await scanFinalized(root, signal)
      if (current.fingerprint !== first.snapshot.fingerprint) throw new SearchError('source-changed', '定稿在检索期间已变化，请重新检索')
      let active: EmbeddingProvider | undefined
      try { active = options.getProvider ? options.getProvider() : options.provider } catch { /* Compared below. */ }
      if (active !== originalProvider || embeddingRevision(active) !== revision) throw new SearchError('provider-changed', '嵌入配置在检索期间已变化，请重新检索')
      const cache = await SearchCache.open(root)
      try {
        if (readIndexState(root).generation !== first.sync.generation) throw new SearchError('index-changed', '索引在检索期间已重建或变更，请重新检索')
        cache.publish(current, new Map(), undefined, signal)
        const literalMatches = new Set([...indexed].filter(([, { chunk }]) => chunk.text.includes(query)).map(([id]) => id))
        const lexical = cache.keyword(query, literalMatches)
        const stableOrder = new Map([...indexed.keys()].map((id, order) => [id, order]))
        const candidateLimit = Math.max(100, limit * 4)
        // A phrase can span an overlap; source text, rather than cache text, remains authoritative.
        const keyword = lexical.filter(item => indexed.get(item.id)?.chunk.text.includes(query))
          .sort((a, b) => a.score - b.score || stableOrder.get(a.id)! - stableOrder.get(b.id)!).map(item => item.id)
        const vectors = first.vectors
        const semantic = queryVector ? [...vectors].map(([id, vector]) => ({ id, score: cosine(queryVector!, vector) }))
          .filter(item => item.score > 0).sort((a, b) => b.score - a.score || stableOrder.get(a.id)! - stableOrder.get(b.id)!) : []
        const fused = fuseRanks(keyword.slice(0, candidateLimit), semantic.slice(0, candidateLimit).map(item => item.id))
          .sort((a, b) => b.score - a.score || stableOrder.get(a.id)! - stableOrder.get(b.id)!)
        const selected = fused.slice(0, queryVector && reranker ? rerankBudget : limit)
        const checked = new Set<string>()
        for (const match of selected) {
          const { document } = indexed.get(match.id)!
          if (checked.has(document.path)) continue
          if (digest(await readFinalizedBytes(root, document.path, signal)) !== document.hash) throw new SearchError('source-changed', '命中原文已变化，请重新检索')
          checked.add(document.path)
        }
        signal?.throwIfAborted()
        const hits = selected.map(match => {
          const { document: doc, chunk } = indexed.get(match.id)!
          return {
            relativePath: doc.path, absolutePath: doc.absolutePath, volume: doc.volume, chapter: doc.chapter, title: doc.title,
            startLine: chunk.startLine, endLine: chunk.endLine, snippet: chunk.text, version: doc.version, hash: doc.hash, matchedBy: match.matchedBy, ...(chunk.scene ? { scene: chunk.scene } : {}),
            来源标注: annotate({ 条目: `卷${doc.volume} 第${doc.chapter}章 ${doc.title}`, 片段: chunk.text, 来源: `${doc.path}:${chunk.startLine}-${chunk.endLine}`, 版本: doc.version, 状态: '定稿定位，未经原文核对', 完整性: current.issues.length ? '部分来源不可读' : '定位片段，非全文' }),
          }
        })
        return {
          ok: true, mode: queryVector ? 'hybrid' : 'keyword', query, hits,
          status: current.issues.length ? 'partial' : !current.documents.length ? 'no-finalized' : hits.length ? 'matches' : 'no-matches',
          limited: fused.length > limit || keyword.length > candidateLimit || semantic.length > candidateLimit,
          issues: current.issues, ...(degraded ? { degraded } : {}),
          index: { state: first.state === 'ready' ? cache.state : first.state, chapters: current.documents.length, chunks: indexed.size,
            embedded: 0, reused: queryVector ? first.vectors.size : 0, ready, missing, phase: first.sync.phase },
          message: '结果仅供定位，请依据路径、行号和哈希读取原文核对；不能直接作为事实或审核证据。',
        } as FinalizedSearchResult
      } finally { cache.close() }
    })
    if (!preliminary.ok) return preliminary
    if (!reranker || !queryVector || preliminary.hits.length < 2) return { ...preliminary, hits: preliminary.hits.slice(0, limit),
      ...(rerankReason ? { reranking: { applied: false, candidates: 0, reason: rerankReason } } : {}) }
    let hits = preliminary.hits
    let applied = false
    const deadline = AbortSignal.timeout(rerankTimeout)
    const rerankSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
    try {
      const scores = await abortable(reranker.rerank(query, hits.map(hit => ({ text: hit.snippet, title: hit.title })), rerankSignal), rerankSignal)
      if (!Array.isArray(scores) || scores.length !== hits.length) throw new SearchError('invalid-reranking', '重排返回数量不匹配')
      for (let i = 0; i < scores.length; i++) if (typeof scores[i] !== 'number' || !Number.isFinite(scores[i])) throw new SearchError('invalid-reranking', '重排分数无效')
      hits = hits.map((hit, index) => ({ hit, index, score: scores[index]! })).sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.hit)
      applied = true
    } catch (error) {
      signal?.throwIfAborted()
      const providerTimedOut = error != null && typeof error === 'object' && 'code' in error && error.code === 'timeout'
      rerankReason = deadline.aborted ? `重排等待超过 ${rerankTimeout / 1000} 秒，本次使用原排序`
        : providerTimedOut ? '重排请求超时，本次使用原排序' : '重排服务未完成有效评分，本次使用原排序'
    }
    return await withBookLockAsync(root, async () => {
      signal?.throwIfAborted()
      const current = await scanFinalized(root, signal)
      if (current.fingerprint !== first.snapshot.fingerprint) throw new SearchError('source-changed', '原文或场景边界在重排期间已变化，请重新检索')
      if (readIndexState(root).generation !== first.sync.generation) throw new SearchError('index-changed', '索引在重排期间已重建或变更，请重新检索')
      let active: EmbeddingProvider | undefined
      let activeReranker: RerankingProvider | undefined
      try { active = options.getProvider ? options.getProvider() : options.provider; activeReranker = options.getReranker?.() } catch { /* Compared below. */ }
      if (active !== originalProvider || embeddingRevision(active) !== revision || activeReranker !== reranker
        || activeReranker?.metadata.revision !== rerankRevision || rerankTimeoutMs(activeReranker?.metadata.timeoutMs) !== rerankTimeout) {
        throw new SearchError('provider-changed', '检索模型配置在重排期间已变化，请重新检索')
      }
      return { ...preliminary, hits: hits.slice(0, limit), reranking: { applied, model: reranker.metadata.model,
        candidates: preliminary.hits.length, ...(rerankReason ? { reason: rerankReason } : {}) } }
    })
  } catch (error) {
    if (signal?.aborted) return { ok: false, code: 'cancelled', reason: '检索已取消' }
    if (error instanceof SearchError) return { ok: false, code: error.code, reason: error.message }
    if (error instanceof Error && /书仓.*锁/.test(error.message)) return { ok: false, code: 'book-busy', reason: '书仓正被其他操作锁定，请稍后重试' }
    return { ok: false, code: 'index-error', reason: '本地索引或来源校验失败；未改动作品，请检查书仓读取与缓存写入权限' }
  }
}
