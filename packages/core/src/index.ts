/* @webnovel/core —— 核心服务(M0:书仓/推导/配置最小)。行为规格见 docs/book-format.md。 */
export * from './repo/paths'
export * from './repo/frontmatter'
export * from './repo/atomic'
export * from './repo/transaction'
export * from './repo/lock'
export * from './repo/sourceRef'
export * from './repo/schema'
export * from './derive/states'
export * from './derive/scan'
export * from './derive/derive'
export * from './derive/design'
export * from './provenance'
export * from './config/resolve'
export * from './gate'
export * from './arbitration'
export * from './commit'
export * from './inspire'
export * from './memory/author'
export * from './memory/book'
export * from './memory/catalog'
export * from './progress'
export * from './book'
export * from './design'
export * from './outline'
export * from './assembly'
export * from './evidence'
export * from './export'
export * from './revise'
export * from './prepare'
export * from './settlement'
export * from './ledger'
export * from './impact'
export * from './summary'
export * from './recovery'
export type { EmbeddingInput, EmbeddingProvider, SceneProvider, RerankingProvider, FinalizedSearchResult, FinalizedSearchHit } from './retrieval/types'
export { forgetSceneBoundaries } from './retrieval/scene-sync'
export { searchFinalized, type SearchOptions } from './retrieval/search'
export { syncFinalizedIndex, type SyncIndexOptions, type SyncIndexResult } from './retrieval/sync'
export { readIndexState, changeIndexState, emptyIndexState, type IndexAction, type IndexSyncState, type IndexFailure, type IndexNotice } from './retrieval/state'
export { embeddingRevision } from './retrieval/embedding'
export { indexFailure, DEFAULT_INDEX_RETRY, type IndexRetryPolicy } from './retrieval/retry'
export {
  CANDIDATE_HEADING,
  composeBody,
  countPendingReviewDrafts,
  demoteOtherPendingDrafts,
  findPendingReviewDraft,
  listChapterDrafts,
  nextDraftFileName,
  splitCandidateFacts,
  草稿字段序,
  type DraftFile,
} from './repo/drafts'

export { scanWorkspaceBooks, uniqueBookRoot, hasBooks, type WorkspaceBook } from './book/identity'
