import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { withBookLockAsync } from '../repo/lock'
import { renameSync } from '../repo/rename'
import { SearchError, type SearchIssue } from './types'

export type IndexPhase = 'disabled' | 'unconfigured' | 'queued' | 'scanning' | 'scenes' | 'embedding' | 'retrying' | 'paused' | 'ready' | 'failed'
export type IndexAction = 'enable' | 'disable' | 'update' | 'pause' | 'resume' | 'retry' | 'rebuild' | 'rescan-scenes'
export interface IndexFailure {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly httpStatus?: number
  readonly retryAfterMs?: number
}
export interface IndexNotice {
  readonly id: string
  readonly generation: number
  readonly error: IndexFailure
  readonly attempts: number
  readonly completed: number
  readonly total: number
  readonly head?: string
  readonly sessionId?: string
  readonly delivered?: boolean
  readonly deliveryError?: string
}
export interface IndexSyncState {
  readonly schema: 1
  readonly auto: boolean
  readonly paused: boolean
  readonly generation: number
  readonly phase: IndexPhase
  readonly chapters: number
  readonly completedChapters: number
  readonly chunks: number
  readonly completedChunks: number
  readonly generated: number
  readonly reused: number
  readonly failed: number
  readonly attempt: number
  readonly maxRetries: number
  readonly updatedAt: number
  readonly startedAt?: number
  readonly finishedAt?: number
  readonly retryAt?: number
  readonly head?: string
  readonly indexedHead?: string
  readonly sceneRevision?: string
  readonly targetRevision?: string
  readonly fingerprint?: string
  readonly provider?: { readonly name: string; readonly model: string; readonly dimensions: number; readonly revision: string }
  readonly recipientSession?: string
  readonly lastError?: IndexFailure
  readonly issues?: readonly SearchIssue[]
  readonly errors: readonly { readonly at: number; readonly attempt: number; readonly error: IndexFailure }[]
  readonly notice?: IndexNotice
  readonly rebuild?: boolean
  readonly scenes?: { readonly total: number; readonly completed: number; readonly generated: number; readonly reused: number; readonly fallback: number; readonly model?: string; readonly warning?: string }
}

export const INDEX_STATE_PATH = '.webnovel/finalized-search-state.json'
const LEASE_PATH = '.webnovel/finalized-search.worker.lock'
const phases: readonly string[] = ['disabled', 'unconfigured', 'queued', 'scanning', 'scenes', 'embedding', 'retrying', 'paused', 'ready', 'failed']

export function emptyIndexState(): IndexSyncState {
  return { schema: 1, auto: false, paused: false, generation: 0, phase: 'disabled', chapters: 0, completedChapters: 0,
    chunks: 0, completedChunks: 0, generated: 0, reused: 0, failed: 0, attempt: 0, maxRetries: 5, updatedAt: 0, errors: [] }
}

export function checkedIndexFile(root: string, relative: string): string {
  const directory = path.join(root, '.webnovel')
  try {
    const stat = fs.lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SearchError('unsafe-cache', '索引运行目录不得为链接或其他文件')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const filename = path.join(root, relative)
  try {
    const stat = fs.lstatSync(filename)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new SearchError('unsafe-cache', '索引状态或锁不得为目录、链接或共享硬链接')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  return filename
}

const checkedFile = checkedIndexFile

/** Kept outside the disposable SQLite cache so rebuilding it preserves user controls. */
export function readIndexState(root: string): IndexSyncState {
  try {
    const filename = checkedFile(root, INDEX_STATE_PATH)
    if (fs.statSync(filename).size > 256 * 1024) throw new Error('oversize state')
    const value = JSON.parse(fs.readFileSync(filename, 'utf8')) as IndexSyncState
    if (!value || value.schema !== 1 || typeof value.auto !== 'boolean' || typeof value.paused !== 'boolean'
      || !phases.includes(value.phase) || !Array.isArray(value.errors) || value.errors.length > 20
      || ['generation', 'chapters', 'completedChapters', 'chunks', 'completedChunks', 'generated', 'reused', 'failed', 'attempt', 'maxRetries', 'updatedAt']
        .some(key => !Number.isSafeInteger(value[key as keyof IndexSyncState]) || Number(value[key as keyof IndexSyncState]) < 0)) throw new Error('invalid state')
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyIndexState()
    if (error instanceof SearchError) throw error
    throw new SearchError('index-state-error', '后台索引状态无法读取；保留原文件，请检查状态文件或权限')
  }
}

/** Caller holds the short book lock. Never writes source files or changes Git. */
export function writeIndexState(root: string, value: IndexSyncState): void {
  const filename = checkedFile(root, INDEX_STATE_PATH)
  const temp = `${filename}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 })
    checkedFile(root, INDEX_STATE_PATH)
    renameSync(temp, filename)
  } finally { try { fs.unlinkSync(temp) } catch { /* Renamed or not created. */ } }
}

/** The caller holds the book lock and has actually lost the disposable vector cache. */
export function invalidateIndexCache(root: string): void {
  const state = readIndexState(root)
  writeIndexState(root, { ...state, generation: state.generation + 1,
    phase: state.paused ? 'paused' : state.auto ? 'queued' : 'disabled',
    completedChapters: 0, completedChunks: 0, generated: 0, reused: 0, failed: 0, attempt: 0,
    indexedHead: undefined, fingerprint: undefined, finishedAt: undefined, retryAt: undefined,
    lastError: undefined, notice: undefined, updatedAt: Date.now() })
}

export function changeIndexState(root: string, change: (state: IndexSyncState) => IndexSyncState): Promise<IndexSyncState> {
  try { if (!fs.statSync(root).isDirectory()) throw new Error('missing root') }
  catch { return Promise.reject(new SearchError('source-error', '书仓目录不存在或不可读取')) }
  return withBookLockAsync(root, async () => {
    const value = change(readIndexState(root))
    writeIndexState(root, value)
    return value
  })
}

function dead(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return false } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' }
}

/** A separate lease prevents duplicate API work without locking out author writes. */
export async function acquireIndexLease(root: string): Promise<() => void> {
  try { if (!fs.statSync(root).isDirectory()) throw new Error('missing root') }
  catch { throw new SearchError('source-error', '书仓目录不存在或不可读取') }
  return withBookLockAsync(root, async () => {
    const filename = checkedFile(root, LEASE_PATH)
    try {
      const previous = JSON.parse(fs.readFileSync(filename, 'utf8')) as { pid?: unknown; token?: unknown }
      if (typeof previous.pid !== 'number' || !Number.isInteger(previous.pid) || previous.pid <= 0 || typeof previous.token !== 'string') throw new SearchError('index-lock-invalid', '索引锁的归属无法确认')
      if (!dead(previous.pid)) throw new SearchError('index-busy', '另一进程正在维护这部书的索引')
      fs.unlinkSync(filename)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        if (error instanceof SearchError) throw error
        throw new SearchError('index-lock-invalid', '索引任务锁的归属无法确认，请检查后重试')
      }
    }
    const owner = JSON.stringify({ pid: process.pid, token: randomUUID() })
    fs.writeFileSync(filename, owner, { flag: 'wx', mode: 0o600 })
    return () => {
      try { if (fs.readFileSync(checkedFile(root, LEASE_PATH), 'utf8') === owner) fs.unlinkSync(filename) }
      catch { /* Unknown ownership is never removed. */ }
    }
  })
}
