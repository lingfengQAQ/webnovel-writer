/**
 * 书仓多文件事务清单与恢复。
 *
 * 单文件 rename 仍是读者看到完整内容的边界；manifest 让进程在多个
 * rename 之间退出后可以把已经记录的目标恢复到批次开始前的状态。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { removeSync } from './remove'
import { renameSync } from './rename'
import { currentBookProvenance, GUARD_STALE_MS, lockIsStale, RUNTIME_DIR, TRANSACTION_DIR, withBookLock } from './lock'

export const QUARANTINE_DIR = `${RUNTIME_DIR}/quarantine`
import { canonicalizePath, isInsideCanonicalRoot } from '../gate/canonical'
import { safeRelPath } from './rel-path'

export interface OperationProvenance {
  readonly operationId?: string
  readonly bookRootIdentity?: string
  readonly sessionId?: string
  readonly agentId?: string
  readonly toolName?: string
  readonly callId?: string
  readonly targets?: readonly string[]
}

export interface TransactionOptions {
  readonly provenance?: OperationProvenance
}

interface ManifestEntry {
  readonly relPath: string
  readonly tmpRel: string
  readonly backupRel: string
  readonly contentHash: string
  readonly originalHash: string | null
  readonly hadOriginal: boolean
  readonly backupRecorded: boolean
  readonly applied: boolean
}

interface TransactionManifest {
  readonly schemaVersion: 1
  readonly id: string
  readonly createdAt: string
  readonly phase: 'staged' | 'backed-up' | 'applying' | 'committed'
  readonly entries: readonly ManifestEntry[]
  readonly provenance?: OperationProvenance
}

function safeRel(relPath: string): string {
  return safeRelPath(relPath, (problem) => new Error(problem === 'absolute' ? `事务路径必须是书仓相对路径：${relPath}` : `事务路径非法：${relPath}`), { strict: true })
}

/** root 在进入事务时已 canonical 化（见 runTransaction / recoverTransactions），这里不再逐次重算。 */
function inside(root: string, rel: string): string {
  const abs = path.resolve(root, rel)
  if (!isInsideCanonicalRoot(root, abs)) throw new Error(`事务路径逃逸书仓：${rel}`)
  return abs
}

