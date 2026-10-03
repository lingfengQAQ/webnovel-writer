import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { canonicalizePath } from '../gate/canonical'
import { withBookWrite, writeBatchAtomic, type FileOp } from '../repo/atomic'
import { removeSync } from '../repo/remove'
import { PARSE_VERSION, REFERENCE_LIMITS, ReferenceError, type ParsedSource, type ParseOptions, type ReferenceManifest, type SourceMetadata } from './types'
import { parseTxt } from './txt'
import { parseEpub } from './epub'

export const referenceHash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
export const referenceJson = (value: unknown): string => JSON.stringify(value, null, 2) + '\n'
export const isHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export function referenceId(value: string): string {
  if (!/^(?:ref|m|b|p|ev)-[a-f0-9]{20,64}$/.test(value)) throw new ReferenceError('invalid-id', '参考资料身份无效')
  return value
}
/** Service-owned paths: reject aliases/links, including hard-linked files. */
export function referencePath(base: string, relative: string): string {
  const parts = relative.split('/')
  if (!relative || parts.some(p => !p || p === '..' || p === '.' || /[\\:\x00-\x1f]/.test(p) || /[. ]$/.test(p))) throw new ReferenceError('unsafe-path', '参考库路径无效')
  const root = canonicalizePath(base)
  let current = root
  for (const part of parts) {
    current = path.join(current, part)
    try {
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1) || canonicalizePath(current) !== current) throw new ReferenceError('unsafe-path', '参考库不接受链接、硬链接或路径别名')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return current
}
export function referenceRoot(workspace: string, sourceId: string): string {
  referenceId(sourceId)
  if (!sourceId.startsWith('ref-')) throw new ReferenceError('invalid-id', '参考书身份无效')
  return referencePath(workspace, `书房/参考书/${sourceId}`)
}
export function referenceRead(root: string, relative: string, maxBytes = REFERENCE_LIMITS.expandedBytes * 2): string {
  const filename = referencePath(root, relative)
  const before = fs.lstatSync(filename)
  if (!before.isFile() || before.size > maxBytes) throw new ReferenceError('invalid-file', '参考库文件类型或大小异常')
  const handle = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    const opened = fs.fstatSync(handle)
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.nlink !== 1) throw new ReferenceError('source-changed', '参考文件在读取期间变化')
    const bytes = fs.readFileSync(handle)
    const after = fs.lstatSync(referencePath(root, relative)), finished = fs.fstatSync(handle)
    if (after.ino !== opened.ino || after.dev !== opened.dev || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || finished.ctimeMs !== opened.ctimeMs || bytes.length > maxBytes) throw new ReferenceError('source-changed', '参考文件在读取期间变化')
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } finally { fs.closeSync(handle) }
}
export function referenceWrite(root: string, ops: readonly FileOp[]): void {
  for (const op of ops) referencePath(root, op.relPath)
  referencePath(root, '.webnovel/transactions')
  writeBatchAtomic(root, ops)
}
export function referenceLocked<T>(workspace: string, sourceId: string, operation: (root: string) => T): T {
  const root = referenceRoot(workspace, sourceId)
  referencePath(root, '.webnovel/transactions')
  return withBookWrite(root, () => operation(root))
}
export function readReferenceManifest(root: string): ReferenceManifest {
  try {
    const pending = referencePath(root, '.webnovel/transactions')
    if (fs.existsSync(pending) && fs.readdirSync(pending).length) throw new ReferenceError('recovery-required', '参考库有未完成事务，请先显式恢复再读取')
    const value = JSON.parse(referenceRead(root, '.analysis/manifest.json', 16 * 1024 * 1024)) as ReferenceManifest
    if (value.schemaVersion !== 1 || !isHash(value.currentRevision) || !value.revisions[value.currentRevision]) throw new Error('schema')
    referenceId(value.id)
    validateMetadata(value.metadata)
    for (const [id, revision] of Object.entries(value.revisions)) if (!isHash(id) || !isHash(revision.sourceHash) || !isHash(revision.parsedHash) || revision.parseVersion !== PARSE_VERSION) throw new Error('revision')
    for (const [id, batch] of Object.entries(value.batches)) {
      referenceId(id)
      if (batch.id !== id || !['pending', 'running', 'completed', 'failed', 'stale'].includes(batch.state) || (batch.resultHash && !isHash(batch.resultHash))) throw new Error('batch')
      if (batch.dependency) { referenceId(batch.dependency.id); if (!isHash(batch.dependency.hash)) throw new Error('dependency') }
    }
    for (const [id, plan] of Object.entries(value.plans)) { referenceId(id); if (plan.id !== id || !isHash(plan.revision) || !isHash(plan.metadataHash) || !Array.isArray(plan.batches)) throw new Error('plan'); plan.batches.forEach(referenceId) }
    for (const [id, versions] of Object.entries(value.mechanisms)) {
      referenceId(id)
      for (const item of versions) if (item.id !== id || !Number.isSafeInteger(item.version) || item.version < 1 || !isHash(item.hash) || !isHash(item.revision) || !isHash(item.resultHash)) throw new Error('mechanism')
    }
    return value
  } catch (error) {
    if (error instanceof ReferenceError) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ReferenceError('not-found', '参考库不存在或文件缺失')
    throw new ReferenceError('manifest-invalid', '参考库清单损坏或版本不受支持，未当作空库覆盖')
  }
}
export const manifestOp = (manifest: ReferenceManifest): FileOp => ({ relPath: '.analysis/manifest.json', content: referenceJson(manifest) })
export function readReferenceSource(root: string, manifest: ReferenceManifest): ParsedSource {
  const revision = manifest.revisions[manifest.currentRevision]!
  const prefix = `.analysis/revisions/${manifest.currentRevision}`
  const raw = referenceRead(root, prefix + '/source.base64')
  if (referenceHash(Buffer.from(raw, 'base64')) !== revision.sourceHash) throw new ReferenceError('source-corrupt', '受管原文副本校验失败')
  const text = referenceRead(root, prefix + '/parsed.json')
  if (referenceHash(text) !== revision.parsedHash) throw new ReferenceError('source-corrupt', '正文定位索引校验失败')
  try { return JSON.parse(text) as ParsedSource } catch { throw new ReferenceError('source-corrupt', '正文定位索引损坏') }
}
export function validateMetadata(metadata: SourceMetadata): void {
  for (const key of ['title', 'author', 'edition', 'acquiredFrom', 'allowedUses', 'basis'] as const) if (typeof metadata?.[key] !== 'string' || !metadata[key].trim() || metadata[key].length > 2000) throw new ReferenceError('metadata-required', '请填写作品、作者、版本、取得来源、允许用途及依据')
  if (!['user-declaration', 'checkable-license'].includes(metadata.basisKind)) throw new ReferenceError('metadata-required', '请区分用户声明与可核对许可')
}
export async function previewReference(bytes: Uint8Array, filename: string, options: ParseOptions = {}, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (bytes.length > REFERENCE_LIMITS.sourceBytes) throw new ReferenceError('source-limit', '原文件超过 64 MiB 导入限制')
  const ext = path.extname(filename).toLowerCase()
  const parsed = ext === '.txt' ? parseTxt(bytes, options) : ext === '.epub' ? await parseEpub(Buffer.from(bytes), signal) : undefined
  if (!parsed) throw new ReferenceError('unsupported-format', '小说输入只支持本地 TXT 或 EPUB')
  signal?.throwIfAborted()
  const sourceHash = referenceHash(bytes)
  const revision = referenceHash(referenceJson({ sourceHash, options, parseVersion: PARSE_VERSION }))
  return { parsed, sourceHash, revision }
}
export function referencePreviewView(preview: Awaited<ReturnType<typeof previewReference>>) {
  const { parsed, sourceHash, revision } = preview
  return { sourceHash, revision, format: parsed.format, encoding: parsed.encoding, characters: parsed.units.reduce((sum, unit) => sum + unit.text.length, 0),
    units: parsed.units.map(unit => ({ id: unit.id, title: unit.title, characters: unit.text.length, linear: unit.linear })), issues: parsed.issues }
}
export async function importReference(workspace: string, input: { bytes: Uint8Array; filename: string; metadata: SourceMetadata; options?: ParseOptions; sourceId?: string }, signal?: AbortSignal) {
  validateMetadata(input.metadata)
  const preview = await previewReference(input.bytes, input.filename, input.options, signal)
  const sourceId = input.sourceId ?? `ref-${preview.sourceHash.slice(0, 24)}`
  return referenceLocked(workspace, sourceId, root => {
    signal?.throwIfAborted()
    const file = referencePath(root, '.analysis/manifest.json')
    const manifest: ReferenceManifest = fs.existsSync(file) ? readReferenceManifest(root) : { schemaVersion: 1, id: sourceId, currentRevision: preview.revision, metadata: input.metadata, revisions: {}, plans: {}, batches: {}, mechanisms: {} }
    const old = manifest.revisions[preview.revision]
    const parsedText = referenceJson(preview.parsed)
    const operations: FileOp[] = []
    if (!old) {
      const prefix = `.analysis/revisions/${preview.revision}`
      operations.push({ relPath: prefix + '/source.base64', content: Buffer.from(input.bytes).toString('base64') }, { relPath: prefix + '/parsed.json', content: parsedText })
      manifest.revisions[preview.revision] = { sourceHash: preview.sourceHash, parsedHash: referenceHash(parsedText), options: input.options ?? {}, parseVersion: PARSE_VERSION }
    } else if (old.parsedHash !== referenceHash(parsedText)) throw new ReferenceError('parse-conflict', '相同解析版本产生不同索引，请升级解析协议后重新导入')
    if (manifest.currentRevision !== preview.revision || referenceJson(manifest.metadata) !== referenceJson(input.metadata)) {
      for (const plan of Object.values(manifest.plans)) plan.allowed = false
      for (const batch of Object.values(manifest.batches)) batch.state = 'stale'
    }
    manifest.currentRevision = preview.revision; manifest.metadata = input.metadata
    operations.push(manifestOp(manifest))
    referenceWrite(root, operations)
    readReferenceSource(root, manifest)
    return { sourceId, reused: !!old, ...referencePreviewView(preview) }
  })
}
export function listReferences(workspace: string) {
  const root = referencePath(workspace, '书房/参考书')
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root).filter(id => /^ref-[a-f0-9]{20,64}$/.test(id)).map(id => {
    try { const manifest = readReferenceManifest(referenceRoot(workspace, id)); return { sourceId: id, revision: manifest.currentRevision, metadata: manifest.metadata } }
    catch { return { sourceId: id, error: '参考库不可读取，请核对文件' } }
  })
}
export function deleteReference(workspace: string, sourceId: string): void {
  // The selected source is the entire deletion boundary; no stored source path is followed.
  const root = referenceRoot(workspace, sourceId)
  if (!fs.existsSync(root)) return
  referenceLocked(workspace, sourceId, () => {
    const walk = (relative: string) => {
      for (const entry of fs.readdirSync(referencePath(workspace, relative), { withFileTypes: true })) {
        const child = `${relative}/${entry.name}`
        referencePath(workspace, child)
        if (entry.isDirectory()) walk(child)
      }
    }
    walk(`书房/参考书/${sourceId}`)
    removeSync(root)
  })
}
