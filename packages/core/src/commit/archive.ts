/**
 * 清单驱动定稿入档(格式规格 §11.2 / 不变量 2):原子写入＋单次 git 提交。
 * 健康检查失败则不写不提交;retcon: 走独立补偿入口。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { writeBatchAtomic, type FileOp } from '../repo/atomic'
import { MACHINE_SCHEMA_VERSION, parseMachineJson } from '../repo/schema'
import { checkGitHealth } from './health'
import { formatCommitMessage } from './message'
import { checkCommitPath } from './paths'
import { planSettlement, type SettlementApproval } from '../settlement'
import { commitWithIsolatedIndex, runGit } from './git'
import {
  archiveFile, archiveReceiptCommitted, archiveReceiptOp, archiveScope, contentHash,
  makeArchiveReceipt, readArchiveReceipt, verifyArchiveOutputs, verifyArchiveBeforeCommit,
  archivePathIdentity, listArchiveReceipts, retconPackageInputs, retconRequestScope, receiptRelative, stableJson, type ArchiveReceipt,
} from './receipt'
import { updateOperationTargets, withBookLock } from '../repo/lock'
import { recoverTransactions, type OperationProvenance } from '../repo/transaction'
import { 待定稿包七件 } from '../prepare/pack'
import { parseDocument } from '../repo/frontmatter'
import { assertDraftRetentionBinding, parseDraftRetention, verifyDraftRetention, type DraftRetentionManifest, type DraftRetentionVerification } from '../repo/draft-retention'
import { paths } from '../repo/paths'
import type { ChapterKey } from '../derive/scan'

export interface ManifestEntry {
  readonly 源?: string
  readonly 目标: string
  readonly 内容?: string
  readonly sha256?: string
}

export interface ArchiveOptions {
  readonly bookRoot: string
  /** 待定稿包目录(相对书仓或绝对);用于读清单.json 与源文件。 */
  readonly packageDir?: string
  readonly files?: readonly ManifestEntry[]
  readonly summary: string
  readonly lines?: readonly string[]
  /** Frozen preparation evidence; never collected or enlarged during archive. */
  readonly retention?: DraftRetentionManifest
  /** 包中存在非空沉淀候选时，必须提供作者批准。 */
  readonly settlement?: SettlementApproval
  /**
   * 归档自身产出的附加提交路径（拍板 1：如已标记「已消费」的近期窗口——标记由归档流程
   * 在调用前写入，这里只负责随 `ch:` 一并提交）。逐条过路径白名单。
   */
  readonly extraPaths?: readonly string[]
  readonly provenance?: OperationProvenance
}

export type ArchiveResult =
  | {
      readonly ok: true
      readonly message: string
      readonly dests: readonly string[]
      /** 可信收据及 Git 历史证明本次请求已经完成，未重复沉淀或提交。 */
      readonly alreadyCommitted?: boolean
    }
  | { readonly ok: false; readonly reason: string; readonly next?: string; /** F7:文件已落盘、待提交(commit/add 阶段失败)。 */ readonly written?: true }

function resolvePackageDir(bookRoot: string, packageDir: string): string {
  return path.isAbsolute(packageDir) ? packageDir : path.join(bookRoot, packageDir)
}