/** Write a new file and flush it to disk before any rename publishes it. */
function writeDurable(file: string, content: string | Buffer, flag = 'wx'): void {
  const fd = fs.openSync(file, flag, 0o666)
  try {
    fs.writeFileSync(fd, content, typeof content === 'string' ? 'utf-8' : undefined)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

/** Flush a directory entry after rename; Windows cannot open directories for fsync. */
function syncDir(dir: string): void {
  if (process.platform === 'win32') return
  let fd: number | undefined
  try {
    fd = fs.openSync(dir, 'r')
    fs.fsyncSync(fd)
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
  }
  finally { if (fd !== undefined) fs.closeSync(fd) }
}

function publish(tmp: string, target: string): void {
  renameSync(tmp, target)
  syncDir(path.dirname(target))
}

function syncAncestors(root: string, dir: string): void {
  for (let current = dir; ; current = path.dirname(current)) {
    syncDir(current)
    if (current === root) return
    if (path.dirname(current) === current) throw new Error('事务目录不在书仓内')
  }
}

function manifestPath(root: string, id: string): string {
  return path.join(root, TRANSACTION_DIR, id, 'manifest.json')
}

function writeManifest(file: string, value: TransactionManifest): void {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    writeDurable(tmp, `${JSON.stringify(value, null, 2)}\n`)
    publish(tmp, file)
  } catch (err) {
    try { removeSync(tmp) } catch { /* best effort */ }
    throw err
  }
}

function updateManifest(root: string, manifest: TransactionManifest, patch: Partial<TransactionManifest>): TransactionManifest {
  const next = { ...manifest, ...patch } as TransactionManifest
  writeManifest(manifestPath(root, manifest.id), next)
  return next
}

function parseManifest(root: string, file: string, relocated = false): TransactionManifest {
  let raw: unknown
  try { raw = JSON.parse(fs.readFileSync(file, 'utf-8')) } catch (err) {
    throw new Error(`事务清单解析失败：${file}:${err instanceof Error ? err.message : String(err)}`)
  }
  if (raw === null || typeof raw !== 'object') throw new Error(`事务清单格式非法：${file}`)
  const o = raw as Record<string, unknown>
  if (o.schemaVersion !== 1 || typeof o.id !== 'string' || !Array.isArray(o.entries)) {
    throw new Error(`事务清单版本或 entries 非法：${file}`)
  }
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(o.id) || (!relocated && path.basename(path.dirname(file)) !== o.id)) {
    throw new Error(`事务清单 id 非法：${file}`)
  }
  const entries: ManifestEntry[] = []
  for (const item of o.entries) {
    if (item === null || typeof item !== 'object') throw new Error(`事务清单条目非法：${file}`)
    const e = item as Record<string, unknown>
    if (typeof e.relPath !== 'string' || typeof e.tmpRel !== 'string' || typeof e.backupRel !== 'string') {
      throw new Error(`事务清单路径字段非法：${file}`)
    }
    const expectedBackup = `${TRANSACTION_DIR}/${o.id}/backups/`
    const normalizedRel = safeRel(e.relPath)
    const normalizedTmp = safeRel(e.tmpRel)
    if (typeof e.hadOriginal !== 'boolean' || typeof e.backupRecorded !== 'boolean'
      || typeof e.applied !== 'boolean' || typeof e.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(e.contentHash)
      || (e.hadOriginal ? typeof e.originalHash !== 'string' || !/^[a-f0-9]{64}$/.test(e.originalHash) : e.originalHash !== null)) {
      throw new Error(`事务清单恢复字段非法：${file}`)
    }
    if (!e.backupRel.startsWith(expectedBackup)
      || path.posix.dirname(normalizedTmp) !== path.posix.dirname(normalizedRel)
      || !path.posix.basename(normalizedTmp).startsWith(`.webnovel-txn-${o.id}-`)) {
      throw new Error(`事务清单临时/备份路径越界：${file}`)
    }
    entries.push({
      relPath: normalizedRel,
      tmpRel: normalizedTmp,
      backupRel: safeRel(e.backupRel),
      contentHash: typeof e.contentHash === 'string' ? e.contentHash : '',
      originalHash: e.hadOriginal ? e.originalHash as string : null,
      hadOriginal: e.hadOriginal === true,
      backupRecorded: e.backupRecorded === true,
      applied: e.applied === true,
    })
  }
  const phase = o.phase
  if (phase !== 'staged' && phase !== 'backed-up' && phase !== 'applying' && phase !== 'committed') {
    throw new Error(`事务阶段非法：${file}`)
  }
  return {
    schemaVersion: 1,
    id: o.id as string,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
    phase,
    entries,
    provenance: o.provenance !== null && typeof o.provenance === 'object' ? o.provenance as OperationProvenance : undefined,
  }
}

