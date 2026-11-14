/** Durable evidence of an archive's exact write batch; never a source of book state. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { canonicalizePath, isInsidePath } from '../gate/canonical'
import type { FileOp } from '../repo/atomic'
import { checkCommitPath } from './paths'
import { runGit } from './git'
import { 待定稿包七件 } from '../prepare/pack'
import { paths } from '../repo/paths'
import { parseDocument } from '../repo/frontmatter'
import { assertDraftRetentionAnchor, assertDraftRetentionBinding, parseDraftRetention, type DraftRetentionManifest } from '../repo/draft-retention'
import { addDraftRetentionAnchor } from '../repo/retention-anchor'

export const ARCHIVE_RECEIPT_DIR = '草稿区/.archive-receipts'
const HASH = /^[a-f0-9]{64}$/
const OBJECT = /^[a-f0-9]{40,64}$/

export interface ArchiveOutput {
  readonly relPath: string
  readonly sha256: string
  readonly gitBlob: string
}

export interface ArchiveOutputWithBefore extends ArchiveOutput {
  readonly beforeGitBlob: string | null
}

interface ReceiptIdentity {
  readonly scope: string
  readonly request: string
  readonly message: string
  readonly baseHead: string | null
}

export interface DraftRetentionOrigin {
  readonly head: string
  readonly chapterGitBlob: string
  readonly summaryPath: string
  readonly summaryGitBlob: string
}

type LegacyArchiveReceipt = ReceiptIdentity & (
  | { readonly schema: 1; readonly mode: 'ch' | 'retcon'; readonly outputs: readonly ArchiveOutput[] }
  | { readonly schema: 2; readonly mode: 'retcon'; readonly outputs: readonly ArchiveOutput[]; readonly retcon: {
    readonly chapter: string
    readonly packageDir: string | null
    readonly inputs: Readonly<Record<string, string | null>>
  } }
)

export type DraftRetentionReceipt = ReceiptIdentity & {
  readonly schema: 3
  readonly retention: DraftRetentionManifest
  readonly outputs: readonly ArchiveOutputWithBefore[]
} & (
  | { readonly kind: 'archive'; readonly mode: 'ch' }
  | { readonly kind: 'retention'; readonly mode: 'retention'; readonly origin: DraftRetentionOrigin }
)

export type ArchiveReceipt = LegacyArchiveReceipt | DraftRetentionReceipt

type ArchiveIdentity = Pick<ReceiptIdentity, 'scope' | 'request' | 'message'> & { readonly mode: 'ch' | 'retcon' }

const PACKAGE_INPUTS = [...待定稿包七件, '清单.json']

const retainedChapter = (manifest: DraftRetentionManifest): string => paths.定稿章(manifest.chapter.卷, manifest.chapter.章, manifest.chapter.章名)
const retainedSummary = (manifest: DraftRetentionManifest): string => paths.章摘要(manifest.chapter.卷, manifest.chapter.章, manifest.chapter.章名)

/** Fixed object queries only; never refresh the index or fetch missing objects. */
function receiptGit(root: string, args: readonly string[]) {
  return runGit(root, ['--no-optional-locks', '--no-lazy-fetch', '--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', ...args], {
    GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0',
  })
}

export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : entry)
}

export function retconRequestScope(chapter: string, request: string): string {
  // Stored identities must remain verifiable when a book moves between OSes.
  return contentHash(stableJson({ kind: 'retcon-tool-v1', chapter, request }))
}

/** Windows aliases must not turn one missing/modified target into a fresh request. */
export function archivePathIdentity(relative: string): string {
  return process.platform === 'win32' ? relative.toLowerCase() : relative
}

/** Exact original package bytes, including absent optional files. */
export function retconPackageInputs(root: string, packageDir: string | null): Record<string, string | null> {
  if (packageDir === null) return {}
  return Object.fromEntries(PACKAGE_INPUTS.map(name => {
    const file = archiveFile(root, `${packageDir}/${name}`)
    try { return [name, contentHash(fs.readFileSync(file))] } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return [name, null]
    }
  }))
}

