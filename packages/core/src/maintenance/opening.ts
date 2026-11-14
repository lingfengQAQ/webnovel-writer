import { createHash } from 'node:crypto'
import type { ChapterKey } from '../derive/scan'
import { normalizeChapterName } from '../derive/scan'
import { receiptRelative, type ArchiveReceipt } from '../commit/receipt'
import { parseDocument } from '../repo/frontmatter'
import { draftLengthTarget } from '../repo/draft-length'
import { splitCandidateFacts } from '../repo/drafts'
import { assertDraftRetentionBinding, draftRetentionDigest, parseDraftRetention, verifyDraftRetention, type DraftRetentionManifest } from '../repo/draft-retention'
import { addDraftRetentionAnchor } from '../repo/retention-anchor'
import { paths, validateSegment } from '../repo/paths'
import { parseMachineJson, MACHINE_SCHEMA_VERSION } from '../repo/schema'
import { createReadonlyBookSnapshot, type ReadonlyBookSnapshot } from './snapshot'
import type { MaintenanceIssue, MaintenanceSnapshot } from './types'
import { uniqueMaintenanceIssues } from './types'
import { OpeningCommitProof, openingDirtyPaths, readOpeningGitState } from './opening-git'
import { inspectOpeningMaterials } from './opening-materials'
import { listUpgradeReceipts, upgradeCommitted, upgradeReceiptPath, verifyUpgradeBook } from './upgrade-receipt'
import { missingRetentionNotices, readArchiveReceiptsSnapshot, retentionReceiptAbsent, retentionReceiptAbsentNotice, trustedDraftRetention, verifyRetentionOrigin } from './retention-history'

export interface ChapterOpeningInspection {
  readonly 状态: '边界已核对' | '需恢复' | '无法核实'
  readonly 规则版本: 1
  readonly 问题: readonly MaintenanceIssue[]
  readonly 提示?: readonly MaintenanceIssue[]
  readonly 在途项: readonly { readonly 路径: string; readonly 种类: string; readonly 说明: string }[]
  readonly 前章?: ChapterKey
  readonly 快照: MaintenanceSnapshot
}

