import type { ChapterKey } from '../derive/scan'
import type { DraftRetentionManifest } from '../repo/draft-retention'
import type { BookLockOptions } from '../repo/lock'
import type { MaintenanceIssue } from './types'

export interface DraftRetentionPreview {
  readonly ok: boolean
  readonly state: 'ready' | 'blocked' | 'unchanged'
  readonly action?: 'confirm' | 'resume'
  readonly bookId?: string
  readonly chapter: ChapterKey
  readonly fingerprint?: string
  readonly operationId?: string
  readonly baseHead?: string
  readonly commit?: string
  readonly manifest?: DraftRetentionManifest
  readonly change?: { readonly relPath: string; readonly before: string; readonly after: string }
  readonly issues: readonly MaintenanceIssue[]
  readonly notices: readonly MaintenanceIssue[]
}

export interface DraftRetentionContext {
  readonly bookId: string
  readonly chapter: ChapterKey
  readonly fingerprint: string
  readonly signal?: AbortSignal
  readonly provenance?: BookLockOptions
  /** Rechecked under the book lock before any write or commit. */
  readonly validateIdentity?: () => boolean
}

export interface DraftRetentionResult {
  readonly ok: boolean
  readonly state: 'committed' | 'already-committed' | 'written-pending-commit' | 'blocked'
  readonly operationId?: string
  readonly commit?: string
  readonly paths?: readonly string[]
  readonly reason?: string
  readonly code?: string
  readonly notices?: readonly MaintenanceIssue[]
}