function readManifest(packageAbs: string): { readonly ok: true; readonly files: readonly ManifestEntry[]; readonly retention?: DraftRetentionManifest } | { readonly ok: false; readonly reason: string } {
  const p = path.join(packageAbs, '清单.json')
  let text: string
  try {
    text = fs.readFileSync(p, 'utf-8')
  } catch {
    return { ok: false, reason: '待定稿包缺清单.json,拒绝入档' }
  }
  const parsed = parseMachineJson(text, MACHINE_SCHEMA_VERSION)
  if (!parsed.ok) return { ok: false, reason: `清单解析失败：${parsed.detail}` }
  const raw = parsed.data['文件']
  if (!Array.isArray(raw)) return { ok: false, reason: '清单缺「文件」数组，拒绝入档' }
  const files: ManifestEntry[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, reason: '清单文件项必须是对象' }
    }
    const o = item as Record<string, unknown>
    const 目标 = o['目标']
    if (typeof 目标 !== 'string' || 目标 === '') return { ok: false, reason: '清单文件项缺目标路径' }
    files.push({
      源: typeof o['源'] === 'string' ? o['源'] : undefined,
      目标,
      内容: typeof o['内容'] === 'string' ? o['内容'] : undefined,
      sha256: typeof o['sha256'] === 'string' ? o['sha256'] : undefined,
    })
  }
  try {
    const retention = Object.hasOwn(parsed.data, '草稿留档') ? parseDraftRetention(parsed.data['草稿留档']) : undefined
    return { ok: true, files, ...(retention === undefined ? {} : { retention }) }
  } catch (error) {
    return { ok: false, reason: `准备包留档清单无效：${error instanceof Error ? error.message : String(error)}` }
  }
}

function loadOps(
  bookRoot: string,
  packageAbs: string | null,
  files: readonly ManifestEntry[],
): { readonly ok: true; readonly ops: readonly FileOp[] } | { readonly ok: false; readonly reason: string } {
  const ops: FileOp[] = []
  for (const f of files) {
    const destCheck = checkCommitPath(bookRoot, f.目标)
    if (!destCheck.ok) return destCheck
    let content = f.内容
    if (content === undefined) {
      if (!f.源 || packageAbs === null) return { ok: false, reason: `清单项「${f.目标}」无源文件也无内容` }
      if (path.isAbsolute(f.源) || f.源.split(/[\\/]/).includes('..')) return { ok: false, reason: `清单源文件路径非法：${f.源}` }
      const srcAbs = archiveFile(bookRoot, path.relative(bookRoot, path.join(packageAbs, f.源)))
      try {
        content = fs.readFileSync(srcAbs, 'utf-8')
      } catch {
        return { ok: false, reason: `清单源文件不存在：${f.源}` }
      }
    }
    if (f.sha256 !== undefined && contentHash(content) !== f.sha256) {
      return { ok: false, reason: `清单校验失败：「${f.目标}」sha256 不匹配` }
    }
    const relPath = path.posix.normalize(destCheck.relPath)
    archiveFile(bookRoot, relPath)
    ops.push({ relPath, content })
  }
  if (ops.length === 0) return { ok: false, reason: '清单文件列表为空，拒绝入档' }
  return { ok: true, ops }
}

function requestFingerprint(opts: ArchiveOptions, packageAbs: string | null, ops: readonly FileOp[], extras: readonly string[], mode: 'ch' | 'retcon', retention?: DraftRetentionManifest): string {
  const inputs: Record<string, string | null> = {}
  if (packageAbs !== null) {
    for (const name of [...待定稿包七件, '清单.json']) {
      const file = archiveFile(opts.bookRoot, path.relative(opts.bookRoot, path.join(packageAbs, name)))
      try {
        const bytes = fs.readFileSync(file)
        if (name === '清单.json') {
          const parsed = parseMachineJson(bytes.toString('utf8'), MACHINE_SCHEMA_VERSION)
          if (!parsed.ok) throw new Error(`清单解析失败：${parsed.detail}`)
          // The tool's trusted decision write is not a new business request.
          inputs[name] = contentHash(stableJson(Object.fromEntries(Object.entries(parsed.data).filter(([key]) => key !== '裁决'))))
        } else inputs[name] = contentHash(bytes)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        inputs[name] = null
      }
    }
  }
  return contentHash(stableJson({
    mode, inputs, ops, extras,
    ...(retention === undefined ? {} : { retention }),
    approval: opts.settlement === undefined ? null : { 章节: opts.settlement.章节, 批准: opts.settlement.批准 },
  }))
}