interface FinalizedChapter {
  readonly key: ChapterKey
  readonly relative: string
  readonly text: string
  readonly fields: Readonly<Record<string, unknown>>
  readonly summary: string
  readonly sourceDraft?: string
  readonly strictIdentity: boolean
  closed: boolean
  receipts: ArchiveReceipt[]
  sourceVerified: boolean
  retention?: DraftRetentionManifest
  currentConfirmation?: boolean
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const scope = (volume: number, name: string): string => `${volume}/${normalizeChapterName(name)}`
const positive = (value: number): boolean => Number.isSafeInteger(value) && value > 0

function issue(reader: ReadonlyBookSnapshot, code: string, relative: string, detail: string): void {
  reader.issues.push({ 代码: code, 路径: relative, 说明: detail })
}

function inspectRuntime(reader: ReadonlyBookSnapshot, pending: ChapterOpeningInspection['在途项'][number][]): void {
  for (const entry of reader.listDirectory('.webnovel') ?? []) {
    const relative = `.webnovel/${entry.name}`
    if (['book.lock', 'acquire.lock', 'writer.lock'].includes(entry.name) || /^\.writer-.+\.stage$/.test(entry.name)) {
      if (entry.kind === 'directory') reader.listDirectory(relative)
      else reader.readFile(relative)
      pending.push({ 路径: relative, 种类: '写入锁或残留锁', 说明: '书仓有写入锁或中断痕迹，请先核对归属；本次没有回收或恢复' })
    } else if (entry.name === 'transactions' || entry.name === 'quarantine') {
      for (const child of reader.listDirectory(relative) ?? []) {
        const target = `${relative}/${child.name}`
        if (child.kind === 'directory') reader.listDirectory(target)
        else reader.readFile(target)
        pending.push({ 路径: target, 种类: entry.name === 'transactions' ? '事务待处理' : '隔离待核对', 说明: '存在未清理的事务证据，未执行恢复或删除' })
      }
    }
  }
}

function finalizedChapters(reader: ReadonlyBookSnapshot): FinalizedChapter[] {
  const chapters: FinalizedChapter[] = []
  const numbers = new Set<number>()
  const scopes = new Set<string>()
  for (const volume of reader.listDirectory('定稿') ?? []) {
    const volumePath = `定稿/${volume.name}`
    if (volume.name === '.gitkeep' && volume.kind === 'file') { reader.readFile(volumePath); continue }
    const volumeMatch = /^卷(\d+)$/.exec(volume.name)
    if (volume.kind !== 'directory' || volumeMatch === null || !positive(Number(volumeMatch[1]))) {
      issue(reader, 'OPENING_FINAL_PATH', volumePath, '定稿目录的卷身份无法核实')
      continue
    }
    for (const file of reader.listDirectory(volumePath) ?? []) {
      const relative = `${volumePath}/${file.name}`
      if (file.name === '.gitkeep' && file.kind === 'file') { reader.readFile(relative); continue }
      const match = /^(\d{4,})-(.+)\.md$/.exec(file.name)
      if (file.kind !== 'file' || match === null || !positive(Number(match[1])) || validateSegment(match[2]!).length > 0) {
        issue(reader, 'OPENING_FINAL_PATH', relative, '定稿文件的章节身份无法核实')
        continue
      }
      const key = { 卷: Number(volumeMatch[1]), 章: Number(match[1]), 章名: match[2]! }
      const identity = scope(key.卷, key.章名)
      if (numbers.has(key.章) || scopes.has(identity)) issue(reader, 'OPENING_CHAPTER_CONFLICT', relative, '定稿章节编号或名称存在歧义')
      numbers.add(key.章)
      scopes.add(identity)
      const text = reader.readFile(relative)
      if (text === undefined) continue
      const parsed = parseDocument(text)
      if (!parsed.ok || parsed.data.body.trim() === '') {
        issue(reader, 'OPENING_FINAL_INVALID', relative, '定稿文档无法解析或正文为空')
        continue
      }
      const fields = parsed.data.fields
      const named = fields['身份']
      const strictIdentity = record(named) && named['卷'] === key.卷 && named['章'] === key.章 && named['章名'] === key.章名
      if ((named !== undefined && !strictIdentity) || (fields['章号'] !== undefined && fields['章号'] !== key.章)
        || (fields['状态'] !== undefined && fields['状态'] !== '已定稿')) {
        issue(reader, 'OPENING_FINAL_IDENTITY', relative, '定稿元数据与路径身份或定稿状态不一致')
      }
      const recovery = fields['恢复信息']
      const origin = fields['来源快照']
      const source = record(recovery) ? recovery['来源草稿'] : record(origin) ? origin['来源草稿'] : undefined
      const sourceMatch = typeof source === 'string' ? /^草稿区\/草稿\/卷(\d+)-([^/]+)\/稿\d+\.md$/.exec(source) : null
      const sourceDraft = typeof source === 'string' && draftLengthTarget(source)?.文本阶段 === '草稿文件'
        && sourceMatch !== null && scope(Number(sourceMatch[1]), sourceMatch[2]!) === scope(key.卷, key.章名) ? source : undefined
      if (source !== undefined && sourceDraft === undefined) issue(reader, 'OPENING_DRAFT_SOURCE', relative, '定稿记录的来源草稿路径无法安全核对')
      const summary = paths.章摘要(key.卷, key.章, key.章名)
      const summaryText = reader.readFile(summary)
      const parsedSummary = summaryText === undefined ? undefined : parseDocument(summaryText)
      if (parsedSummary === undefined || !parsedSummary.ok || parsedSummary.data.body.trim() === '') issue(reader, 'OPENING_SUMMARY_MISSING', summary, '缺少可读取的章摘要，不能证明整章已经收尾')
      chapters.push({ key, relative, text, fields, summary, strictIdentity, sourceDraft, closed: false, receipts: [], sourceVerified: false })
    }
  }
  return chapters.sort((left, right) => left.key.章 - right.key.章)
}

function inspectOrphanSummaries(reader: ReadonlyBookSnapshot, chapters: readonly FinalizedChapter[]): void {
  for (const volume of reader.listDirectory('大纲/卷规划') ?? []) {
    const volumeMatch = /^卷(\d+)$/.exec(volume.name)
    if (volumeMatch === null) continue
    const directory = `大纲/卷规划/${volume.name}/章摘要`
    for (const entry of reader.listDirectory(directory) ?? []) {
      if (entry.name === '.gitkeep' && entry.kind === 'file') continue
      const relative = `${directory}/${entry.name}`
      const match = /^(\d{4,})-(.+)\.md$/.exec(entry.name)
      if (entry.kind !== 'file' || match === null) {
        issue(reader, 'OPENING_SUMMARY_IDENTITY', relative, '章摘要身份或文件类型无法核实')
        continue
      }
      reader.readFile(relative)
      if (!chapters.some(chapter => chapter.key.卷 === Number(volumeMatch[1]) && chapter.key.章 === Number(match[1]) && chapter.key.章名 === match[2])) {
        issue(reader, 'OPENING_ORPHAN_SUMMARY', relative, '章摘要没有对应的可核实定稿，不能按第一章空仓处理')
      }
    }
  }
}

function inspectReceipts(reader: ReadonlyBookSnapshot, proof: OpeningCommitProof | undefined, pending: ChapterOpeningInspection['在途项'][number][], uncommitted: Set<string>, all: ArchiveReceipt[] = []): ArchiveReceipt[] {
  const committed: ArchiveReceipt[] = []
  const receipts = readArchiveReceiptsSnapshot(reader, 'OPENING_RECEIPT_INVALID')
  all.push(...receipts)
  for (const receipt of receipts) {
    const relative = receiptRelative(receipt.scope)
    try {
      for (const output of receipt.outputs) reader.readFile(output.relPath)
      if (proof === undefined) continue
      const commit = proof.receiptCommit(receipt)
      if (commit !== undefined) {
        if (receipt.schema === 3 && !verifyRetentionOrigin(proof, receipt, receipts, commit)) throw new Error('旧章留档确认之前的归档完成与来源关系无法核实')
        committed.push(receipt)
      }
      else {
        for (const output of receipt.outputs) uncommitted.add(output.relPath)
        pending.push({ 路径: relative, 种类: '归档尚未提交', 说明: '未找到包含整批精确输出的提交，请先核对原归档；本次没有补提交' })
      }
    } catch (error) {
      issue(reader, 'OPENING_RECEIPT_INVALID', relative, error instanceof Error ? error.message : String(error))
    }
  }
  return committed
}

function closeChapters(reader: ReadonlyBookSnapshot, chapters: FinalizedChapter[], receipts: readonly ArchiveReceipt[], proof: OpeningCommitProof | undefined, uncommitted: ReadonlySet<string>, bookId: string, notices: MaintenanceIssue[], allReceipts: readonly ArchiveReceipt[] = receipts): void {
  for (const chapter of chapters) {
    if (proof === undefined) continue
    try {
      chapter.receipts = receipts.filter(receipt => receipt.outputs.some(output => output.relPath === chapter.relative))
      chapter.closed = chapter.receipts.some(receipt => proof.currentOutputs(receipt, [chapter.relative, chapter.summary]))
      const absent = retentionReceiptAbsent(chapter.relative, chapter.fields, allReceipts)
      const retained = absent ? undefined : trustedDraftRetention(proof, chapter.key, chapter.text, bookId, receipts)
      if (retained !== undefined) {
        chapter.retention = retained.manifest
        chapter.currentConfirmation = retained.currentConfirmation
        chapter.closed ||= retained.currentConfirmation
        const verification = verifyDraftRetention(reader.root, retained.manifest, { allowMissingRetained: true, reader })
        reader.issues.push(...verification.issues)
        notices.push(...missingRetentionNotices(verification.missingRetained, retained.manifest.sourceDraft))
        chapter.sourceVerified = verification.ok
      } else if (absent) notices.push(retentionReceiptAbsentNotice(chapter.relative))
      if (!chapter.closed && !uncommitted.has(chapter.relative) && chapter.strictIdentity && chapter.fields['状态'] === '已定稿'
        && typeof chapter.fields['版本'] === 'number' && positive(chapter.fields['版本'])
        && ['定稿入档', '吃书补偿'].includes(String(chapter.fields['生成模块']))) {
        chapter.closed = proof.legacyPair(chapter.relative, chapter.summary, (text, summary) => {
          const parsed = parseDocument(text)
          const parsedSummary = parseDocument(summary)
          if (!parsed.ok || !parsedSummary.ok || parsed.data.body.trim() === '' || !/^# 章摘要(?:\s|$)/.test(parsedSummary.data.body.trim())) return false
          const identity = parsed.data.fields['身份']
          return record(identity) && identity['卷'] === chapter.key.卷 && identity['章'] === chapter.key.章 && identity['章名'] === chapter.key.章名
            && parsed.data.fields['状态'] === '已定稿' && typeof parsed.data.fields['版本'] === 'number' && positive(parsed.data.fields['版本'])
            && ['定稿入档', '吃书补偿'].includes(String(parsed.data.fields['生成模块']))
        })
      }
      if (!chapter.closed && !uncommitted.has(chapter.relative)) issue(reader, 'OPENING_ARCHIVE_UNPROVEN', chapter.relative, '没有与当前归档产物相符的整批提交证据，请核对历史；仅有定稿文件或提交标题不足以证明收尾')
      if (chapter.closed && chapter.sourceDraft !== undefined && chapter.retention === undefined) {
        const sourceText = reader.readFile(chapter.sourceDraft)
        const source = sourceText === undefined ? undefined : parseDocument(sourceText)
        if (source?.ok) {
          const prose = splitCandidateFacts(source.data.body).prose
          const receiptBlobs = chapter.receipts.flatMap(receipt => receipt.outputs.filter(output => output.relPath === chapter.relative).map(output => output.gitBlob))
          chapter.sourceVerified = proof.historicalTexts(chapter.relative, receiptBlobs).some(text => {
            const archived = parseDocument(text)
            if (!archived.ok) return false
            const recovery = archived.data.fields['恢复信息']
            const origin = archived.data.fields['来源快照']
            const sourcePath = record(recovery) ? recovery['来源草稿'] : record(origin) ? origin['来源草稿'] : undefined
            return sourcePath === chapter.sourceDraft && archived.data.body.trim() === prose
          })
        }
      }
    } catch (error) {
      issue(reader, 'OPENING_HISTORY_UNAVAILABLE', chapter.relative, error instanceof Error ? error.message : String(error))
    }
  }
}

function chapterScope(name: string, suffix = ''): { volume: number; name: string } | undefined {
  const withoutSuffix = suffix === '' ? name : name.endsWith(suffix) ? name.slice(0, -suffix.length) : ''
  const match = /^卷(\d+)-(.+)$/.exec(withoutSuffix)
  if (match === null || !positive(Number(match[1])) || validateSegment(match[2]!).length > 0) return undefined
  return { volume: Number(match[1]), name: match[2]! }
}

function inspectDrafts(reader: ReadonlyBookSnapshot, chapters: readonly FinalizedChapter[], pending: ChapterOpeningInspection['在途项'][number][]): void {
  for (const directory of reader.listDirectory('草稿区/草稿') ?? []) {
    const relative = `草稿区/草稿/${directory.name}`
    const identity = chapterScope(directory.name)
    if (directory.kind !== 'directory' || identity === undefined) {
      issue(reader, 'OPENING_DRAFT_IDENTITY', relative, '草稿目录的章节身份无法核实')
      continue
    }
    const chapter = chapters.find(item => scope(item.key.卷, item.key.章名) === scope(identity.volume, identity.name))
    if (chapter?.retention !== undefined) {
      // The manifest verifier already checked every byte and member in this exact directory.
      if (relative !== chapter.retention.directory) issue(reader, 'DRAFT_RETENTION_DIRECTORY_ALIAS', relative, '此草稿目录不在该章原留档清单中，不能以归一名称合并为历史留档')
      continue
    }
    const files = reader.listDirectory(relative) ?? []
    for (const entry of files) {
      const target = `${relative}/${entry.name}`
      const recognized = draftLengthTarget(target)
      if (entry.kind !== 'file' || recognized === undefined) {
        issue(reader, 'OPENING_DRAFT_UNKNOWN', target, '草稿目录含无法归属的文件或目录，未把它当作历史留档')
        continue
      }
      const text = reader.readFile(target)
      if (text === undefined) continue
      const parsed = parseDocument(text)
      if (!parsed.ok) { issue(reader, 'OPENING_DRAFT_INVALID', target, '草稿或暂存文档无法解析'); continue }
      const fields = parsed.data.fields
      const named = fields['身份']
      if (named !== undefined && (!record(named) || named['卷'] !== identity.volume || typeof named['章名'] !== 'string' || normalizeChapterName(named['章名']) !== normalizeChapterName(identity.name))) {
        issue(reader, 'OPENING_DRAFT_IDENTITY', target, '草稿元数据与目录身份不一致')
        continue
      }
      if (chapter !== undefined && record(named) && named['章'] !== undefined && named['章'] !== chapter.key.章) {
        issue(reader, 'OPENING_DRAFT_IDENTITY', target, '草稿章号与历史定稿不一致，不能归入该章留档')
        continue
      }
      if (chapter === undefined || !chapter.closed) {
        pending.push({ 路径: target, 种类: recognized.文本阶段, 说明: '该章尚无已核实的归档收尾，请继续或恢复原章' })
      } else if (chapter.sourceDraft === undefined) {
        issue(reader, 'OPENING_HISTORICAL_DRAFT_UNKNOWN', target, '历史定稿未记录可核实的来源稿，无法区分留档与新写稿')
      } else if (!chapter.sourceVerified) {
        issue(reader, 'OPENING_DRAFT_SOURCE_CHANGED', target, '归档来源稿与历史定稿正文不一致或无法读取，不能确认只是留档')
      } else {
        const sourceNumber = /\/稿(\d+)\.md$/i.exec(chapter.sourceDraft)
        const currentNumber = /\/稿(\d+)\./i.exec(target)
        if (sourceNumber === null || currentNumber === null || Number(currentNumber[1]) > Number(sourceNumber[1])) {
          issue(reader, 'OPENING_DRAFT_AFTER_SOURCE', target, '该稿不在已归档来源稿及其前序范围内，请核对是否重新开始写作')
        } else if (recognized.文本阶段 === '起草暂存') {
          const draft = reader.readFile(target.replace(/\.起草中\.txt$/i, '.md'))
          const companion = draft === undefined ? undefined : parseDocument(draft)
          if (companion === undefined || !companion.ok || companion.data.body !== parsed.data.body) issue(reader, 'OPENING_STAGING_UNPROVEN', target, '暂存与对应的历史稿不一致，不能确认它只是留档')
        }
      }
    }
  }
}

function inspectWorkArtifacts(reader: ReadonlyBookSnapshot, chapters: readonly FinalizedChapter[], pending: ChapterOpeningInspection['在途项'][number][]): void {
  for (const kind of ['材料包', '审核', '定稿准备'] as const) {
    const base = `草稿区/${kind}`
    for (const entry of reader.listDirectory(base) ?? []) {
      const relative = `${base}/${entry.name}`
      const identity = chapterScope(entry.name, kind === '审核' ? '.json' : '')
      if (identity === undefined || entry.kind !== (kind === '审核' ? 'file' : 'directory')) {
        issue(reader, 'OPENING_ARTIFACT_UNKNOWN', relative, '过程工件的章节身份或文件类型无法核实')
        continue
      }
      const chapter = chapters.find(item => scope(item.key.卷, item.key.章名) === scope(identity.volume, identity.name))
      const children = kind === '审核' ? undefined : reader.listDirectory(relative)
      if (children !== undefined && children.length === 0) continue
      for (const child of children ?? []) {
        const target = `${relative}/${child.name}`
        if (kind === '材料包' && child.name === '补充' && child.kind === 'directory') continue
        if (child.kind !== 'file') issue(reader, 'OPENING_ARTIFACT_UNKNOWN', target, '过程工件包含无法核实的嵌套目录或链接')
        else reader.readFile(target)
      }
      const manifest = kind === '审核' ? relative : `${relative}/${kind === '材料包' ? '材料清单.json' : '清单.json'}`
      const text = reader.readFile(manifest)
      const parsed = text === undefined ? undefined : parseMachineJson(text, MACHINE_SCHEMA_VERSION)
      if (parsed === undefined || !parsed.ok) {
        issue(reader, 'OPENING_ARTIFACT_INVALID', manifest, '过程工件缺少可读取的清单或协议不受支持')
        continue
      }
      if (kind === '材料包') inspectOpeningMaterials(reader, relative, text!, identity.volume, chapter?.key.章)
      if (chapter === undefined || !chapter.closed) {
        pending.push({ 路径: relative, 种类: kind, 说明: '该章存在尚未核实收尾的过程工件，请先恢复或核对' })
        continue
      }
      if (kind === '定稿准备') {
        const body = reader.readFile(`${relative}/正文.md`)
        const summary = reader.readFile(`${relative}/章摘要.md`)
        const files = parsed.data['文件']
        if (!Array.isArray(files) || !files.some(item => record(item) && item['目标'] === chapter.relative)
          || !files.some(item => record(item) && item['目标'] === chapter.summary) || body === undefined || summary === undefined) {
          issue(reader, 'OPENING_PACKAGE_IDENTITY', relative, '待定稿包与历史归档目标不匹配，不能当作留档')
          continue
        }
        const prepared = parseDocument(body)
        if (Object.hasOwn(parsed.data, '草稿留档') || (prepared.ok && Object.hasOwn(prepared.data.fields, '草稿留档摘要'))) {
          try { assertDraftRetentionBinding(body, parseDraftRetention(parsed.data['草稿留档'])) }
          catch (error) { issue(reader, 'OPENING_PACKAGE_RETENTION', relative, error instanceof Error ? error.message : String(error)) }
        }
        const matches = chapter.receipts.some(receipt => receipt.outputs.some(output => output.relPath === chapter.relative && output.sha256 === digest(body))
          && receipt.outputs.some(output => output.relPath === chapter.summary && output.sha256 === digest(summary)))
        let confirmedOriginal = false
        if (!matches && chapter.currentConfirmation && chapter.retention !== undefined) {
          try { confirmedOriginal = addDraftRetentionAnchor(body, draftRetentionDigest(chapter.retention)) === chapter.text && summary === reader.readFile(chapter.summary) }
          catch { /* A different prepared package cannot be justified by the metadata-only confirmation. */ }
        }
        if (!matches && !confirmedOriginal && (body !== chapter.text || summary !== reader.readFile(chapter.summary))) issue(reader, 'OPENING_PACKAGE_CHANGED', relative, '待定稿包正文或摘要与可核实归档不一致，请核对原章')
      }
    }
  }
}

function inspectRetconPackages(reader: ReadonlyBookSnapshot, receipts: readonly ArchiveReceipt[], pending: ChapterOpeningInspection['在途项'][number][]): void {
  for (const entry of reader.listDirectory('草稿区/提案') ?? []) {
    if (!entry.name.startsWith('retcon-')) continue
    const relative = `草稿区/提案/${entry.name}`
    if (entry.kind !== 'directory' || !/^retcon-[a-f0-9]{64}$/.test(entry.name)) {
      issue(reader, 'OPENING_RETCON_UNKNOWN', relative, '补偿准备目录身份无法核实')
      continue
    }
    const files = reader.listDirectory(relative) ?? []
    if (files.length === 0) continue
    const receipt = receipts.find(item => item.schema === 2 && item.retcon.packageDir === relative)
    if (receipt === undefined || receipt.schema !== 2) {
      pending.push({ 路径: relative, 种类: '补偿准备待核对', 说明: '存在没有可信已提交收据的补偿准备工件' })
      continue
    }
    for (const file of files) {
      if (file.kind !== 'file' || !Object.hasOwn(receipt.retcon.inputs, file.name)) issue(reader, 'OPENING_RETCON_UNKNOWN', `${relative}/${file.name}`, '补偿工件不在已提交收据的输入集合内')
    }
    for (const [name, expected] of Object.entries(receipt.retcon.inputs)) {
      const text = reader.readFile(`${relative}/${name}`)
      if ((text === undefined ? null : digest(text)) !== expected) issue(reader, 'OPENING_RETCON_CHANGED', `${relative}/${name}`, '补偿准备工件与原收据输入不一致，请核对是否有新请求')
    }
  }
  for (const entry of reader.listDirectory('草稿区/批次') ?? []) issue(reader, 'OPENING_BATCH_UNSUPPORTED', `草稿区/批次/${entry.name}`, '存在当前未支持的批次工件，无法核实是否已经收尾')
}

/** Inspect visible evidence only; never starts a chapter or restores a transaction. */
export function inspectChapterOpening(bookRoot: string): ChapterOpeningInspection {
  return inspectChapterOpeningSnapshot(createReadonlyBookSnapshot(bookRoot))
}

/** Internal composition keeps the same checks when the caller owns the write lock. */
export function inspectChapterOpeningSnapshot(reader: ReadonlyBookSnapshot): ChapterOpeningInspection {
  const pending: ChapterOpeningInspection['在途项'][number][] = []
  const notices: MaintenanceIssue[] = []
  const contract = reader.readFile(paths.契约())
  const parsed = contract === undefined ? undefined : parseDocument(contract)
  if (parsed === undefined || !parsed.ok || typeof parsed.data.fields['书id'] !== 'string' || parsed.data.fields['书id'].trim() === '') {
    issue(reader, 'OPENING_BOOK_IDENTITY', paths.契约(), '作品契约中的书身份无法核实')
  }
  const before = readOpeningGitState(reader)
  if (before?.pending !== undefined) pending.push({ 路径: '.git', 种类: '版本库待处理', 说明: before.pending })
  for (const relative of before === undefined ? [] : openingDirtyPaths(before)) pending.push({ 路径: relative, 种类: '真源尚未提交', 说明: '相关真源存在未提交变化，不能把文件存在当成收尾' })
  inspectRuntime(reader, pending)
  const chapters = finalizedChapters(reader)
  inspectOrphanSummaries(reader, chapters)
  const proof = before?.head === undefined ? undefined : new OpeningCommitProof(reader.root, before.head)
  const uncommitted = new Set<string>()
  const allReceipts: ArchiveReceipt[] = []
  const receipts = inspectReceipts(reader, proof, pending, uncommitted, allReceipts)
  try {
    for (const receipt of listUpgradeReceipts(reader)) {
      verifyUpgradeBook(reader, receipt)
      if (before?.head !== undefined && !upgradeCommitted(reader.root, receipt, before.head)) pending.push({ 路径: upgradeReceiptPath(receipt.operationId), 种类: '维护尚未提交', 说明: '维护批次没有完整提交证明，请先按操作编号续办' })
    }
  } catch (error) {
    issue(reader, 'OPENING_UPGRADE_RECEIPT', '草稿区/.maintenance-receipts', error instanceof Error ? error.message : String(error))
  }
  closeChapters(reader, chapters, receipts, proof, uncommitted, parsed?.ok && typeof parsed.data.fields['书id'] === 'string' ? parsed.data.fields['书id'] : '', notices, allReceipts)
  inspectDrafts(reader, chapters, pending)
  inspectWorkArtifacts(reader, chapters, pending)
  inspectRetconPackages(reader, receipts, pending)
  const after = before === undefined ? undefined : readOpeningGitState(reader)
  const gitChanged = JSON.stringify(before) !== JSON.stringify(after)
  if (gitChanged) issue(reader, 'OPENING_GIT_CHANGED', '.git', '检查期间版本库状态发生变化，请重新核对')
  const observed = reader.finish()
  const snapshot: MaintenanceSnapshot = { ...observed, 稳定: observed.稳定 && !gitChanged, 指纹: digest(JSON.stringify({ files: observed.指纹, git: before })) }
  const previous = chapters.at(-1)?.key
  return {
    状态: !snapshot.稳定 || reader.issues.length > 0 ? '无法核实' : pending.length > 0 ? '需恢复' : '边界已核对',
    规则版本: 1,
    问题: uniqueMaintenanceIssues(reader.issues),
    ...(notices.length ? { 提示: uniqueMaintenanceIssues(notices) } : {}),
    在途项: pending,
    ...(previous === undefined ? {} : { 前章: previous }),
    快照: snapshot,
  }
}
