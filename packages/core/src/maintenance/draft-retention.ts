import { commitWithIsolatedIndex } from '../commit/git'
import { formatCommitMessage } from '../commit/message'
import { archiveReceiptOp, contentHash, makeDraftRetentionReceipt, receiptRelative, stableJson, verifyArchiveBeforeCommit,
  type DraftRetentionReceipt } from '../commit/receipt'
import type { ChapterKey } from '../derive/scan'
import { writeBatchAtomic } from '../repo/atomic'
import { assertDraftRetentionAnchor, captureDraftRetention, draftRetentionDigest, verifyDraftRetention } from '../repo/draft-retention'
import { parseDocument } from '../repo/frontmatter'
import { withBookLock } from '../repo/lock'
import { paths, validateSegment } from '../repo/paths'
import { addDraftRetentionAnchor } from '../repo/retention-anchor'
import { OpeningCommitProof, openingGit, readOpeningGitState } from './opening-git'
import { currentChapterProven, finalizedSource, missingRetentionNotices, proveChapterBeforeRetention, readArchiveReceiptsSnapshot, trustedDraftRetention, verifyRetentionOrigin, retentionReceiptAbsent } from './retention-history'
import { UpgradeReader, upgradeRootIdentity } from './upgrade-reader'
import { uniqueMaintenanceIssues, type MaintenanceIssue } from './types'
import type { DraftRetentionContext, DraftRetentionPreview, DraftRetentionResult } from './draft-retention-types'

type ConfirmationReceipt = Extract<DraftRetentionReceipt, { readonly kind: 'retention' }>
interface PreparedRetention {
  readonly preview: DraftRetentionPreview
  readonly receipt?: ConfirmationReceipt
}

const message = (error: unknown): string => error instanceof Error ? error.message : String(error)
const normalized = (text: string): string => text.replace(/\r\n/g, '\n')
const failure = (reason: string, operationId?: string, code = 'DRAFT_RETENTION_BLOCKED'): DraftRetentionResult => ({
  ok: false, state: 'blocked', code, reason, ...(operationId === undefined ? {} : { operationId }),
})

function chapterKey(value: ChapterKey): ChapterKey {
  if (!value || !Number.isSafeInteger(value.卷) || value.卷 <= 0 || !Number.isSafeInteger(value.章) || value.章 <= 0
    || typeof value.章名 !== 'string' || validateSegment(value.章名).length) throw new Error('留档确认需要明确的正整数卷、章和合法章名')
  return { 卷: value.卷, 章: value.章, 章名: value.章名 }
}

function runtimeReady(reader: UpgradeReader): void {
  for (const entry of reader.listDirectory('.webnovel') ?? []) {
    const relative = `.webnovel/${entry.name}`
    if (['book.lock', 'writer.lock', 'acquire.lock'].includes(entry.name) || /^\.writer-.+\.stage$/.test(entry.name)) {
      throw new Error('书仓有写入锁或中断锁，请先核对归属；留档预览不会回收锁')
    }
    if (entry.name === 'transactions' || entry.name === 'quarantine') {
      if (entry.kind !== 'directory' || (reader.listDirectory(relative)?.length ?? 0) !== 0) throw new Error('书仓有待处理事务或隔离证据，留档确认不会恢复或删除这些证据')
    }
  }
}

function indexReady(root: string): void {
  const flags = openingGit(root, ['ls-files', '-v', '-z'])
  if (flags.status !== 0 || flags.stdout.split('\0').filter(Boolean).some(row => /^[a-zS]/.test(row))) throw new Error('Git索引含跳过检查标记或不可读取，不能核实确认前的真实文件')
  const entries = openingGit(root, ['ls-files', '--stage', '-z'])
  if (entries.status !== 0 || entries.stdout.split('\0').filter(Boolean).some(row => !/^100(?:644|755) [a-f0-9]+ 0\t/.test(row))) throw new Error('Git索引含冲突或非普通文件，不能执行留档确认')
}

/** Reconstruct only the exact insertion this operation can have written, including its original newlines. */
function beforeConfirmation(after: string, digest: string): string {
  const header = /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---\r?\n)/.exec(after)
  if (!header) throw new Error('待提交定稿元数据无法核实')
  const eol = header[1]!.endsWith('\r\n') ? '\r\n' : '\n'
  const insertion = `${eol}草稿留档摘要: "${digest}"`
  const end = header[1]!.length + header[2]!.length
  if (!after.slice(0, end).endsWith(insertion)) throw new Error('待提交定稿不再是原留档确认的精确输出')
  const before = after.slice(0, end - insertion.length) + after.slice(end)
  if (addDraftRetentionAnchor(before, digest) !== after) throw new Error('待提交留档元数据与原确认不一致')
  return before
}