function commitArchive(root: string, dests: readonly string[], message: string, receipt?: ArchiveReceipt): ArchiveResult {
  if (receipt?.schema === 3) {
    try { verifyArchiveBeforeCommit(root, receipt) }
    catch (error) { return { ok: false, written: true, reason: `文件已写入但未能补交：${error instanceof Error ? error.message : String(error)}` } }
  }
  const commit = commitWithIsolatedIndex(root, dests, message)
  if (commit.status !== 0 || commit.noChanges) {
    return { ok: false, written: true, reason: `文件已写入但提交失败，未形成提交：${commit.stderr.trim() || 'git commit 失败'}` }
  }
  return { ok: true, message, dests }
}

export interface PendingRetentionRecovery {
  readonly reason: string
  readonly next: string
}

function missingRetentionRecovery(root: string, receipt: ArchiveReceipt, retained: DraftRetentionVerification): PendingRetentionRecovery | undefined {
  if (receipt.schema !== 3 || receipt.kind !== 'archive' || retained.issues.length === 0
    || !retained.issues.every(item => item.代码 === 'DRAFT_RETENTION_MISSING' && item.路径 !== receipt.retention.sourceDraft)) return undefined
  // A split batch or changed before-state cannot be repaired by another manual commit.
  verifyArchiveBeforeCommit(root, receipt)
  return {
    reason: `归档留档证据冲突：非来源留档已缺失，原输出尚未提交；文件和收据已保留。缺失：${JSON.stringify(retained.issues.map(item => item.路径))}`,
    next: `请作者从备份原样恢复缺稿后重试。若无法恢复，请作者核对 ${receiptRelative(receipt.scope)} 的 outputs，再一次性手动提交以下全部路径：${JSON.stringify(receipt.outputs.map(output => output.relPath))}。只提交这些输出，保留无关暂存，不提交草稿或收据，也不要分批；模型不要执行 Git 写入。完成后调用 novel_begin_chapter 核对。`,
  }
}

/** Read-only advice for the public pre-approval check; this does not approve or resume a write. */
export function inspectPendingSettlementRetention(root: string, chapter: ChapterKey): PendingRetentionRecovery | undefined {
  const packageAbs = resolvePackageDir(root, paths.待定稿包目录(chapter.卷, chapter.章名))
  const manifest = readManifest(packageAbs)
  if (!manifest.ok || manifest.retention === undefined || stableJson(manifest.retention.chapter) !== stableJson(chapter)) return undefined
  const loaded = loadOps(root, packageAbs, manifest.files)
  if (!loaded.ok) return undefined
  const scope = archiveScope(root, packageAbs, 'ch', loaded.ops.map(op => op.relPath))
  const receipt = readArchiveReceipt(root, scope)
  if (receipt?.schema !== 3 || receipt.kind !== 'archive' || stableJson(receipt.retention) !== stableJson(manifest.retention)) return undefined
  // Approval time/text are intentionally absent from the existing business request identity.
  const request = requestFingerprint({ bookRoot: root, summary: '', settlement: { 章节: chapter, 批准: true, 裁决记录: '' } },
    packageAbs, loaded.ops, [], 'ch', manifest.retention)
  if (receipt.request !== request) return undefined
  verifyArchiveOutputs(root, receipt)
  if (archiveReceiptCommitted(root, receipt)) return undefined
  return missingRetentionRecovery(root, receipt, verifyDraftRetention(root, receipt.retention))
}

