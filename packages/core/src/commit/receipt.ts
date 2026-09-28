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

export const ARCHIVE_RECEIPT_DIR = '草稿区/.archive-receipts'
const HASH = /^[a-f0-9]{64}$/
const OBJECT = /^[a-f0-9]{40,64}$/

interface Output {
  readonly relPath: string
  readonly sha256: string
  readonly gitBlob: string
}

interface ReceiptBase {
  readonly scope: string
  readonly request: string
  readonly mode: 'ch' | 'retcon'
  readonly message: string
  readonly baseHead: string | null
  readonly outputs: readonly Output[]
}

export type ArchiveReceipt = ReceiptBase & (
  | { readonly schema: 1 }
  | { readonly schema: 2; readonly retcon: {
    readonly chapter: string
    readonly packageDir: string | null
    readonly inputs: Readonly<Record<string, string | null>>
  } }
)

const PACKAGE_INPUTS = [...待定稿包七件, '清单.json']

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
    throw new Error(`归档路径非法:${relative}`)
  }
  const target = path.resolve(root, relative)
  if (!isInsidePath(root, target)) throw new Error(`归档路径越出书仓:${relative}`)
  let current = root
  const parts = relative.split(/[\\/]/)
  for (let i = 0; i < parts.length; i += 1) {
    current = path.join(current, parts[i]!)
    try {
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) {
        throw new Error(`归档路径必须是普通文件且不得经过链接:${relative}`)
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
      || (receipt.schema !== 1 && receipt.schema !== 2) || receipt.scope !== scope || !HASH.test(receipt.request)
      || (receipt.mode !== 'ch' && receipt.mode !== 'retcon') || typeof receipt.message !== 'string'
      || (receipt.baseHead !== null && !OBJECT.test(receipt.baseHead))
      || !Array.isArray(receipt.outputs) || !receipt.outputs.length) throw new Error('格式或校验失败')
    const paths = new Set<string>()
    for (const output of receipt.outputs) {
      const checked = checkCommitPath(root, output.relPath)
      if (!checked.ok || checked.relPath !== output.relPath || paths.has(output.relPath)
        || !HASH.test(output.sha256) || !OBJECT.test(output.gitBlob)) throw new Error('目标清单非法')
      archiveFile(root, output.relPath)
      paths.add(output.relPath)
    }
    if (receipt.schema === 2) {
      const evidence = receipt.retcon
      if (!evidence || receipt.mode !== 'retcon' || !paths.has(evidence.chapter)
        || !/^定稿\/卷\d+\/\d{4,}-.+\.md$/.test(evidence.chapter)
        || scope !== retconRequestScope(evidence.chapter, receipt.request)
        || (evidence.packageDir !== null && evidence.packageDir !== `草稿区/提案/retcon-${scope}`)
        || !evidence.inputs || typeof evidence.inputs !== 'object' || Array.isArray(evidence.inputs)) throw new Error('吃书请求证据非法')
      const names = evidence.packageDir === null ? [] : PACKAGE_INPUTS
      if (Object.keys(evidence.inputs).length !== names.length || names.some(name => !Object.hasOwn(evidence.inputs, name)
        || (evidence.inputs[name] !== null && !HASH.test(evidence.inputs[name]!)))) throw new Error('吃书包输入证据非法')
    }
    return receipt
  } catch (error) {
    throw new Error(`归档收据损坏，已保留，请核对后处理:${String(error)}`)
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
    if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error(`归档收据损坏，保留未知文件:${name}`)
    const receipt = readArchiveReceipt(root, name.slice(0, -5))
    if (!receipt) throw new Error(`归档收据已消失，请核对后处理:${name}`)
    return receipt
  })
}

export function verifyArchiveOutputs(root: string, receipt: ArchiveReceipt): void {
  for (const output of receipt.outputs) {
    const file = archiveFile(root, output.relPath)
    let current: string | undefined
    try { current = contentHash(fs.readFileSync(file)) } catch { /* Missing also conflicts. */ }
    if (current !== output.sha256) throw new Error(`归档收据目标冲突，保留作者修改:${output.relPath}`)
  }
}

/** Prove a post-base commit contains every exact output, including an author's manual retry. */
export function archiveReceiptCommitted(root: string, receipt: ArchiveReceipt): boolean {
  const head = runGit(root, ['rev-parse', '--verify', 'HEAD'])
  if (head.status !== 0) {
    if (receipt.baseHead !== null) throw new Error('归档收据的提交历史已改变，请核对后处理')
    return false
  }
  if (receipt.baseHead !== null) {
    const ancestor = runGit(root, ['merge-base', '--is-ancestor', receipt.baseHead, 'HEAD'])
    if (ancestor.status !== 0) throw new Error('归档收据的提交历史已改变，请核对后处理')
  }
  const history = runGit(root, ['log', '--format=%H', receipt.baseHead === null ? 'HEAD' : `${receipt.baseHead}..HEAD`])
  if (history.status !== 0) throw new Error(`无法核对归档提交:${history.stderr}`)
  for (const commit of history.stdout.trim().split('\n').filter(Boolean)) {
    const matches = receipt.outputs.every(output => {
      const blob = runGit(root, ['rev-parse', '--verify', `${commit}:${output.relPath}`])
      return blob.status === 0 && blob.stdout.trim() === output.gitBlob
    })
    if (matches) return true
  }
  return false
}

export function makeArchiveReceipt(
  root: string,
  identity: Pick<ArchiveReceipt, 'scope' | 'request' | 'mode' | 'message'>,
  ops: readonly FileOp[],
  extraPaths: readonly string[],
): ArchiveReceipt {
  const head = runGit(root, ['rev-parse', '--verify', 'HEAD'])
  const contents = [...ops, ...extraPaths.map(relPath => ({ relPath, content: fs.readFileSync(archiveFile(root, relPath)) }))]
  const outputs = contents.map(({ relPath, content }): Output => {
    archiveFile(root, relPath)
    // Git clean filters/newline normalization can differ from the bytes on disk.
    const blob = spawnSync('git', ['hash-object', `--path=${relPath}`, '--stdin'], {
      cwd: root, input: content, encoding: 'utf8', windowsHide: true,
    })
    if (blob.status !== 0 || !OBJECT.test(blob.stdout.trim())) throw new Error(`无法计算归档提交指纹:${relPath}`)
    return { relPath, sha256: contentHash(content), gitBlob: blob.stdout.trim() }
  })
  return { schema: 1, ...identity, baseHead: head.status === 0 ? head.stdout.trim() : null, outputs }
}

export function archiveReceiptOp(receipt: ArchiveReceipt): FileOp {
  return { relPath: receiptRelative(receipt.scope), content: JSON.stringify({ checksum: contentHash(JSON.stringify(receipt)), receipt }) + '\n' }
}