export function contentHash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Reject links on every component, including the protected receipt directory. */
export function archiveFile(root: string, relative: string): string {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..') || /[:\0]/.test(relative)) {
    throw new Error(`归档路径非法：${relative}`)
  }
  const target = path.resolve(root, relative)
  if (!isInsidePath(root, target)) throw new Error(`归档路径越出书仓：${relative}`)
  let current = root
  const parts = relative.split(/[\\/]/)
  for (let i = 0; i < parts.length; i += 1) {
    current = path.join(current, parts[i]!)
    try {
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) {
        throw new Error(`归档路径必须是普通文件且不得经过链接：${relative}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return target
}

export function receiptRelative(scope: string): string {
  if (!HASH.test(scope)) throw new Error('归档收据范围非法')
  return `${ARCHIVE_RECEIPT_DIR}/${scope}.json`
}

export function archiveScope(root: string, packageAbs: string | null, mode: 'ch' | 'retcon', targets: readonly string[]): string {
  const packageIdentity = packageAbs === null ? null : path.relative(canonicalizePath(root), canonicalizePath(packageAbs)).split(path.sep).join('/')
  if (packageIdentity !== null && (!packageIdentity || packageIdentity.split('/').includes('..') || path.isAbsolute(packageIdentity))) {
    throw new Error('待定稿包必须位于书仓内')
  }
  return contentHash(JSON.stringify({ mode, package: packageIdentity, targets: packageIdentity === null ? [...targets].sort() : undefined }))
}

function validateRetentionReceipt(receipt: DraftRetentionReceipt): void {
  const keys = ['schema', 'kind', 'mode', 'scope', 'request', 'message', 'baseHead', 'outputs', 'retention', ...(receipt.kind === 'retention' ? ['origin'] : [])]
  if (Object.keys(receipt).length !== keys.length || keys.some(key => !Object.hasOwn(receipt, key))) throw new Error('留档收据协议字段非法')
  const manifest = parseDraftRetention(receipt.retention)
  if ((receipt.kind !== 'archive' && receipt.kind !== 'retention')
    || receipt.mode !== (receipt.kind === 'archive' ? 'ch' : 'retention')) throw new Error('留档收据种类非法')
  if (receipt.outputs.some(output => Object.keys(output).length !== 4 || !Object.hasOwn(output, 'beforeGitBlob')
    || (output.beforeGitBlob !== null && !OBJECT.test(output.beforeGitBlob)))) throw new Error('留档收据缺少有效提交前态')
  if (!receipt.outputs.some(output => output.beforeGitBlob !== output.gitBlob)) throw new Error('留档收据没有实际输出变化')
  if (receipt.baseHead === null && receipt.outputs.some(output => output.beforeGitBlob !== null)) throw new Error('留档收据无基线却声明已有输出')
  const chapter = retainedChapter(manifest), summary = retainedSummary(manifest)
  const chapterOutput = receipt.outputs.find(output => output.relPath === chapter)
  if (!chapterOutput || receipt.outputs.some(output => output.relPath.startsWith('定稿/') && output.relPath !== chapter)) throw new Error('留档收据与定稿章节不一致')
  if (receipt.kind === 'archive') {
    const summaryOutput = receipt.outputs.find(output => output.relPath === summary)
    if (!summaryOutput || chapterOutput.beforeGitBlob !== null || summaryOutput.beforeGitBlob !== null) throw new Error('新归档须同时新建本章定稿与章摘要')
  } else {
    const origin = receipt.origin
    if (receipt.outputs.length !== 1 || !origin || !OBJECT.test(origin.head) || origin.head !== receipt.baseHead
      || !OBJECT.test(origin.chapterGitBlob) || origin.chapterGitBlob !== chapterOutput.beforeGitBlob
      || origin.summaryPath !== summary || !OBJECT.test(origin.summaryGitBlob)
      || Object.keys(origin).length !== 4) throw new Error('旧章留档的原归档证据非法')
  }
}

export function readArchiveReceipt(root: string, scope: string): ArchiveReceipt | undefined {
  const file = archiveFile(root, receiptRelative(scope))
  let text: string
  try { text = fs.readFileSync(file, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    const envelope = JSON.parse(text) as { checksum?: unknown; receipt?: ArchiveReceipt }
    const receipt = envelope.receipt
    if (!receipt || envelope.checksum !== contentHash(JSON.stringify(receipt))
      || (receipt.schema !== 1 && receipt.schema !== 2 && receipt.schema !== 3) || receipt.scope !== scope || !HASH.test(receipt.request)
      || (receipt.mode !== 'ch' && receipt.mode !== 'retcon' && receipt.mode !== 'retention') || typeof receipt.message !== 'string'
      || (receipt.baseHead !== null && !OBJECT.test(receipt.baseHead))
      || !Array.isArray(receipt.outputs) || !receipt.outputs.length) throw new Error('格式或校验失败')
    if (receipt.schema !== 3 && (String(receipt.mode) === 'retention' || Object.hasOwn(receipt, 'retention'))) throw new Error('留档证据不能使用旧收据格式')
    const outputPaths = new Set<string>()
    const identities = new Set<string>()
    for (const output of receipt.outputs) {
      const checked = checkCommitPath(root, output.relPath)
      const identity = output.relPath.normalize('NFC').toLowerCase()
      if (!checked.ok || checked.relPath !== output.relPath || outputPaths.has(output.relPath)
        || (receipt.schema === 3 && (identities.has(identity) || path.posix.normalize(output.relPath) !== output.relPath))
        || !HASH.test(output.sha256) || !OBJECT.test(output.gitBlob)) throw new Error('目标清单非法')
      archiveFile(root, output.relPath)
      outputPaths.add(output.relPath)
      identities.add(identity)
    }
    if (receipt.schema === 2) {
      const evidence = receipt.retcon
      if (!evidence || receipt.mode !== 'retcon' || !outputPaths.has(evidence.chapter)
        || !/^定稿\/卷\d+\/\d{4,}-.+\.md$/.test(evidence.chapter)
        || scope !== retconRequestScope(evidence.chapter, receipt.request)
        || (evidence.packageDir !== null && evidence.packageDir !== `草稿区/提案/retcon-${scope}`)
        || !evidence.inputs || typeof evidence.inputs !== 'object' || Array.isArray(evidence.inputs)) throw new Error('吃书请求证据非法')
      const names = evidence.packageDir === null ? [] : PACKAGE_INPUTS
      if (Object.keys(evidence.inputs).length !== names.length || names.some(name => !Object.hasOwn(evidence.inputs, name)
        || (evidence.inputs[name] !== null && !HASH.test(evidence.inputs[name]!)))) throw new Error('吃书包输入证据非法')
    }
    if (receipt.schema === 3) validateRetentionReceipt(receipt)
    return receipt
  } catch (error) {
    throw new Error(`归档收据损坏，已保留：${error instanceof Error ? error.message : String(error)}。请把情况呈报作者，并核对 草稿区/.archive-receipts/ 中的收据`)
  }
}

/** Enumerating is only for explicit writes; corrupt evidence must never become a cache miss. */
export function listArchiveReceipts(root: string): ArchiveReceipt[] {
  // Validate the directory components even when it contains no receipts.
  archiveFile(root, `${ARCHIVE_RECEIPT_DIR}/.probe`)
  let names: string[]
  try { names = fs.readdirSync(path.join(root, ARCHIVE_RECEIPT_DIR)) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return names.map(name => {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error(`归档收据损坏，保留未知文件：${name}`)
    const receipt = readArchiveReceipt(root, name.slice(0, -5))
    if (!receipt) throw new Error(`归档收据已消失：${name}。请把情况呈报作者，不要重复调用`)
    return receipt
  })
}

export function verifyArchiveOutputs(root: string, receipt: ArchiveReceipt): void {
  for (const output of receipt.outputs) {
    const file = archiveFile(root, output.relPath)
    let current: string | undefined
    try { current = contentHash(fs.readFileSync(file)) } catch { /* Missing also conflicts. */ }
    if (current !== output.sha256) throw new Error(`归档收据目标冲突，保留作者修改：${output.relPath}`)
  }
}

export interface ArchiveCommitReader {
  blob(commit: string, relative: string): string | undefined
  parents(commit: string): readonly string[]
  text(blob: string): string
}

const ancestryCache = new WeakMap<ArchiveCommitReader, Map<string, boolean>>()

function ancestorOf(ancestor: string, commit: string, reader: ArchiveCommitReader): boolean {
  if (ancestor === commit) return true
  let cache = ancestryCache.get(reader)
  if (cache === undefined) { cache = new Map(); ancestryCache.set(reader, cache) }
  const key = `${ancestor}:${commit}`, cached = cache.get(key)
  if (cached !== undefined) return cached
  const pending = [commit], seen = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()!
    if (current === ancestor) { cache.set(key, true); return true }
    if (seen.has(current)) continue
    seen.add(current)
    pending.push(...reader.parents(current))
  }
  cache.set(key, false)
  return false
}

function assertRetentionMetadataOnly(before: string, after: string): void {
  const next = parseDocument(after)
  const digest = next.ok ? next.data.fields['草稿留档摘要'] : undefined
  if (typeof digest !== 'string' || after !== addDraftRetentionAnchor(before, digest)) {
    throw new Error('旧章留档确认只能新增留档摘要，原有元数据和正文必须保留')
  }
}

/** The caller owns history selection; this verifies one actual before/after commit pair. */
export function archiveCommitMatches(receipt: ArchiveReceipt, commit: string, reader: ArchiveCommitReader): boolean {
  if (!receipt.outputs.every(output => reader.blob(commit, output.relPath) === output.gitBlob)) return false
  if (receipt.schema !== 3) return true
  validateRetentionReceipt(receipt)
  const parents = reader.parents(commit)
  if (parents.length > 1 || (parents.length === 0 && receipt.baseHead !== null)) return false
  const parent = parents[0]
  if (receipt.baseHead !== null && (parent === undefined || !ancestorOf(receipt.baseHead, parent, reader))) return false
  if (!receipt.outputs.every(output => (parent === undefined ? null : reader.blob(parent, output.relPath) ?? null) === output.beforeGitBlob
    && (receipt.baseHead === null ? null : reader.blob(receipt.baseHead, output.relPath) ?? null) === output.beforeGitBlob)) return false
  const chapter = retainedChapter(receipt.retention)
  const output = receipt.outputs.find(item => item.relPath === chapter)!
  const afterText = reader.text(output.gitBlob)
  const beforeText = receipt.kind === 'retention' ? reader.text(receipt.origin.chapterGitBlob) : undefined
  try {
    if (receipt.kind === 'archive') assertDraftRetentionBinding(afterText, receipt.retention)
    else {
      if (parent === undefined || reader.blob(parent, receipt.origin.summaryPath) !== receipt.origin.summaryGitBlob
        || reader.blob(receipt.origin.head, receipt.origin.summaryPath) !== receipt.origin.summaryGitBlob) return false
      assertDraftRetentionAnchor(afterText, receipt.retention)
      assertRetentionMetadataOnly(beforeText!, afterText)
    }
  } catch { return false }
  return true
}

class ReceiptCommitReader implements ArchiveCommitReader {
  private readonly trees = new Map<string, ReadonlyMap<string, { blob: string; regular: boolean }>>()
  private readonly lineage = new Map<string, readonly string[]>()
  private readonly contents = new Map<string, string>()
  constructor(private readonly root: string) {}

  private command(args: readonly string[]): string {
    const result = receiptGit(this.root, args)
    if (result.status !== 0) throw new Error('无法只读核对归档提交历史')
    return result.stdout
  }

  blob(commit: string, relative: string): string | undefined {
    if (!this.trees.has(commit)) {
      const tree = new Map<string, { blob: string; regular: boolean }>()
      for (const row of this.command(['ls-tree', '-r', '-z', commit]).split('\0').filter(Boolean)) {
        const match = /^(\d+) (?:blob|commit) ([a-f0-9]{40,64})\t([\s\S]+)$/.exec(row)
        if (!match) throw new Error('归档提交树返回了无法识别的文件证据')
        tree.set(match[3]!, { blob: match[2]!, regular: match[1] === '100644' || match[1] === '100755' })
      }
      this.trees.set(commit, tree)
    }
    const item = this.trees.get(commit)!.get(relative)
    if (item !== undefined && !item.regular) throw new Error(`归档提交目标不是普通文件：${relative}`)
    return item?.blob
  }

  parents(commit: string): readonly string[] {
    if (!this.lineage.has(commit)) {
      const parts = this.command(['rev-list', '--parents', '-n', '1', commit]).trim().split(/\s+/)
      if (parts[0] !== commit || parts.some(part => !OBJECT.test(part))) throw new Error('归档提交父树证据非法')
      this.lineage.set(commit, parts.slice(1))
    }
    return this.lineage.get(commit)!
  }

  text(blob: string): string {
    if (!this.contents.has(blob)) this.contents.set(blob, this.command(['cat-file', 'blob', blob]))
    return this.contents.get(blob)!
  }
}

/** Return the matching commit, including a one-batch manual retry with a different message. */
export function archiveReceiptCommit(root: string, receipt: ArchiveReceipt): string | undefined {
  const head = receiptGit(root, ['rev-parse', '--verify', 'HEAD'])
  if (head.status !== 0) {
    if (receipt.baseHead !== null) throw new Error('归档收据的提交历史已改变（可能有人改写了 Git 历史）。请把情况呈报作者，不要重复调用')
    return undefined
  }
  if (receipt.baseHead !== null) {
    const ancestor = receiptGit(root, ['merge-base', '--is-ancestor', receipt.baseHead, head.stdout.trim()])
    if (ancestor.status !== 0) throw new Error('归档收据的提交历史已改变（可能有人改写了 Git 历史）。请把情况呈报作者，不要重复调用')
  }
  const history = receiptGit(root, ['rev-list', receipt.baseHead === null ? head.stdout.trim() : `${receipt.baseHead}..${head.stdout.trim()}`])
  if (history.status !== 0) throw new Error('无法只读核对归档提交历史')
  const reader = new ReceiptCommitReader(root)
  for (const commit of history.stdout.trim().split('\n').filter(Boolean)) {
    if (archiveCommitMatches(receipt, commit, reader)) return commit
  }
  return undefined
}

export function archiveReceiptCommitted(root: string, receipt: ArchiveReceipt): boolean {
  return archiveReceiptCommit(root, receipt) !== undefined
}

function receiptHead(root: string): string | null {
  const head = receiptGit(root, ['rev-parse', '--verify', 'HEAD'])
  if (head.status === 0 && OBJECT.test(head.stdout.trim())) return head.stdout.trim()
  const symbolic = receiptGit(root, ['symbolic-ref', '--quiet', 'HEAD'])
  if (symbolic.status === 0 && /^refs\/heads\/\S+$/.test(symbolic.stdout.trim())
    && receiptGit(root, ['show-ref', '--verify', '--quiet', symbolic.stdout.trim()]).status === 1) return null
  throw new Error('无法核实归档提交基线，本次没有写入')
}

/** A pending strong batch cannot consume a partially committed or externally changed before-state. */
export function verifyArchiveBeforeCommit(root: string, receipt: DraftRetentionReceipt): void {
  const head = receiptHead(root), reader = new ReceiptCommitReader(root)
  if (receipt.baseHead !== null && (head === null || !ancestorOf(receipt.baseHead, head, reader))) throw new Error('归档提交基线已变化，保留待提交输出')
  if (!receipt.outputs.every(output => (head === null ? null : reader.blob(head, output.relPath) ?? null) === output.beforeGitBlob
    && (receipt.baseHead === null ? null : reader.blob(receipt.baseHead, output.relPath) ?? null) === output.beforeGitBlob)) {
    throw new Error('归档输出已被分批提交或提交前态已变化，无法补成原次同批提交；已保留文件与收据')
  }
  if (receipt.kind === 'retention' && (head === null || reader.blob(head, receipt.origin.summaryPath) !== receipt.origin.summaryGitBlob)) {
    throw new Error('旧章摘要提交前态已变化，保留留档确认收据')
  }
}

function archiveOutputs(root: string, ops: readonly FileOp[], extraPaths: readonly string[]): ArchiveOutput[] {
  const contents = [...ops, ...extraPaths.map(relPath => ({ relPath, content: fs.readFileSync(archiveFile(root, relPath)) }))]
  return contents.map(({ relPath, content }): ArchiveOutput => {
    archiveFile(root, relPath)
    // Git clean filters/newline normalization can differ from the bytes on disk.
    const blob = spawnSync('git', ['hash-object', `--path=${relPath}`, '--stdin'], {
      cwd: root, input: content, encoding: 'utf8', windowsHide: true,
    })
    if (blob.status !== 0 || !OBJECT.test(blob.stdout.trim())) throw new Error(`无法计算归档提交指纹：${relPath}`)
    return { relPath, sha256: contentHash(content), gitBlob: blob.stdout.trim() }
  })
}

export function makeArchiveReceipt(
  root: string,
  identity: ArchiveIdentity,
  ops: readonly FileOp[],
  extraPaths: readonly string[],
  retention?: DraftRetentionManifest,
): ArchiveReceipt {
  const baseHead = receiptHead(root)
  const outputs = archiveOutputs(root, ops, extraPaths)
  if (retention === undefined) {
    if (identity.mode === 'ch' && ops.some(op => {
      if (!op.relPath.startsWith('定稿/')) return false
      const doc = parseDocument(op.content)
      return doc.ok && Object.hasOwn(doc.data.fields, '草稿留档摘要')
    })) throw new Error('定稿已有留档摘要但缺少准备时的完整清单，不能回退旧归档格式')
    return { schema: 1, ...identity, baseHead, outputs }
  }
  if (identity.mode !== 'ch') throw new Error('新的定稿留档清单只能随原次定稿归档')
  const manifest = parseDraftRetention(retention)
  const chapter = ops.find(op => op.relPath === retainedChapter(manifest))
  if (!chapter) throw new Error('留档清单缺少对应定稿输出')
  assertDraftRetentionBinding(chapter.content, manifest)
  const reader = new ReceiptCommitReader(root)
  const receipt: DraftRetentionReceipt = {
    schema: 3, ...identity, mode: 'ch', kind: 'archive', baseHead, retention: manifest,
    outputs: outputs.map(output => ({ ...output, beforeGitBlob: baseHead === null ? null : reader.blob(baseHead, output.relPath) ?? null })),
  }
  validateRetentionReceipt(receipt)
  return receipt
}

/** Build evidence only. The explicit old-book service owns approval, atomic write and commit. */
export function makeDraftRetentionReceipt(
  root: string,
  identity: Pick<ReceiptIdentity, 'scope' | 'request' | 'message'>,
  op: FileOp,
  retention: DraftRetentionManifest,
  origin: DraftRetentionOrigin,
): Extract<DraftRetentionReceipt, { readonly kind: 'retention' }> {
  const baseHead = receiptHead(root), manifest = parseDraftRetention(retention)
  if (baseHead === null || baseHead !== origin.head || op.relPath !== retainedChapter(manifest)) throw new Error('旧章留档的归档基线或章节不一致')
  assertDraftRetentionAnchor(op.content, manifest)
  assertRetentionMetadataOnly(fs.readFileSync(archiveFile(root, op.relPath), 'utf8'), op.content)
  const reader = new ReceiptCommitReader(root)
  if (reader.blob(baseHead, op.relPath) !== origin.chapterGitBlob || reader.blob(baseHead, origin.summaryPath) !== origin.summaryGitBlob) throw new Error('旧章留档的原提交内容不一致')
  const receipt: Extract<DraftRetentionReceipt, { readonly kind: 'retention' }> = {
    schema: 3, kind: 'retention', mode: 'retention', ...identity, baseHead, retention: manifest, origin,
    outputs: archiveOutputs(root, [op], []).map(output => ({ ...output, beforeGitBlob: origin.chapterGitBlob })),
  }
  validateRetentionReceipt(receipt)
  return receipt
}

export function archiveReceiptOp(receipt: ArchiveReceipt): FileOp {
  return { relPath: receiptRelative(receipt.scope), content: JSON.stringify({ checksum: contentHash(JSON.stringify(receipt)), receipt }) + '\n' }
}
