import path from 'node:path'
import { runGit, type GitCommandResult } from '../commit/git'
import { checkGitHealth } from '../commit/health'
import type { ArchiveReceipt } from '../commit/receipt'
import { checkCommitRelPath } from '../commit/paths'
import type { ReadonlyBookSnapshot } from './snapshot'

const OBJECT_ID = /^[a-f0-9]{40,64}$/
const pathIdentity = (value: string): string => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)

export interface OpeningGitState {
  readonly head?: string
  readonly status: string
  readonly pending?: string
}

/** Only fixed read commands are used by the opening inspector. */
export function openingGit(root: string, args: readonly string[]): GitCommandResult {
  // check-ignore accepts literal pathnames itself and rejects pathspec magic.
  return runGit(root, ['--no-optional-locks', '--no-lazy-fetch', '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', ...(args[0] === 'check-ignore' ? [] : ['--literal-pathspecs']), ...args], {
    GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0',
  })
}

export function externalFilterPath(root: string, additionalPaths: readonly string[] = []): string | undefined {
  const configured = openingGit(root, ['config', '--null', '--get-regexp', '^filter\\..*\\.(clean|process)$'])
  if (configured.status === 1) return undefined
  if (configured.status !== 0) throw new Error('无法只读核对 Git 内容过滤器配置')
  const drivers = new Set(configured.stdout.split('\0').flatMap(entry => {
    const match = /^filter\.(.+)\.(?:clean|process)\n([\s\S]+)$/.exec(entry)
    return match?.[2]?.trim() ? [match[1]!] : []
  }))
  if (drivers.size === 0) return undefined
  const listed = openingGit(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  if (listed.status !== 0) throw new Error('无法核对 Git 过滤器的受检文件')
  const files = [...new Set([...listed.stdout.split('\0').filter(Boolean), ...additionalPaths])]
  for (let index = 0; index < files.length; index += 24) {
    const attributes = openingGit(root, ['check-attr', '-z', 'filter', '--', ...files.slice(index, index + 24)])
    if (attributes.status !== 0) throw new Error('无法只读核对 Git 文件属性')
    const fields = attributes.stdout.split('\0')
    for (let offset = 0; offset + 2 < fields.length; offset += 3) {
      if (drivers.has(fields[offset + 2]!)) return fields[offset]
    }
  }
  return undefined
}

export function readOpeningGitState(reader: ReadonlyBookSnapshot): OpeningGitState | undefined {
  const rootEntries = reader.listDirectory('')
  const dotGit = rootEntries?.find(entry => entry.name === '.git')
  if (dotGit === undefined || dotGit.kind === 'other') {
    reader.issues.push({ 代码: 'OPENING_GIT_UNAVAILABLE', 路径: '.git', 说明: '无法核实书仓自己的版本库，未使用父目录的版本库' })
    return undefined
  }
  if (dotGit.kind === 'file') reader.readFile('.git')
  else reader.listDirectory('.git')
  const capability = openingGit(reader.root, ['--version'])
  if (capability.status !== 0 || !/^git version /m.test(capability.stdout)) {
    reader.issues.push({ 代码: 'OPENING_GIT_READONLY_UNAVAILABLE', 路径: '.git', 说明: '当前 Git 无法提供本次要求的安全只读能力，未尝试补取对象、升级 Git 或修改配置；请核对 Git 版本与可用参数' })
    return undefined
  }
  const top = openingGit(reader.root, ['rev-parse', '--show-toplevel'])
  if (top.status !== 0 || pathIdentity(top.stdout.trim()) !== pathIdentity(reader.root)) {
    reader.issues.push({ 代码: 'OPENING_GIT_ROOT', 路径: '.git', 说明: '版本库根与书仓根不一致或无法读取' })
    return undefined
  }
  const head = openingGit(reader.root, ['rev-parse', '--verify', 'HEAD'])
  if (head.status !== 0 || !OBJECT_ID.test(head.stdout.trim())) {
    reader.issues.push({ 代码: 'OPENING_GIT_HEAD', 路径: '.git/HEAD', 说明: '没有可核实的书仓提交，不能证明归档已经收尾' })
    return undefined
  }
  try {
    const filtered = externalFilterPath(reader.root)
    if (filtered !== undefined) {
      reader.issues.push({ 代码: 'OPENING_EXTERNAL_FILTER', 路径: filtered, 说明: '受检文件配置了会运行外部程序的 Git 内容过滤器，本次未运行该过滤器，无法核实提交状态' })
      return undefined
    }
  } catch (error) {
    reader.issues.push({ 代码: 'OPENING_GIT_READ', 路径: '.git', 说明: error instanceof Error ? error.message : String(error) })
    return undefined
  }
  const status = openingGit(reader.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames', '--ignore-submodules=all'])
  if (status.status !== 0) {
    reader.issues.push({ 代码: 'OPENING_GIT_READ', 路径: '.git', 说明: '无法只读核对书仓的暂存和未提交状态' })
    return undefined
  }
  const health = checkGitHealth(reader.root)
  return { head: head.stdout.trim(), status: status.stdout, ...(!health.ok ? { pending: health.reason } : {}) }
}

export function openingDirtyPaths(state: OpeningGitState): string[] {
  return state.status.split('\0').filter(Boolean).map(row => row.slice(3)).filter(relative => relative === '.gitignore' || checkCommitRelPath(relative).ok)
}

export class OpeningCommitProof {
  private readonly trees = new Map<string, ReadonlyMap<string, { blob: string; regular: boolean }>>()
  private readonly subjects = new Map<string, string>()
  private readonly contents = new Map<string, string>()
  private readonly ranges = new Map<string, readonly string[]>()
  private readonly changes = new Map<string, readonly string[]>()
  private readonly parents = new Map<string, readonly string[]>()
  private commits: string[] | undefined

  constructor(private readonly root: string, private readonly head: string) {}

  private command(args: readonly string[]): string {
    const result = openingGit(this.root, args)
    if (result.status !== 0) throw new Error('无法只读核对归档提交历史')
    return result.stdout
  }

  private text(blob: string): string {
    if (!this.contents.has(blob)) this.contents.set(blob, this.command(['cat-file', 'blob', blob]))
    return this.contents.get(blob)!
  }

  history(): readonly string[] {
    if (this.commits === undefined) {
      const lines = this.command(['log', '--format=%H%x00%s', this.head]).trim().split('\n').filter(Boolean)
      this.commits = lines.map(line => {
        const separator = line.indexOf('\0')
        const commit = line.slice(0, separator)
        if (!OBJECT_ID.test(commit)) throw new Error('归档历史返回了无法识别的提交')
        this.subjects.set(commit, line.slice(separator + 1))
        return commit
      })
    }
    return this.commits
  }

  blob(commit: string, relative: string): string | undefined {
    if (!this.trees.has(commit)) {
      const rows = this.command(['ls-tree', '-r', '-z', commit]).split('\0').filter(Boolean)
      const tree = new Map<string, { blob: string; regular: boolean }>()
      for (const row of rows) {
        const match = /^(\d+) (?:blob|commit) ([a-f0-9]{40,64})\t([\s\S]+)$/.exec(row)
        if (match === null) throw new Error('无法识别归档提交树的文件证据')
        tree.set(match[3]!, { blob: match[2]!, regular: match[1] === '100644' || match[1] === '100755' })
      }
      this.trees.set(commit, tree)
    }
    const entry = this.trees.get(commit)!.get(relative)
    if (entry !== undefined && !entry.regular) throw new Error('归档提交目标不是普通文件')
    return entry?.blob
  }

  committed(receipt: ArchiveReceipt): boolean {
    const range = receipt.baseHead === null ? this.head : `${receipt.baseHead}..${this.head}`
    if (!this.ranges.has(range)) {
      if (receipt.baseHead !== null) {
        const ancestor = openingGit(this.root, ['merge-base', '--is-ancestor', receipt.baseHead, this.head])
        if (ancestor.status !== 0) throw new Error('归档收据的基线不在当前历史中，不能核实收尾')
      }
      this.ranges.set(range, this.command(['rev-list', range]).trim().split('\n').filter(Boolean))
    }
    for (const commit of this.ranges.get(range)!) {
      if (receipt.outputs.every(output => this.blob(commit, output.relPath) === output.gitBlob)) return true
    }
    return false
  }

  currentOutputs(receipt: ArchiveReceipt, required: readonly string[]): boolean {
    return required.every(relative => {
      const output = receipt.outputs.find(item => item.relPath === relative)
      return output !== undefined && this.blob(this.head, relative) === output.gitBlob
    })
  }

  historicalTexts(relative: string, receiptBlobs: readonly string[] = []): readonly string[] {
    const blobs = new Set<string>(receiptBlobs)
    for (const commit of this.history()) {
      if (!/^(?:ch|retcon):/.test(this.subjects.get(commit) ?? '')) continue
      const blob = this.blob(commit, relative)
      if (blob !== undefined) blobs.add(blob)
    }
    return [...blobs].map(blob => this.text(blob))
  }

  legacyPair(final: string, summary: string, supported: (finalText: string, summaryText: string) => boolean): boolean {
    const finalBlob = this.blob(this.head, final)
    const summaryBlob = this.blob(this.head, summary)
    if (finalBlob === undefined || summaryBlob === undefined || !supported(this.text(finalBlob), this.text(summaryBlob))) return false
    let initialArchive = false
    let currentArchive = false
    for (const commit of this.history()) {
      const subject = this.subjects.get(commit) ?? ''
      if (!/^(?:ch|retcon):/.test(subject)) continue
      if (!this.changes.has(commit)) this.changes.set(commit, this.command(['diff-tree', '--root', '--no-commit-id', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv', '-r', '-z', commit]).split('\0'))
      const changes = this.changes.get(commit)!
      const hasFinal = this.blob(commit, final)
      const hasSummary = this.blob(commit, summary)
      if (subject.startsWith('ch:') && changes.includes(final) && changes.includes(summary) && hasFinal !== undefined && hasSummary !== undefined) {
        if (!this.parents.has(commit)) this.parents.set(commit, this.command(['rev-list', '--parents', '-n', '1', commit]).trim().split(' ').slice(1))
        const parents = this.parents.get(commit)!
        if (parents.length <= 1 && parents.every(parent => this.blob(parent, final) === undefined && this.blob(parent, summary) === undefined)
          && supported(this.text(hasFinal), this.text(hasSummary))) initialArchive = true
      }
      if (changes.includes(final) && hasFinal === finalBlob && hasSummary === summaryBlob) currentArchive = true
    }
    return initialArchive && currentArchive
  }
}