function resumeArchive(root: string, receipt: ArchiveReceipt, provenance?: OperationProvenance): ArchiveResult {
  if (receipt.schema === 2 && stableJson(retconPackageInputs(root, receipt.retcon.packageDir)) !== stableJson(receipt.retcon.inputs)) {
    return { ok: false, reason: '归档收据与原补偿包候选冲突，收据已保留，本次没有写入。请把冲突呈报作者，并核对 草稿区/.archive-receipts/ 中的收据' }
  }
  verifyArchiveOutputs(root, receipt)
  const health = checkGitHealth(root)
  if (!health.ok) return health
  const dests = receipt.outputs.map(output => output.relPath)
  updateOperationTargets(root, provenance, dests)
  const committed = archiveReceiptCommitted(root, receipt)
  if (receipt.schema === 3) {
    const retained = verifyDraftRetention(root, receipt.retention, { allowMissingRetained: committed })
    if (!retained.ok) {
      const recovery = committed ? undefined : missingRetentionRecovery(root, receipt, retained)
      return recovery === undefined
        ? { ok: false, reason: `归档留档证据已变化，保留原收据：${retained.issues.map(item => item.说明).join('；')}` }
        : { ok: false, written: true, ...recovery }
    }
  }
  if (committed) return { ok: true, message: receipt.message, dests, alreadyCommitted: true }
  return commitArchive(root, dests, receipt.message, receipt)
}

const 定稿章 = /^定稿\/卷(\d+)\/(\d{4})-(.+)\.md$/

function targetChapter(targets: readonly string[]): { readonly 卷: number; readonly 章: number; readonly 章名: string } | undefined {
  for (const target of targets) {
    const match = 定稿章.exec(target)
    if (match !== null) {
      return { 卷: Number(match[1]), 章: Number(match[2]), 章名: match[3] ?? '' }
    }
  }
  return undefined
}

/**
 * 章号全书连续(格式规格 §2.2):同一章号不得出现在两个卷下。
 *
 * 账本时间线的 `章号`、线索的 `埋设点`/`预期兑现区间` 都是书级字段、不带卷限定,
 * 章号跨卷重复会让这些字段永久歧义,因此在入档口 fail-closed。
 */
function chapterNumberConflict(bookRoot: string, targets: readonly string[]): string | null {
  const 定稿根 = path.join(bookRoot, '定稿')
  for (const target of targets) {
    const match = 定稿章.exec(target)
    if (match === null) continue
    const 卷目录 = `卷${match[1]}`
    const 章号 = match[2]!
    let 卷列表: string[]
    try {
      卷列表 = fs.readdirSync(定稿根)
    } catch {
      continue
    }
    for (const 其他卷 of 卷列表) {
      if (其他卷 === 卷目录 || !/^卷\d+$/.test(其他卷)) continue
      let 章文件: string[]
      try {
        章文件 = fs.readdirSync(path.join(定稿根, 其他卷))
      } catch {
        continue
      }
      const 撞号 = 章文件.find((name) => name.startsWith(`${章号}-`) && name.endsWith('.md'))
      if (撞号 !== undefined) {
        return `章号全书连续,${章号} 已被 定稿/${其他卷}/${撞号} 占用(格式规格 §2.2)`
      }
    }
  }
  return null
}

interface RetconIdentity {
  readonly scope: string
  readonly request: string
  readonly chapter: string
}

