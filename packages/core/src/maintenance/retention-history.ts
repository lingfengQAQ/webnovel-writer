import { ARCHIVE_RECEIPT_DIR, contentHash, readArchiveReceipt, type ArchiveReceipt, type DraftRetentionReceipt } from '../commit/receipt'
import type { ChapterKey } from '../derive/scan'
import { assertDraftRetentionAnchor, draftRetentionDigest, type DraftRetentionManifest } from '../repo/draft-retention'
import { parseDocument } from '../repo/frontmatter'
import { paths } from '../repo/paths'
import { OpeningCommitProof } from './opening-git'
import type { ReadonlyBookSnapshot } from './snapshot'
import type { MaintenanceIssue } from './types'

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const positive = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const chapterPath = (key: ChapterKey): string => paths.定稿章(key.卷, key.章, key.章名)
const summaryPath = (key: ChapterKey): string => paths.章摘要(key.卷, key.章, key.章名)

/** All local receipts enter the caller's read set, including directory membership. */
export function readArchiveReceiptsSnapshot(reader: ReadonlyBookSnapshot, code = 'RECEIPT_INVALID'): ArchiveReceipt[] {
  const receipts: ArchiveReceipt[] = []
  for (const entry of reader.listDirectory(ARCHIVE_RECEIPT_DIR) ?? []) {
    const relative = `${ARCHIVE_RECEIPT_DIR}/${entry.name}`
    try {
      if (entry.kind !== 'file' || !/^[a-f0-9]{64}\.json$/.test(entry.name)) throw new Error('归档收据名称或文件身份无法核实')
      if (reader.readFile(relative) === undefined) throw new Error('归档收据不存在或无法读取')
      const receipt = readArchiveReceipt(reader.root, entry.name.slice(0, -5))
      if (receipt === undefined) throw new Error('归档收据在读取期间消失')
      receipts.push(receipt)
    } catch (error) {
      reader.issues.push({ 代码: code, 路径: relative, 说明: error instanceof Error ? error.message : String(error) })
    }
  }
  return receipts
}

export function finalizedSource(fields: Readonly<Record<string, unknown>>): string | undefined {
  const recovery = fields['恢复信息'], snapshot = fields['来源快照']
  const value = record(recovery) ? recovery['来源草稿'] : record(snapshot) ? snapshot['来源草稿'] : undefined
  return typeof value === 'string' ? value : undefined
}

