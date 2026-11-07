/** Canonical book-level coordination for synchronous and asynchronous writes. */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { canonicalizePath } from '../gate/canonical'

export const RUNTIME_DIR = '.webnovel'
export const TRANSACTION_DIR = `${RUNTIME_DIR}/transactions`
export const OPERATION_DIR = `${RUNTIME_DIR}/operations`

export interface BookLockOptions {
  readonly operationId?: string
  /** Maintenance continuation must remain bound to the originally approved physical book. */
  readonly bookRootIdentity?: string
  readonly sessionId?: string
  readonly agentId?: string
  readonly toolName?: string
  readonly callId?: string
  readonly targets?: readonly string[]
}

interface HeldLock {
  provenance: BookLockOptions
  auditEnabled: boolean
  readonly targets: Set<string>
}

const held = new Map<string, HeldLock>()
const asyncHeld = new Map<string, HeldLock>()
const asyncOwner = new AsyncLocalStorage<ReadonlyMap<string, HeldLock>>()
function keyOf(root: string): string {
  const canonical = canonicalizePath(root)
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

function hasProvenance(options: BookLockOptions): boolean {
  return Object.entries(options).some(([key, value]) => key !== 'targets' && value !== undefined)
}

function mergeOptions(state: HeldLock, options: BookLockOptions): void {
  state.auditEnabled ||= hasProvenance(options)
  state.provenance = { ...options, ...state.provenance }
  for (const target of options.targets ?? []) state.targets.add(target)
}

export function currentBookProvenance(root: string): BookLockOptions | undefined {
  const state = ownedState(keyOf(root))
  return state?.auditEnabled ? { ...state.provenance, targets: [...state.targets] } : undefined
}

export function updateOperationTargets(root: string, provenance: BookLockOptions | undefined, targets: readonly string[]): void {
  const state = ownedState(keyOf(root))
  if (state !== undefined) mergeOptions(state, { ...provenance, targets })
}

function ensureRuntimeIgnored(root: string): void {
  try {
    const dotGit = path.join(root, '.git')
    let dir = dotGit
    if (fs.statSync(dotGit).isFile()) {
      const pointer = /^\s*gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf-8'))?.[1]
      if (!pointer) return
      dir = path.resolve(root, pointer)
    }
    const common = path.join(dir, 'commondir')
    if (fs.existsSync(common)) dir = path.resolve(dir, fs.readFileSync(common, 'utf-8').trim())
    // Only follow pointers that land on a real Git directory; never create one elsewhere.
    if (!fs.existsSync(path.join(dir, 'HEAD')) || !fs.statSync(path.join(dir, 'objects')).isDirectory()) return
    const exclude = path.join(dir, 'info', 'exclude')
    const text = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf-8') : ''
    if (text.split(/\r?\n/).includes(`/${RUNTIME_DIR}/`)) return
    fs.mkdirSync(path.dirname(exclude), { recursive: true })
    fs.appendFileSync(exclude, `${text.endsWith('\n') || text === '' ? '' : '\n'}/${RUNTIME_DIR}/\n`, 'utf-8')
  } catch { /* Ignore configuration is diagnostic, not a write precondition. */ }
}

/** Lock failures carry a stable code so tool layers can choose the next step. */
export class BookLockError extends Error {
  constructor(readonly code: 'book-locked' | 'lock-interrupted' | 'runtime-link', message: string) {
    super(message)
    this.name = 'BookLockError'
  }
}

/** Heartbeat age is diagnostic only; an expired heartbeat does not revoke a live writer. */
export const LOCK_STALE_MS = 10 * 60_000
/** The acquire guard is held for a few file operations only. */
export const GUARD_STALE_MS = 30_000
const HEARTBEAT_MS = 10_000
const RETRY_LIMIT_MS = 2_000
const host = os.hostname()
const processStartedAt = Date.now() - process.uptime() * 1000

interface LockOwner { readonly pid?: unknown; readonly hostname?: unknown; readonly createdAt?: unknown }

function readOwner(file: string): LockOwner | undefined {
  try {
    const owner: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return owner !== null && typeof owner === 'object' ? owner as LockOwner : undefined
  } catch { return undefined }
}

/**
 * Only a demonstrably exited owner may be reclaimed. Unknown/remote owners
 * fail closed. A timestamp predating this process detects reuse of our own PID.
 */
export function lockIsStale(file: string, _staleMs = LOCK_STALE_MS): boolean {
  const owner = readOwner(file)
  if (owner === undefined) return false
  const pid = owner.pid
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false
  if (typeof owner.hostname === 'string' && owner.hostname !== host) return false
  if (pid === process.pid) return typeof owner.createdAt === 'string'
    && Date.parse(owner.createdAt) < processStartedAt - 2000
  try { process.kill(pid, 0) } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
  return false
}

function heldByThisProcess(file: string): boolean {
  const owner = readOwner(file)
  return owner?.pid === process.pid && (owner.hostname === undefined || owner.hostname === host) && !lockIsStale(file)
}

/** Legacy files are reclaimed only while holding the new directory mutex. */
function reclaim(file: string): void {
  const aside = `${file}.stale-${randomUUID()}`
  try { fs.renameSync(file, aside) } catch { return }
  try { fs.unlinkSync(aside) } catch { /* A leftover aside file is harmless. */ }
}

function releaseOwned(file: string, owner: string): void {
  try {
    if (fs.readFileSync(file, 'utf-8') === owner) fs.unlinkSync(file)
  } catch { /* Preserve the operation result; an orphan lock will be diagnosed. */ }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Publish a nonempty directory in one rename. Reclaim/release only unlink the
 * observed unique owner name, then rmdir the empty directory. A late reclaimer
 * cannot unlink a successor's owner or remove its nonempty directory.
 */
function acquireWriterMutex(runtime: string, owner: string): () => void {
  const lock = path.join(runtime, 'writer.lock')
  const name = `owner-${randomUUID()}.json`
  const staging = path.join(runtime, `.writer-${randomUUID()}.stage`)
  fs.mkdirSync(staging)
  fs.writeFileSync(path.join(staging, name), owner, { flag: 'wx', mode: 0o600 })
  const removeOwner = (dir: string, filename: string): void => {
    try { fs.unlinkSync(path.join(dir, filename)) } catch { /* Already reclaimed. */ }
    try { fs.rmdirSync(dir) } catch { /* A successor is nonempty and must survive. */ }
  }
  const deadline = Date.now() + RETRY_LIMIT_MS
  let acquired = false
  try {
    for (;;) {
      try {
        fs.renameSync(staging, lock)
        acquired = true
        return () => removeOwner(lock, name)
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      }
      try {
        const stat = fs.lstatSync(lock)
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new BookLockError('runtime-link', '书仓 writer.lock 必须是普通目录。请作者核对运行目录')
        const names = fs.readdirSync(lock)
        if (names.length === 0) {
          try { fs.rmdirSync(lock) } catch { /* Another acquirer published first. */ }
        } else if (names.length === 1 && /^owner-[a-f0-9-]+\.json$/.test(names[0]!)) {
          const file = path.join(lock, names[0]!)
          if (lockIsStale(file)) removeOwner(lock, names[0]!)
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (Date.now() + 50 > deadline) {
        throw new BookLockError('book-locked', '书仓写入锁定中，本次没有写入。请等几秒后重试一次；仍然失败时，请作者核对 .webnovel/writer.lock 的进程身份。无法确认归属时不要直接删除')
      }
      sleepSync(50)
    }
  } finally {
    if (!acquired) removeOwner(staging, name)
  }
}

function tryAcquire(guard: string, lock: string, owner: string): 'acquired' | 'busy' | 'busy-self' {
  try { fs.writeFileSync(guard, owner, { flag: 'wx', mode: 0o600 }) } catch (error) {
    if (!fs.existsSync(guard)) throw error
    if (lockIsStale(guard, GUARD_STALE_MS)) reclaim(guard)
    return 'busy'
  }
  try {
    if (fs.existsSync(lock)) {
      if (heldByThisProcess(lock)) return 'busy-self'
      if (!lockIsStale(lock)) return 'busy'
      reclaim(lock)
    }
    fs.writeFileSync(lock, owner, { flag: 'wx', mode: 0o600 })
    return 'acquired'
  } finally {
    releaseOwned(guard, owner)
  }
}

function acquire(root: string, provenance: BookLockOptions, heartbeat: boolean): () => void {
  const runtime = path.join(root, RUNTIME_DIR)
  if (fs.existsSync(runtime) && fs.lstatSync(runtime).isSymbolicLink()) throw new BookLockError('runtime-link', '书仓运行目录不得为符号链接')
  fs.mkdirSync(runtime, { recursive: true })
  const owner = JSON.stringify({ ...provenance, pid: process.pid, hostname: host, token: randomUUID(), createdAt: new Date().toISOString() })
  const releaseMutex = acquireWriterMutex(runtime, owner)
  const guard = path.join(runtime, 'acquire.lock')
  const lock = path.join(runtime, 'book.lock')
  const deadline = Date.now() + RETRY_LIMIT_MS
  let wait = 50
  try { for (;;) {
    const state = tryAcquire(guard, lock, owner)
    if (state === 'acquired') break
    if (state === 'busy-self' || Date.now() + wait > deadline) {
      if (fs.existsSync(guard) && !fs.existsSync(lock)) throw new BookLockError('lock-interrupted', '书仓锁获取曾中断，留下了 .webnovel/acquire.lock，本次没有写入。请等 30 秒后重试一次；只有确认持有进程退出时才自动回收。仍然失败时，请作者核对归属并确认没有其他写作窗口后，删除这个文件')
      throw new BookLockError('book-locked', '书仓写入锁定中：另一个写入操作正在进行，本次没有写入。请等几秒后重试一次；仍然失败时，请作者检查是否开着其他写作窗口')
    }
    sleepSync(wait)
    wait = Math.min(wait * 2, 400)
  } } catch (error) { releaseMutex(); throw error }
  const timer = heartbeat ? setInterval(() => {
    try { if (fs.readFileSync(lock, 'utf8') === owner) { const now = new Date(); fs.utimesSync(lock, now, now) } } catch { /* Released or removed. */ }
  }, HEARTBEAT_MS) : undefined
  timer?.unref?.()
  return () => {
    if (timer !== undefined) clearInterval(timer)
    releaseOwned(lock, owner)
    releaseMutex()
  }
}

function audit(root: string, state: HeldLock, startedAt: string, status: 'running' | 'completed' | 'failed', error?: unknown): void {
  const id = state.provenance.operationId!
  const name = /^[A-Za-z0-9._-]{1,120}$/.test(id) ? id : createHash('sha256').update(id).digest('hex')
  const file = path.join(root, OPERATION_DIR, `${name}.json`)
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(temp, JSON.stringify({
      schemaVersion: 1, ...state.provenance, targets: [...state.targets],
      status, startedAt, updatedAt: new Date().toISOString(),
      ...(error === undefined ? {} : { error: String(error) }),
    }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    fs.renameSync(temp, file)
  } catch { /* Audit failures must not turn a completed write into a failure. */ }
  finally { try { fs.unlinkSync(temp) } catch { /* Already renamed or never created. */ } }
}

export function withBookLock<T>(bookRoot: string, operation: () => T, options: BookLockOptions = {}): T {
  const root = canonicalizePath(bookRoot)
  const key = keyOf(root)
  const existing = ownedState(key)
  if (existing !== undefined) {
    mergeOptions(existing, options)
    return operation()
  }
  const provenance = { ...options, operationId: options.operationId ?? `op-${randomUUID()}` }
  const release = acquire(root, provenance, false)
  const state: HeldLock = { provenance, auditEnabled: hasProvenance(options), targets: new Set(options.targets) }
  held.set(key, state)
  const startedAt = new Date().toISOString()
  let failed: unknown
  try {
    ensureRuntimeIgnored(root)
    if (state.auditEnabled) audit(root, state, startedAt, 'running')
    const result = operation()
    if (result !== null && typeof result === 'object') {
      if ('then' in result && typeof result.then === 'function') throw new Error('书仓写入临界区必须同步，作者问答须在获取锁之前完成')
      if ('ok' in result && result.ok === false) failed = 'reason' in result ? result.reason : 'operation returned ok:false'
    }
    return result
  } catch (error) {
    failed = error
    throw error
  } finally {
    if (state.auditEnabled) audit(root, state, startedAt, failed === undefined ? 'completed' : 'failed', failed)
    held.delete(key)
    release()
  }
}

function ownedState(key: string): HeldLock | undefined {
  const active = asyncHeld.get(key)
  if (active !== undefined) {
    if (asyncOwner.getStore()?.get(key) !== active) throw new BookLockError('book-locked', '书仓写入锁定中：本会话的另一个写入还没有结束，本次没有写入。请等它完成后再调用')
    return active
  }
  return held.get(key)
}

/** Native filesystem dispatch may await; only this async chain may reenter its lock. */
export async function withBookLockAsync<T>(bookRoot: string, operation: () => Promise<T>, options: BookLockOptions = {}): Promise<T> {
  const root = canonicalizePath(bookRoot)
  const key = keyOf(root)
  const existing = ownedState(key)
  if (existing !== undefined) {
    if (held.has(key)) throw new Error('同步书仓锁内不得启动异步写入')
    mergeOptions(existing, options)
    return operation()
  }
  const provenance = { ...options, operationId: options.operationId ?? `op-${randomUUID()}` }
  const release = acquire(root, provenance, true)
  const state: HeldLock = { provenance, auditEnabled: hasProvenance(options), targets: new Set(options.targets) }
  asyncHeld.set(key, state)
  const owners = new Map(asyncOwner.getStore())
  owners.set(key, state)
  const startedAt = new Date().toISOString()
  let failed: unknown
  try {
    ensureRuntimeIgnored(root)
    if (state.auditEnabled) audit(root, state, startedAt, 'running')
    const result = await asyncOwner.run(owners, operation)
    if (result !== null && typeof result === 'object' && 'ok' in result && result.ok === false) {
      failed = 'reason' in result ? result.reason : 'operation returned ok:false'
    }
    return result
  } catch (error) {
    failed = error
    throw error
  } finally {
    if (state.auditEnabled) audit(root, state, startedAt, failed === undefined ? 'completed' : 'failed', failed)
    asyncHeld.delete(key)
    release()
  }
}