function archiveLocked(opts: ArchiveOptions, mode: 'ch' | 'retcon', identity?: RetconIdentity): ArchiveResult {
  const packageAbs = opts.packageDir === undefined ? null : resolvePackageDir(opts.bookRoot, opts.packageDir)
  let files = opts.files
  let retention = opts.retention === undefined ? undefined : parseDraftRetention(opts.retention)
  if (files === undefined && packageAbs === null) return { ok: false, reason: '未提供清单或待定稿包目录' }
  if (packageAbs !== null && (files === undefined || (mode === 'ch' && fs.existsSync(path.join(packageAbs, '清单.json'))))) {
    const man = readManifest(packageAbs)
    if (!man.ok) return man
    if (files === undefined) files = man.files
    if (retention !== undefined && man.retention !== undefined && stableJson(retention) !== stableJson(man.retention)) return { ok: false, reason: '归档参数与准备包中的留档清单不一致' }
    if (man.retention !== undefined) retention = man.retention
  }

  const loaded = loadOps(opts.bookRoot, packageAbs, files!)
  if (!loaded.ok) return loaded
  if (mode === 'ch') {
    const marked = loaded.ops.filter(op => {
      if (!op.relPath.startsWith('定稿/')) return false
      const doc = parseDocument(op.content)
      return doc.ok && Object.hasOwn(doc.data.fields, '草稿留档摘要')
    })
    if (retention === undefined && marked.length > 0) return { ok: false, reason: '定稿已有留档摘要但缺少准备时的完整清单，不能回退旧归档格式' }
    if (retention !== undefined) {
      const chapterPath = paths.定稿章(retention.chapter.卷, retention.chapter.章, retention.chapter.章名)
      const chapter = loaded.ops.find(op => op.relPath === chapterPath)
      if (!chapter || marked.length !== 1) return { ok: false, reason: '准备包留档清单与定稿摘要或章节不一致' }
      assertDraftRetentionBinding(chapter.content, retention)
    }
  } else if (retention !== undefined) return { ok: false, reason: '吃书补偿不得重新采集或替换原次定稿留档清单' }
  // 账本与本书记忆只有一条写入路径:沉淀服务。两种模式都不许清单从旁边的门进来,
  // 否则状态词表、计划来源、线索必填字段等校验被整体绕过(吃书亦然)。
  if (loaded.ops.some((op) => op.relPath.startsWith('账本/') || op.relPath.startsWith('本书记忆/'))) {
    return { ok: false, reason: '清单不得绕过沉淀服务直接写账本或本书记忆' }
  }

  const extras: string[] = []
  for (const extra of opts.extraPaths ?? []) {
    const checked = checkCommitPath(opts.bookRoot, extra)
    if (!checked.ok) return checked
    const relative = path.posix.normalize(checked.relPath)
    if (!extras.includes(relative)) extras.push(relative)
  }
  const scope = identity?.scope ?? archiveScope(opts.bookRoot, packageAbs, mode, loaded.ops.map(op => op.relPath))
  const request = identity?.request ?? requestFingerprint(opts, packageAbs, loaded.ops, extras, mode, retention)
  const receipt = readArchiveReceipt(opts.bookRoot, scope)
  if (receipt !== undefined) {
    if (receipt.request === request && receipt.mode === mode) {
      if (retention !== undefined && (receipt.schema !== 3 || receipt.kind !== 'archive'
        || stableJson(receipt.retention) !== stableJson(retention))) {
        return { ok: false, reason: '归档收据缺少或冲突于原准备留档清单，不能回退旧归档证明' }
      }
      return resumeArchive(opts.bookRoot, receipt, opts.provenance)
    }
    if (!archiveReceiptCommitted(opts.bookRoot, receipt)) {
      return { ok: false, reason: '归档收据与当前请求或候选冲突：有已写入但未提交的操作。请用原请求的参数重新调用以补提交；参数已改变时，把冲突呈报作者' }
    }
  }
  if (mode === 'ch') {
    const existing = loaded.ops.find(op => fs.existsSync(path.join(opts.bookRoot, op.relPath)))
    if (existing) {
      const different = fs.readFileSync(path.join(opts.bookRoot, existing.relPath), 'utf8') !== existing.content
      return { ok: false, reason: `定稿只增不改：目标 ${existing.relPath} 已存在${different ? '且内容不同' : ''}，但没有匹配的可信收据，本次没有写入。请把冲突呈报作者，由作者决定保留现有定稿还是走吃书补偿` }
    }
  } else if (loaded.ops.every(op => fs.existsSync(path.join(opts.bookRoot, op.relPath))
    && fs.readFileSync(path.join(opts.bookRoot, op.relPath), 'utf8') === op.content)) {
    return { ok: false, reason: '吃书目标内容已相同，但没有匹配的可信收据，无法确认附属沉淀是否已写入。请把情况呈报作者，并核对账本、时间线和本书记忆是否已更新' }
  }

  let ops = [...loaded.ops]
  if (mode === 'ch') {
    const conflict = chapterNumberConflict(opts.bookRoot, ops.map((op) => op.relPath))
    if (conflict !== null) return { ok: false, reason: conflict }
  }
  if (packageAbs !== null) {
    // 正常定稿:追加新条目,且必须能从清单认出定稿章。
    // 吃书补偿:整条更正既有条目,章节由批准声明(可能不产生新定稿目标)。
    const chapter = mode === 'ch' ? targetChapter(ops.map((op) => op.relPath)) : opts.settlement?.章节
    if (mode === 'ch' && opts.settlement !== undefined && chapter === undefined) {
      return { ok: false, reason: '沉淀批准需要清单包含定稿章节目标' }
    }
    const settlement = planSettlement(
      opts.bookRoot,
      packageAbs,
      opts.settlement,
      chapter,
      mode === 'ch' ? '追加' : '更正',
    )
    if (!settlement.ok) return settlement
    ops = [...ops, ...settlement.ops]
  }
  const destinations = new Set<string>()
  for (const op of ops) {
    if (destinations.has(op.relPath)) return { ok: false, reason: `清单与沉淀目标重复：${op.relPath}` }
    destinations.add(op.relPath)
  }
  const extraDests: string[] = []
  for (const extra of extras) {
    if (!destinations.has(extra)) {
      destinations.add(extra)
      extraDests.push(extra)
    }
  }

  const health = checkGitHealth(opts.bookRoot)
  if (!health.ok) return health

  const message = formatCommitMessage({
    prefix: mode,
    summary: opts.summary,
    lines: opts.lines,
    kind: mode === 'retcon' ? '吃书补偿' : undefined,
  })
  const dests = [...ops.map((op) => op.relPath), ...extraDests]
  updateOperationTargets(opts.bookRoot, opts.provenance, dests)

  let nextReceipt: ArchiveReceipt, receiptOp: FileOp
  try {
    const baseReceipt = makeArchiveReceipt(opts.bookRoot, { scope, request, mode, message }, ops, extraDests, retention)
    nextReceipt = identity === undefined ? baseReceipt : {
      ...baseReceipt, schema: 2, mode: 'retcon', retcon: {
        chapter: identity.chapter,
        packageDir: opts.packageDir ?? null,
        inputs: retconPackageInputs(opts.bookRoot, opts.packageDir ?? null),
      },
    }
    if (nextReceipt.schema === 3) {
      const retained = verifyDraftRetention(opts.bookRoot, nextReceipt.retention)
      if (!retained.ok) return { ok: false, reason: `准备后的草稿留档已变化，旧批准不可使用，本次没有写入；请重新准备并呈报：${retained.issues.map(item => item.说明).join('；')}` }
    }
    receiptOp = archiveReceiptOp(nextReceipt)
  } catch (err) {
    return { ok: false, reason: `归档写入前核对失败，本次没有写入：${err instanceof Error ? err.message : String(err)}` }
  }
  try {
    writeBatchAtomic(opts.bookRoot, [...ops, receiptOp], opts.provenance === undefined ? {} : { provenance: opts.provenance })
  } catch (err) {
    return { ok: false, reason: `原子写入失败：${err instanceof Error ? err.message : String(err)}` }
  }

  return commitArchive(opts.bookRoot, dests, message, nextReceipt)
}