function planRestore(root: string, entry: ManifestEntry): (() => void) | undefined {
  if (!entry.backupRecorded) return undefined
  const target = inside(root, entry.relPath)
  let original: Buffer | undefined
  if (entry.hadOriginal) {
    const backup = inside(root, entry.backupRel)
    if (!fs.existsSync(backup) || !fs.lstatSync(backup).isFile()) throw new Error(`事务备份缺失或非法：${entry.relPath}`)
    original = fs.readFileSync(backup)
    if (createHash('sha256').update(original).digest('hex') !== entry.originalHash) throw new Error(`事务备份校验失败：${entry.relPath}`)
  }
  let current: string | null = null
  try {
    if (!fs.lstatSync(target).isFile()) throw new Error(`事务恢复目标不是普通文件：${entry.relPath}`)
    current = createHash('sha256').update(fs.readFileSync(target)).digest('hex')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (current === entry.originalHash) return undefined
  if (current !== entry.contentHash) throw new Error(`事务恢复冲突，目标已被另行修改，备份已保留：${entry.relPath}`)
  return () => {
    if (original !== undefined) {
      const temp = inside(root, `${entry.tmpRel}.restore`)
      removeSync(temp)
      writeDurable(temp, original)
      publish(temp, target)
    } else {
      fs.unlinkSync(target)
      syncDir(path.dirname(target))
    }
  }
}

function cleanupTransaction(root: string, id: string, entries: readonly ManifestEntry[] = []): void {
  for (const entry of entries) {
    removeSync(inside(root, entry.tmpRel))
    removeSync(inside(root, `${entry.tmpRel}.restore`))
  }
  const dir = path.join(root, TRANSACTION_DIR, id)
  const done = `${dir}.done`
  renameSync(dir, done)
  syncDir(path.dirname(dir))
  try { removeSync(done) } catch { /* A settled .done directory is cleanup-only on restart. */ }
}

function rollbackTransaction(root: string, manifest: TransactionManifest): void {
  // Validate the complete recovery before modifying any file.
  const actions = [...manifest.entries].reverse().map((entry) => planRestore(root, entry))
  for (const action of actions) action?.()
  cleanupTransaction(root, manifest.id, manifest.entries)
}

interface QuarantineRecord {
  readonly id: string
  readonly reason: string
  readonly targets: readonly string[] | null
  readonly quarantinedAt: string
  readonly location: string
  /** New layout: evidence is an entry inside a trusted container, never the container itself. */
  readonly sourceName?: string
}

/**
 * 把无法恢复的批次整体移入隔离区（备份、清单原样保留），书仓其余文件继续可写。
 * 已知目标的冲突批次仍阻止对这些目标的写入，直到作者处理隔离区。
 */
function quarantine(root: string, txDir: string, id: string, reason: string, targets: readonly string[] | null): QuarantineRecord {
  const base = path.join(root, QUARANTINE_DIR)
  inside(root, QUARANTINE_DIR)
  fs.mkdirSync(base, { recursive: true })
  const name = `${id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)}-${randomUUID().slice(0, 8)}`
  const dest = path.join(base, name)
  fs.mkdirSync(dest)
  const record: QuarantineRecord = { id, reason, targets, quarantinedAt: new Date().toISOString(), location: `${QUARANTINE_DIR}/${name}`, sourceName: path.basename(txDir) }
  // Publish recovery metadata BEFORE removing the source transaction. Never
  // write through the quarantined entry: it may itself be an unsafe link.
  writeDurable(path.join(dest, 'quarantine.json'), `${JSON.stringify(record, null, 2)}\n`)
  syncAncestors(root, dest)
  renameSync(txDir, path.join(dest, 'transaction'))
  syncDir(dest)
  syncDir(path.dirname(txDir))
  return record
}

function ordinaryDirectory(file: string): boolean {
  try { const s = fs.lstatSync(file); return s.isDirectory() && !s.isSymbolicLink() } catch { return false }
}

function readQuarantine(root: string, name: string): QuarantineRecord {
  const location = `${QUARANTINE_DIR}/${name}`
  const dir = inside(root, location)
  if (!ordinaryDirectory(dir)) throw new Error('隔离目录必须是普通目录')
  const file = path.join(dir, 'quarantine.json')
  if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error('隔离记录必须是普通文件')
  const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (raw === null || typeof raw !== 'object') throw new Error('隔离记录格式非法')
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.reason !== 'string' || typeof r.quarantinedAt !== 'string'
    || (r.targets !== null && (!Array.isArray(r.targets) || !r.targets.every(t => typeof t === 'string')))
    || (r.sourceName !== undefined && (typeof r.sourceName !== 'string' || /[\\/]/.test(r.sourceName) || ['.', '..', ''].includes(r.sourceName)))) throw new Error('隔离记录字段非法')
  const targets = r.targets === null ? null : (r.targets as string[]).map(safeRel)
  return { id: r.id, reason: r.reason, quarantinedAt: r.quarantinedAt, targets, location,
    ...(typeof r.sourceName === 'string' ? { sourceName: r.sourceName } : {}) }
}