function supportedChapter(key: ChapterKey, finalText: string, summaryText: string): boolean {
  const final = parseDocument(finalText), summary = parseDocument(summaryText)
  if (!final.ok || !summary.ok || final.data.body.trim() === '' || !/^# 章摘要(?:\s|$)/.test(summary.data.body.trim())) return false
  const fields = final.data.fields, identity = fields['身份']
  return record(identity) && identity['卷'] === key.卷 && identity['章'] === key.章 && identity['章名'] === key.章名
    && (fields['章号'] === undefined || fields['章号'] === key.章) && fields['状态'] === '已定稿' && positive(fields['版本'])
    && ['定稿入档', '吃书补偿'].includes(String(fields['生成模块']))
}

function completedReceipts(proof: OpeningCommitProof, receipts: readonly ArchiveReceipt[]): ArchiveReceipt[] {
  // Local receipt files can be newer than this historical parent; they cannot prove its state.
  const history = new Set(proof.history())
  return receipts.filter(receipt => !(receipt.schema === 3 && receipt.kind === 'retention')
    && (receipt.baseHead === null || history.has(receipt.baseHead)) && proof.committed(receipt))
}

/** Old completion must stand on its own, before a new metadata confirmation exists. */
export function proveChapterBeforeRetention(proof: OpeningCommitProof, key: ChapterKey, receipts: readonly ArchiveReceipt[],
  source: { readonly path: string; readonly proseSha256: string }): boolean {
  const final = chapterPath(key), summary = summaryPath(key)
  const finalBlob = proof.blob(proof.head, final), summaryBlob = proof.blob(proof.head, summary)
  if (!finalBlob || !summaryBlob || !supportedChapter(key, proof.text(finalBlob), proof.text(summaryBlob))) return false
  const supported = (finalText: string, summaryText: string): boolean => supportedChapter(key, finalText, summaryText)
  const sourceMatches = (finalText: string, summaryText: string): boolean => {
    const parsed = parseDocument(finalText)
    return supported(finalText, summaryText) && parsed.ok && finalizedSource(parsed.data.fields) === source.path
      && contentHash(parsed.data.body.replace(/\r\n/g, '\n').replace(/\n+$/, '')) === source.proseSha256
  }
  const completed = completedReceipts(proof, receipts.filter(receipt => receipt.outputs.some(output => output.relPath === final)))
  const closed = completed.some(receipt => proof.currentOutputs(receipt, [final, summary])) || proof.legacyPair(final, summary, supported)
  if (!closed) return false
  const sourceProven = completed.some(receipt => {
    const chapterOutput = receipt.outputs.find(output => output.relPath === final)
    const summaryOutput = receipt.outputs.find(output => output.relPath === summary)
    return chapterOutput !== undefined && summaryOutput !== undefined && sourceMatches(proof.text(chapterOutput.gitBlob), proof.text(summaryOutput.gitBlob))
  })
  return sourceProven || proof.legacyPair(final, summary, supported, sourceMatches)
}

export function currentChapterProven(proof: OpeningCommitProof, key: ChapterKey, receipts: readonly ArchiveReceipt[]): boolean {
  const final = chapterPath(key), summary = summaryPath(key)
  return completedReceipts(proof, receipts.filter(receipt => receipt.outputs.some(output => output.relPath === final)))
    .some(receipt => proof.currentOutputs(receipt, [final, summary]))
    || proof.legacyPair(final, summary, (text, summaryText) => supportedChapter(key, text, summaryText))
}

/** This is additional to the generic before/after tree proof, never self-proof by a retention receipt. */
export function verifyRetentionOrigin(proof: OpeningCommitProof, receipt: DraftRetentionReceipt, receipts: readonly ArchiveReceipt[], commit: string): boolean {
  if (receipt.kind === 'archive') return true
  const parent = proof.parents(commit)
  if (parent.length !== 1) return false
  return proveChapterBeforeRetention(proof.atHead(parent[0]!), receipt.retention.chapter, receipts, {
    path: receipt.retention.sourceDraft, proseSha256: receipt.retention.sourceProseSha256,
  })
}

export interface TrustedDraftRetention {
  readonly receipt: DraftRetentionReceipt
  readonly manifest: DraftRetentionManifest
  readonly commit: string
  /** A metadata-only confirmation can account for the current chapter plus its unchanged summary. */
  readonly currentConfirmation: boolean
}

/** Select a manifest only after checking its historical anchor and current chapter identity. */
export function trustedDraftRetention(proof: OpeningCommitProof, key: ChapterKey, text: string, bookId: string,
  receipts: readonly ArchiveReceipt[]): TrustedDraftRetention | undefined {
  const parsed = parseDocument(text)
  if (!parsed.ok) throw new Error('留档锚点所在的定稿无法解析')
  const relative = chapterPath(key), marker = parsed.data.fields['草稿留档摘要']
  const candidates = receipts.filter((receipt): receipt is DraftRetentionReceipt => receipt.schema === 3
    && receipt.outputs.some(output => output.relPath === relative))
  if (marker === undefined && candidates.length === 0) return undefined
  if (typeof marker !== 'string' || !/^[a-f0-9]{64}$/.test(marker)) throw new Error('定稿缺少有效草稿留档摘要，不能回退旧留档判定')
  for (const receipt of candidates) {
    const manifest = receipt.retention
    if (manifest.bookId !== bookId || draftRetentionDigest(manifest) !== marker) continue
    assertDraftRetentionAnchor(text, manifest)
    if (finalizedSource(parsed.data.fields) !== manifest.sourceDraft) throw new Error('当前定稿的来源草稿与原留档清单不一致')
    const commit = proof.receiptCommit(receipt)
    if (!commit || !verifyRetentionOrigin(proof, receipt, receipts, commit)) continue
    const currentConfirmation = receipt.kind === 'retention' && proof.currentOutputs(receipt, [relative])
      && proof.blob(proof.head, receipt.origin.summaryPath) === receipt.origin.summaryGitBlob
    return { receipt, manifest, commit, currentConfirmation }
  }
  throw new Error('留档摘要没有可核实的完整收据、同批历史提交或原章完成证明，不能把当前稿件当作留档')
}

/**
 * The digest is committed with the chapter, but receipts live in the Git-ignored draft area. After a fresh clone or a
 * cleaned draft area no local receipt names the chapter at all; callers then apply the stricter pre-retention rules and
 * report it. Pass every local receipt: a present but untrusted or uncommitted receipt is not absence.
 */
export function retentionReceiptAbsent(relative: string, fields: Readonly<Record<string, unknown>>, receipts: readonly ArchiveReceipt[]): boolean {
  const marker = fields['草稿留档摘要']
  return typeof marker === 'string' && /^[a-f0-9]{64}$/.test(marker)
    && !receipts.some(receipt => receipt.schema === 3 && receipt.outputs.some(output => output.relPath === relative))
}

export function retentionReceiptAbsentNotice(relative: string): MaintenanceIssue {
  return { 代码: 'DRAFT_RETENTION_RECEIPT_ABSENT', 路径: relative, 说明: '定稿带草稿留档摘要，但本地没有对应的留档收据（换机克隆或清理过草稿区时会这样）；本章草稿按未记录留档时的规则核对' }
}

export function missingRetentionNotices(paths: readonly string[], sourceDraft?: string): MaintenanceIssue[] {
  return paths.map(relative => ({ 代码: 'DRAFT_RETENTION_ABSENT', 路径: relative, 说明: relative === sourceDraft
    ? '本章来源稿目前不存在；其正文已在定稿时与定稿绑定并提交，原留档证据仍保留，不阻断开章，也不会自动重建'
    : '此非来源留档工件目前不存在；原留档证据仍保留，不阻断开章，也不会自动重建' }))
}