function localEvidence(root: string, files: readonly string[]): void {
  const tracked = openingGit(root, ['ls-files', '--cached', '-z', '--', ...files])
  if (tracked.status !== 0 || tracked.stdout !== '') {
    throw new Error('草稿和留档收据须处于现有未跟踪的忽略范围；预览不会修改Git配置')
  }
  const ignored = openingGit(root, ['check-ignore', '--no-index', '--stdin', '-z'], files.join('\0') + '\0')
  // Exit 0 means at least one path matched, not that the complete inventory is ignored.
  const matches = new Set(ignored.stdout.split('\0').filter(Boolean))
  if (ignored.status !== 0 || files.some(file => !matches.has(file))) {
    throw new Error('草稿和留档收据须处于现有未跟踪的忽略范围；预览不会修改Git配置')
  }
}

function prepareDraftRetention(root: string, input: ChapterKey, ownedOperation?: string): PreparedRetention {
  const reader = new UpgradeReader(root, new Map(), ownedOperation)
  let bookId: string | undefined, operationId: string | undefined
  let chapter = input
  const notices: MaintenanceIssue[] = []
  try {
    chapter = chapterKey(input)
    const rootIdentity = upgradeRootIdentity(root)
    const contractText = reader.readFile(paths.契约())
    const contract = contractText === undefined ? undefined : parseDocument(contractText)
    const id = contract?.ok ? contract.data.fields['书id'] : undefined
    if (typeof id !== 'string' || id.trim() !== id || id === '' || /[\x00-\x1f]/.test(id)) throw new Error('作品契约中的书身份无法核实')
    bookId = id
    operationId = contentHash(stableJson({ kind: 'draft-retention-v1', bookId, chapter }))
    runtimeReady(reader)
    const git = readOpeningGitState(reader)
    if (!git?.head || git.pending) throw new Error(git?.pending ?? '无法核实书仓自己的Git历史，未生成可执行确认')
    indexReady(root)
    const config = openingGit(root, ['config', '--null', '--list', '--show-origin'])
    if (config.status !== 0) throw new Error('无法只读核对Git配置')
    const finalPath = paths.定稿章(chapter.卷, chapter.章, chapter.章名)
    const summaryPath = paths.章摘要(chapter.卷, chapter.章, chapter.章名)
    const finalText = reader.readFile(finalPath), summaryText = reader.readFile(summaryPath)
    const final = finalText === undefined ? undefined : parseDocument(finalText)
    const summary = summaryText === undefined ? undefined : parseDocument(summaryText)
    if (finalText === undefined || !final?.ok || final.data.body.trim() === '' || summaryText === undefined || !summary?.ok || summary.data.body.trim() === '') throw new Error('缺少可读取的定稿或章摘要，不能确认历史留档')
    const proof = new OpeningCommitProof(root, git.head)
    const receipts = readArchiveReceiptsSnapshot(reader)
    const committed = new Map(receipts.map(receipt => [receipt.scope, proof.receiptCommit(receipt)]))
    for (const receipt of receipts) {
      const commit = committed.get(receipt.scope)
      if (commit && receipt.schema === 3 && !verifyRetentionOrigin(proof, receipt, receipts, commit)) throw new Error('既有留档收据的原章完成与来源历史无法核实')
      if (!commit && !(receipt.schema === 3 && receipt.kind === 'retention' && receipt.scope === operationId)) throw new Error(`存在尚未核实提交的归档收据：${receiptRelative(receipt.scope)}；先处理原操作`)
    }
    const stored = receipts.find((receipt): receipt is ConfirmationReceipt => receipt.schema === 3 && receipt.kind === 'retention' && receipt.scope === operationId)
    const pending = stored !== undefined && committed.get(stored.scope) === undefined ? stored : undefined
    if (git.status.split('\0').filter(Boolean).some(row => pending === undefined || row.slice(3) !== finalPath)) throw new Error('留档确认要求Git干净；续办仅允许原定稿元数据输出尚未提交，其他改动须先核对')
    const trusted = pending === undefined && !retentionReceiptAbsent(finalPath, final.data.fields, receipts) ? trustedDraftRetention(proof, chapter, finalText, bookId, receipts) : undefined
    let preview: DraftRetentionPreview
    if (trusted !== undefined) {
      if (!trusted.currentConfirmation && !currentChapterProven(proof, chapter, receipts)) throw new Error('当前定稿与已核实归档不一致，不能宣称留档确认已完成')
      const verified = verifyDraftRetention(root, trusted.manifest, { allowMissingRetained: true, reader })
      reader.issues.push(...verified.issues)
      notices.push(...missingRetentionNotices(verified.missingRetained, trusted.manifest.sourceDraft))
      preview = { ok: true, state: 'unchanged', bookId, chapter, operationId: trusted.receipt.scope, commit: trusted.commit, manifest: trusted.manifest, issues: [], notices }
    } else {
      if (pending === undefined && Object.hasOwn(final.data.fields, '草稿留档摘要')) {
        throw new Error(retentionReceiptAbsent(finalPath, final.data.fields, receipts)
          ? '本章定稿已有留档摘要，但本地没有对应收据（换机克隆或清理过草稿区时会这样）。开章按未记录留档时的规则核对；留档确认不能覆盖已提交的摘要'
          : '已有留档摘要但证据不完整，不能覆盖或重新封存')
      }
      const manifest = pending?.retention ?? captureDraftRetention(root, { bookId, chapter, sourceDraft: finalizedSource(final.data.fields) ?? '' }).manifest
      if (manifest.bookId !== bookId || stableJson(manifest.chapter) !== stableJson(chapter)) throw new Error('原留档收据与当前书或章节不一致')
      const verified = verifyDraftRetention(root, manifest, { reader })
      reader.issues.push(...verified.issues)
      if (!proveChapterBeforeRetention(proof, chapter, receipts, { path: manifest.sourceDraft, proseSha256: manifest.sourceProseSha256 })) throw new Error('无法在确认前历史中同时证明原章已归档及其来源稿，不能仅凭现有定稿追认留档')
      const beforeBlob = proof.blob(git.head, finalPath), summaryBlob = proof.blob(git.head, summaryPath)
      if (!beforeBlob || !summaryBlob || normalized(proof.text(summaryBlob)) !== normalized(summaryText)) throw new Error('原章摘要与当前Git前态不一致')
      let before: string, after: string
      if (pending === undefined) {
        if (Object.hasOwn(final.data.fields, '草稿留档摘要')) throw new Error('已有留档摘要但证据不完整，不能覆盖或重新封存')
        before = finalText
        if (normalized(proof.text(beforeBlob)) !== normalized(before)) throw new Error('当前定稿字节与已提交的原文不一致')
        after = addDraftRetentionAnchor(before, draftRetentionDigest(manifest))
      } else {
        verifyArchiveBeforeCommit(root, pending)
        assertDraftRetentionAnchor(finalText, manifest)
        const output = pending.outputs[0]
        if (!output || output.relPath !== finalPath || output.sha256 !== contentHash(finalText)) throw new Error('待提交定稿与原收据输出已冲突，保留当前文件')
        before = beforeConfirmation(finalText, draftRetentionDigest(manifest))
        if (normalized(before) !== normalized(proof.text(pending.origin.chapterGitBlob))) throw new Error('待提交确认改变了原章正文或其他元数据，不能沿用原收据')
        after = finalText
      }
      localEvidence(root, [...manifest.files.map(file => file.relPath), receiptRelative(operationId)])
      const change = { relPath: finalPath, before, after }
      const fingerprint = contentHash(stableJson({ rootIdentity, bookId, chapter, operationId, action: pending === undefined ? 'confirm' : 'resume',
        git, gitConfig: contentHash(config.stdout), contract: contentHash(contractText!), ignore: reader.readFile('.gitignore'), attributes: reader.readFile('.gitattributes'),
        receipts: receipts.map(receipt => [receipt.scope, contentHash(reader.readFile(receiptRelative(receipt.scope))!)]).sort(([left], [right]) => left! < right! ? -1 : 1),
        manifest, change, summary: contentHash(summaryText) }))
      preview = { ok: true, state: 'ready', action: pending === undefined ? 'confirm' : 'resume', bookId, chapter, operationId, fingerprint,
        baseHead: git.head, manifest, change, issues: [], notices }
    }
    const afterGit = readOpeningGitState(reader)
    if (stableJson(git) !== stableJson(afterGit)) throw new Error('预览期间Git状态发生变化，请重新核对')
    if (!reader.finish().稳定 || reader.issues.length) throw new Error('留档证据存在问题或在读取期间变化，未生成可执行确认')
    return { preview, ...(pending === undefined ? {} : { receipt: pending }) }
  } catch (error) {
    reader.finish()
    return { preview: { ok: false, state: 'blocked', chapter, ...(bookId === undefined ? {} : { bookId }), ...(operationId === undefined ? {} : { operationId }),
      issues: uniqueMaintenanceIssues([...reader.issues, { 代码: 'DRAFT_RETENTION_BLOCKED', 路径: '.', 说明: message(error) }]), notices } }
  }
}