/** Finish a metadata-first quarantine interrupted before moving its evidence. */
function finishQuarantines(root: string): void {
  for (const record of listQuarantined(root)) {
    if (record.sourceName === undefined) continue
    const dest = inside(root, record.location)
    const payload = path.join(dest, 'transaction')
    try { fs.lstatSync(payload); continue } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const source = path.join(root, TRANSACTION_DIR, record.sourceName)
    try { fs.lstatSync(source) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
    renameSync(source, payload)
    syncDir(dest)
    syncDir(path.dirname(source))
  }
}

/** 隔离区中的批次（供诊断与写入前目标冲突检查）。 */
export function listQuarantined(bookRoot: string): QuarantineRecord[] {
  const root = canonicalizePath(bookRoot)
  const base = path.join(root, QUARANTINE_DIR)
  if (!fs.existsSync(base)) return []
  inside(root, QUARANTINE_DIR)
  if (!ordinaryDirectory(base)) throw new Error('隔离区必须是普通目录')
  const records: QuarantineRecord[] = []
  for (const name of fs.readdirSync(base)) {
    try {
      records.push(readQuarantine(root, name))
    } catch {
      let targets: string[] | null = null
      for (const dir of [path.join(base, name, 'transaction'), path.join(base, name)]) {
        try {
          inside(root, path.relative(root, dir))
          if (!ordinaryDirectory(dir)) continue
          const file = path.join(dir, 'manifest.json')
          if (!fs.lstatSync(file).isFile()) continue
          inside(root, path.relative(root, file))
          targets = parseManifest(root, file, true).entries.map(e => e.relPath)
          break
        } catch { /* Unknown targets must block writes, never mean no conflicts. */ }
      }
      records.push({ id: name, reason: '隔离记录无法读取，请先核对保留的事务证据', targets, quarantinedAt: '', location: `${QUARANTINE_DIR}/${name}` })
    }
  }
  return records
}

export class TransactionConflictError extends Error {
  readonly code = 'transaction-conflict'
  constructor(message: string, readonly records: readonly QuarantineRecord[]) {
    super(message)
    this.name = 'TransactionConflictError'
  }
}

/** 恢复书仓内所有未完成批次；新出现的冲突批次被隔离后报告一次。 */
export function recoverTransactions(bookRoot: string): void {
  withBookLock(bookRoot, () => {
    const conflicts = recoverLocked(canonicalizePath(bookRoot))
    if (conflicts.length > 0) throw conflictError(conflicts)
  })
}

function conflictError(records: readonly QuarantineRecord[]): TransactionConflictError {
  const first = records[0]!
  return new TransactionConflictError(`事务恢复冲突或无法恢复：${first.reason}。该批次已移到 ${first.location}，备份已保留。${records.some(record => record.targets === null) ? '目标未知，所有写入暂停' : '未涉及隔离目标的文件可以继续写入'}`, records)
}

function recoverLocked(root: string): QuarantineRecord[] {
  finishQuarantines(root)
  const dir = path.join(root, TRANSACTION_DIR)
  if (!fs.existsSync(dir)) return []
  inside(root, TRANSACTION_DIR)
  const conflicts: QuarantineRecord[] = []
  for (const id of fs.readdirSync(dir)) {
    const txDir = path.join(dir, id)
    if (/^[A-Za-z0-9_-]+\.(done|preparing)$/.test(id)) {
      try { removeSync(txDir) } catch { /* Settled or not yet published. */ }
      continue
    }
    let manifest: TransactionManifest
    try {
      if (!fs.lstatSync(txDir).isDirectory()) throw new Error(`事务目录非法：${id}`)
      const file = path.join(txDir, 'manifest.json')
      if (!fs.existsSync(file)) throw new Error(`事务清单缺失：${id}`)
      manifest = parseManifest(root, file)
    } catch (err) {
      // Without a readable manifest nothing can be restored; keep the evidence aside.
      conflicts.push(quarantine(root, txDir, id, err instanceof Error ? err.message : String(err), null))
      continue
    }
    try {
      if (manifest.phase === 'committed') cleanupTransaction(root, manifest.id, manifest.entries)
      else rollbackTransaction(root, manifest)
    } catch (err) {
      conflicts.push(quarantine(root, txDir, id, err instanceof Error ? err.message : String(err), manifest.entries.map((entry) => entry.relPath)))
    }
  }
  return conflicts
}

export function assertWritableTargets(bookRoot: string, relPaths: readonly string[]): void {
  const root = canonicalizePath(bookRoot)
  const identity = (rel: string): string => {
    const canonical = canonicalizePath(inside(root, safeRel(rel)))
    return process.platform === 'win32' ? canonical.toLowerCase() : canonical
  }
  const requested = new Set(relPaths.map(identity))
  const blocked = listQuarantined(root).filter((record) => record.targets === null || record.targets.some((target) => requested.has(identity(target))))
  if (blocked.length === 0) return
  const record = blocked[0]!
  throw new TransactionConflictError(`目标文件属于已隔离的冲突事务，暂不能写入：${record.targets === null ? '隔离事务的目标未知，所有写入暂停' : relPaths.join('、')}。请先核对 ${record.location} 中的备份，处理后删除该目录`, blocked)
}

/** 创建、执行并在成功后提交一个多文件事务。 */
export function runTransaction(
  bookRoot: string,
  ops: readonly { readonly relPath: string; readonly content: string }[],
  options: TransactionOptions = {},
): void {
  withBookLock(bookRoot, () => {
    const root = canonicalizePath(bookRoot)
    recoverLocked(root)
    const relPaths = ops.map((op) => safeRel(op.relPath))
    assertWritableTargets(root, relPaths)
    runLocked(root, ops, options)
  }, { ...options.provenance, targets: ops.map((op) => op.relPath) })
}

function runLocked(root: string, ops: readonly { readonly relPath: string; readonly content: string }[], options: TransactionOptions): void {
  if (ops.length === 0) return
  const id = `${Date.now().toString(36)}-${process.pid}-${randomBytes(5).toString('hex')}`
  const normalized = ops.map((op) => ({ relPath: safeRel(op.relPath), content: op.content }))
  for (const op of normalized) {
    const first = op.relPath.split('/')[0]?.toLowerCase()
    if (first === RUNTIME_DIR || first === '.git') throw new Error(`事务目标为保留路径：${op.relPath}`)
    inside(root, op.relPath)
  }
  if (new Set(normalized.map((op) => op.relPath)).size !== normalized.length) {
    throw new Error('事务目标路径重复')
  }
  const txRoot = path.join(root, TRANSACTION_DIR, id)
  inside(root, TRANSACTION_DIR)
  const preparing = `${txRoot}.preparing`
  fs.mkdirSync(path.join(preparing, 'backups'), { recursive: true })
  let entries: ManifestEntry[] = normalized.map((op, index) => {
    const relPath = op.relPath
    const dest = inside(root, relPath)
    const tmp = path.join(path.dirname(dest), `.webnovel-txn-${id}-${index}.tmp`)
    return {
      relPath,
      tmpRel: path.relative(root, tmp).split(path.sep).join('/'),
      backupRel: path.join(TRANSACTION_DIR, id, 'backups', `${index}.bak`).split(path.sep).join('/'),
      contentHash: createHash('sha256').update(op.content, 'utf-8').digest('hex'),
      originalHash: null,
      hadOriginal: false,
      backupRecorded: false,
      applied: false,
    }
  })
  let manifest: TransactionManifest = {
    schemaVersion: 1,
    id,
    createdAt: new Date().toISOString(),
    phase: 'staged',
    entries,
    provenance: options.provenance ?? currentBookProvenance(root),
  }
  writeManifest(path.join(preparing, 'manifest.json'), manifest)
  renameSync(preparing, txRoot)
  syncAncestors(root, txRoot)
  try {
    for (let i = 0; i < normalized.length; i += 1) {
      const dest = inside(root, entries[i]!.relPath)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      syncAncestors(root, path.dirname(dest))
      writeDurable(inside(root, entries[i]!.tmpRel), normalized[i]!.content)
    }
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]!
      const dest = inside(root, entry.relPath)
      const exists = fs.existsSync(dest)
      if (exists && !fs.lstatSync(dest).isFile()) throw new Error(`事务目标不是普通文件：${entry.relPath}`)
      if (exists) {
        writeDurable(inside(root, entry.backupRel), fs.readFileSync(dest))
        syncDir(path.dirname(inside(root, entry.backupRel)))
      }
      const originalHash = exists ? createHash('sha256').update(fs.readFileSync(inside(root, entry.backupRel))).digest('hex') : null
      entries = entries.map((candidate, index) => index === i
        ? { ...candidate, hadOriginal: exists, backupRecorded: true, originalHash }
        : candidate)
      manifest = updateManifest(root, manifest, { phase: i === entries.length - 1 ? 'backed-up' : 'staged', entries })
    }
    manifest = updateManifest(root, manifest, { phase: 'applying', entries })
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]!
      entries = entries.map((candidate, index) => index === i ? { ...candidate, applied: true } : candidate)
      manifest = updateManifest(root, manifest, { entries })
      publish(inside(root, entry.tmpRel), inside(root, entry.relPath))
    }
    manifest = updateManifest(root, manifest, { phase: 'committed', entries })
    cleanupTransaction(root, id, entries)
  } catch (err) {
    if (manifest.phase === 'committed') return
    // The commit-marker rename can succeed before its directory fsync fails.
    // Never roll back behind a committed marker: a later crash would otherwise
    // make recovery accept a partially rolled-back batch as committed.
    const published = parseManifest(root, manifestPath(root, id))
    if (published.phase === 'committed') throw new Error('事务内容已写入，但持久化确认失败。事务清单已保留，请核对磁盘后重试恢复', { cause: err })
    try { rollbackTransaction(root, manifest) } catch (rollbackErr) {
      throw new Error(`事务写入失败且恢复失败：${err instanceof Error ? err.message : String(err)};${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`, { cause: err })
    }
    throw new Error(`事务写入失败(已恢复):${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }
}

/** 让脚手架/诊断代码知道运行时目录属于本插件。 */
export function runtimeIgnoreLine(): string {
  return `${RUNTIME_DIR}/`
}

/** 书仓运行目录诊断：残留锁与隔离批次（只读，不改任何文件）。 */
export function diagnoseBookRuntime(bookRoot: string): string[] {
  const notes: string[] = []
  const runtime = path.join(bookRoot, RUNTIME_DIR)
  const guard = path.join(runtime, 'acquire.lock')
  const lock = path.join(runtime, 'book.lock')
  if (fs.existsSync(guard) && lockIsStale(guard, GUARD_STALE_MS)) notes.push('残留 .webnovel/acquire.lock：下次写入时会自动回收')
  if (fs.existsSync(lock) && lockIsStale(lock)) notes.push('残留 .webnovel/book.lock：持有进程已退出，下次写入时会自动回收')
  for (const record of listQuarantined(bookRoot)) {
    const targets = record.targets === null ? '目标未知' : `涉及 ${record.targets.join('、')}`
    notes.push(`隔离的事务 ${record.location}（${targets}）：${record.reason}。请作者核对其中的备份，处理后删除该目录`)
  }
  return notes
}
