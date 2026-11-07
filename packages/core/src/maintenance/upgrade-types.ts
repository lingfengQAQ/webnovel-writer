import type { BookLockOptions } from '../repo/lock'
import type { BookInspection, MaintenanceIssue } from './types'

export const BOOK_UPGRADE_RULE_VERSION = 2 as const

export interface UpgradeChange {
  readonly relPath: string
  readonly before: string | null
  readonly after: string
  readonly rules: readonly string[]
  readonly evidence: readonly string[]
}

export interface UpgradeRulesResult {
  readonly changes: readonly UpgradeChange[]
  readonly issues: readonly MaintenanceIssue[]
}

export interface UpgradeEffect {
  readonly path: string
  readonly sources: readonly string[]
  readonly reason: string
}

/** Complete readonly preview. No executable plan is returned for a partial repair. */
export interface BookUpgradePreview {
  readonly ok: true
  readonly state: 'ready' | 'unchanged' | 'blocked'
  readonly ruleVersion: 2
  readonly bookId?: string
  readonly fingerprint?: string
  readonly baseHead?: string
  readonly changes: readonly UpgradeChange[]
  readonly effects: readonly UpgradeEffect[]
  readonly issues: readonly MaintenanceIssue[]
  /** Actual source inspection. Recognized old formats remain visible here. */
  readonly inspectionBefore?: BookInspection
  /** Inspection of the in-memory proposed bytes, not a claim that they were written. */
  readonly inspectionAfter?: BookInspection
  /** Valid attachments that this plan would make stale; they remain in inspectionAfter. */
  readonly expectedStaleIssues?: readonly MaintenanceIssue[]
  readonly resumable: readonly string[]
  /** Paused, structurally checked work retained by the upgrade; it is not declared closed. */
  readonly activeWork?: readonly { readonly 路径: string; readonly 种类: string; readonly 说明: string }[]
}

export interface BookUpgradeContext {
  readonly bookId: string
  readonly signal?: AbortSignal
  readonly provenance?: BookLockOptions
  /** Called under the book lock, before any source writes. */
  readonly validateIdentity?: () => boolean
}

export interface BookUpgradeResult {
  readonly ok: boolean
  readonly state: 'committed' | 'already-committed' | 'written-pending-commit' | 'recovered' | 'blocked'
  readonly operationId?: string
  readonly commit?: string
  readonly paths?: readonly string[]
  readonly reason?: string
  readonly code?: string
  readonly effects?: readonly UpgradeEffect[]
}

export interface BookUpgradeResumePreview {
  readonly ok: boolean
  readonly bookId?: string
  readonly operationId: string
  readonly fingerprint?: string
  readonly state: 'pending-commit' | 'committed' | 'interrupted' | 'blocked'
  readonly paths: readonly string[]
  readonly reason?: string
  readonly effects?: readonly UpgradeEffect[]
  readonly commit?: string
  readonly outputs?: readonly { readonly relPath: string; readonly before: string | null; readonly sha256: string; readonly gitBlob: string }[]
  readonly drafts?: readonly { readonly relPath: string; readonly before: string; readonly after: string; readonly sha256: string }[]
}