function archive(opts: ArchiveOptions, mode: 'ch' | 'retcon'): ArchiveResult {
  return withBookLock(opts.bookRoot, () => {
    recoverTransactions(opts.bookRoot)
    try { return archiveLocked(opts, mode) } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }, opts.provenance === undefined ? { targets: opts.extraPaths } : { ...opts.provenance, targets: opts.extraPaths })
}

/** 定稿入档默认通道:ch: 前缀,目标不得覆盖既有定稿。 */
export function archiveChapter(opts: ArchiveOptions): ArchiveResult {
  return archive(opts, 'ch')
}

/** 吃书补偿通道:retcon: 前缀(不变量 4)。 */
export function archiveRetcon(opts: ArchiveOptions): ArchiveResult {
  return archive(opts, 'retcon')
}

export interface RetconRequestOptions {
  readonly bookRoot: string
  readonly chapter: string
  /** Normalized business parameters from trusted tool code, never a call/session ID. */
  readonly request: Readonly<Record<string, unknown>>
  readonly provenance?: OperationProvenance
}

/** Resolve durable evidence before preparing versions, packages or event numbers. */
export function archiveRetconRequest(
  opts: RetconRequestOptions,
  prepare: (packageDir: string) => ArchiveOptions | Extract<ArchiveResult, { ok: false }>,
): ArchiveResult {
  return withBookLock(opts.bookRoot, () => {
    recoverTransactions(opts.bookRoot)
    try {
      const checked = checkCommitPath(opts.bookRoot, opts.chapter)
      if (!checked.ok || checked.relPath !== opts.chapter || !/^定稿\/卷\d+\/\d{4,}-.+\.md$/.test(opts.chapter)) {
        return { ok: false, reason: '吃书请求需要规范定稿章节路径' }
      }
      archiveFile(opts.bookRoot, opts.chapter)
      const chapterIdentity = archivePathIdentity(opts.chapter)
      const request = contentHash(stableJson(opts.request))
      const scope = retconRequestScope(opts.chapter, request)
      const receipts = listArchiveReceipts(opts.bookRoot)
      const receipt = receipts.find(item => item.scope === scope || (item.schema === 2 && item.request === request
        && archivePathIdentity(item.retcon.chapter) === chapterIdentity))
      if (receipt !== undefined) {
        if (receipt.schema !== 2 || receipt.request !== request || archivePathIdentity(receipt.retcon.chapter) !== chapterIdentity) {
          return { ok: false, reason: '归档收据与吃书请求冲突，本次没有写入。请把冲突呈报作者，并核对 草稿区/.archive-receipts/ 中的收据' }
        }
        return resumeArchive(opts.bookRoot, receipt, opts.provenance)
      }
      for (const previous of receipts) {
        if (previous.outputs.some(output => archivePathIdentity(output.relPath) === chapterIdentity) && !archiveReceiptCommitted(opts.bookRoot, previous)) {
          return { ok: false, reason: '归档收据冲突：本章尚有已写入但未提交的操作，请按原请求补交或核对旧收据' }
        }
      }
      const health = checkGitHealth(opts.bookRoot)
      if (!health.ok) return health
      // An old failed tool call may have no receipt at all. Unaccounted-for compensation
      // events are evidence of an uncertain write, never permission to generate another.
      const eventDir = `${path.posix.dirname(opts.chapter)}/补偿/`
      const pending = runGit(opts.bookRoot, ['--literal-pathspecs', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', eventDir])
      if (pending.status !== 0) return { ok: false, reason: `无法核对补偿事件提交状态：${pending.stderr}` }
      const known = new Set(receipts.flatMap(item => item.outputs.map(output => output.relPath)))
      if (pending.stdout.split('\0').filter(Boolean).some(entry => !known.has(entry.slice(3)))) {
        return { ok: false, reason: '存在未提交的补偿事件，但没有匹配的可信收据，本次没有写入。请把情况呈报作者，不要重复调用' }
      }
      const packageDir = `草稿区/提案/retcon-${scope}`
      // Validate the candidate directory before the callback can create it.
      archiveFile(opts.bookRoot, `${packageDir}/事实变更.md`)
      const prepared = prepare(packageDir)
      if ('ok' in prepared) return prepared
      if (prepared.bookRoot !== opts.bookRoot || (prepared.packageDir !== undefined && prepared.packageDir !== packageDir)) {
        return { ok: false, reason: '吃书准备结果与请求书仓或补偿包不一致' }
      }
      if (!prepared.files?.some(file => file.目标 === opts.chapter)) return { ok: false, reason: '吃书准备结果缺少请求章节' }
      return archiveLocked(prepared, 'retcon', { scope, request, chapter: opts.chapter })
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }, opts.provenance)
}