/** A read-only proposal for a current confirmation; it does not reconstruct past author approval. */
export function previewDraftRetention(root: string, chapter: ChapterKey): DraftRetentionPreview {
  return prepareDraftRetention(root, chapter).preview
}

function validateContext(options: DraftRetentionContext): void {
  if (options.signal?.aborted) throw new Error('本次留档确认已取消，没有继续写入')
  if (options.validateIdentity && !options.validateIdentity()) throw new Error('书id归属或工作范围已变化，请重新核对并预览')
}

/** The bundle obtains author approval before entering this exact, locked operation. */
export function confirmDraftRetention(root: string, options: DraftRetentionContext): DraftRetentionResult {
  let operationId: string | undefined
  try {
    validateContext(options)
    if (!/^[a-f0-9]{64}$/.test(options.fingerprint)) throw new Error('留档确认缺少原预览指纹')
    const before = prepareDraftRetention(root, options.chapter)
    const preview = before.preview
    operationId = preview.operationId
    if (preview.bookId !== options.bookId) return failure('当前书身份与批准对象不一致', operationId, 'DRAFT_RETENTION_STALE')
    if (preview.state === 'unchanged') return { ok: true, state: 'already-committed', operationId, commit: preview.commit, notices: preview.notices }
    if (!preview.ok || preview.state !== 'ready' || preview.fingerprint !== options.fingerprint || operationId === undefined) return failure('留档预览已变化或条件尚不满足；请重新预览后呈报作者', operationId, 'DRAFT_RETENTION_STALE')
    const provenance = { ...options.provenance, operationId, toolName: 'draft-retention', bookRootIdentity: upgradeRootIdentity(root) }
    return withBookLock(root, () => {
      validateContext(options)
      const current = prepareDraftRetention(root, options.chapter, operationId)
      const plan = current.preview
      if (!plan.ok || plan.state !== 'ready' || plan.bookId !== options.bookId || plan.fingerprint !== options.fingerprint || !plan.change || !plan.manifest || !plan.baseHead) {
        return failure('锁内证据与作者批准的留档预览不一致，没有写入', operationId, 'DRAFT_RETENTION_STALE')
      }
      let receipt = current.receipt
      if (receipt === undefined) {
        const proof = new OpeningCommitProof(root, plan.baseHead)
        const summaryPath = paths.章摘要(plan.chapter.卷, plan.chapter.章, plan.chapter.章名)
        receipt = makeDraftRetentionReceipt(root, { scope: operationId!, request: plan.fingerprint!, message: formatCommitMessage({ prefix: 'fix', summary: `确认第${plan.chapter.章}章「${plan.chapter.章名}」草稿留档` }) },
          { relPath: plan.change.relPath, content: plan.change.after }, plan.manifest, {
            head: plan.baseHead, chapterGitBlob: proof.blob(plan.baseHead, plan.change.relPath)!, summaryPath, summaryGitBlob: proof.blob(plan.baseHead, summaryPath)!,
          })
        validateContext(options)
        try { writeBatchAtomic(root, [{ relPath: plan.change.relPath, content: plan.change.after }, archiveReceiptOp(receipt)], { provenance }) }
        catch (error) { return failure(`留档确认事务未完成：${message(error)}。保留原文件与事务证据，先核对现场`, operationId, 'DRAFT_RETENTION_TRANSACTION') }
      }
      const pendingResult = (reason: string): DraftRetentionResult => ({ ok: false, state: 'written-pending-commit', operationId, paths: [plan.change!.relPath], code: 'DRAFT_RETENTION_COMMIT_UNVERIFIED',
        reason: `留档元数据和原收据已写入，但提交尚未核实：${reason}。处理原因后重新预览本章，按原收据续办` })
      try {
        validateContext(options)
        const ready = prepareDraftRetention(root, options.chapter, operationId)
        if (ready.preview.state === 'unchanged') return { ok: true, state: 'already-committed', operationId, commit: ready.preview.commit, notices: ready.preview.notices }
        if (ready.preview.state !== 'ready' || ready.preview.action !== 'resume' || !ready.receipt || stableJson(ready.receipt) !== stableJson(receipt)) throw new Error('原确认输出或留档工件已变化，未继续提交')
        verifyArchiveBeforeCommit(root, receipt)
        const result = commitWithIsolatedIndex(root, receipt.outputs.map(output => output.relPath), receipt.message)
        const verified = prepareDraftRetention(root, options.chapter, operationId).preview
        if (verified.state !== 'unchanged' || !verified.commit) return pendingResult(result.stderr || '尚无同次提交的完整证明')
        return { ok: true, state: 'committed', operationId, commit: verified.commit, paths: receipt.outputs.map(output => output.relPath), notices: verified.notices }
      } catch (error) { return pendingResult(message(error)) }
    }, provenance)
  } catch (error) { return failure(message(error), operationId) }
}
