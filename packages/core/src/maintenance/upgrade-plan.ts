import { contentHash, stableJson } from '../commit/receipt'
import { parseDocument } from '../repo/frontmatter'
import { parseBookFormatVersion } from '../repo/book-format'
import { paths, LEDGER_NAMES } from '../repo/paths'
import { parseLedgerHistory } from '../ledger'
import { upgradeEffects, expectedUpgradeStaleness } from './upgrade-effects'
import { inspectBookDocumentSnapshot } from './inspection'
import { inspectChapterOpeningSnapshot } from './opening'
import { openingGit, readOpeningGitState, OpeningCommitProof } from './opening-git'
import { UpgradeReader, readUpgradeInventory, upgradeInventoryFingerprint, upgradeRootIdentity, UPGRADE_RECEIPT_DIR } from './upgrade-reader'
import { listUpgradeReceipts, upgradeCommitted, upgradeGitBlob, upgradeReceiptPath, isUpgradeTarget } from './upgrade-receipt'
import { planUpgradeRules } from './upgrade-rules'
import { isUpgradeDraft } from './upgrade-rule-draft'
import type { ChapterOpeningInspection } from './opening'
import { BOOK_UPGRADE_RULE_VERSION, type BookUpgradePreview, type UpgradeChange } from './upgrade-types'
import { uniqueMaintenanceIssues, type BookInspection, type MaintenanceIssue } from './types'

export interface PreparedBookUpgrade {
  readonly preview: BookUpgradePreview
  readonly inventoryAfter?: string
}

const issue = (代码: string, 路径: string, 说明: string): MaintenanceIssue => ({ 代码, 路径, 说明 })

function formatChange(content: string): UpgradeChange {
  const opening = /^(\uFEFF?---)(\r?\n)/.exec(content)
  if (!opening) throw new Error('未标格式的作品契约缺少可证明的 frontmatter 边界')
  const after = content.slice(0, opening[0].length) + `书仓格式版本: 1${opening[2]}` + content.slice(opening[0].length)
  return { relPath: paths.契约(), before: content, after, rules: ['C6-v1'], evidence: ['整仓拟写结果通过当前文档检查后补格式标记；内容版本及原文字节保留'] }
}

function validateCurrentConsumers(files: ReadonlyMap<string, string>): MaintenanceIssue[] {
  const issues: MaintenanceIssue[] = []
  for (const kind of LEDGER_NAMES) {
    const file = paths.账本(kind), content = files.get(file)
    if (content === undefined) continue
    const result = parseLedgerHistory(content, kind, file)
    if (!result.ok) issues.push(issue('UPGRADE_CONSUMER_REJECTED', file, result.reason ?? '当前账本读取链无法消费拟写结果'))
    for (const entry of result.entries) {
      const needed = kind === '线索' ? ['埋设点', '预期兑现区间', ...(entry.字段['状态'] === '已弃' ? ['弃因'] : [])]
        : kind === '时间线' ? ['事件', '时点', '章号', '来源', '裁决记录'] : []
      if (needed.some(name => !entry.字段[name])) issues.push(issue('UPGRADE_CONSUMER_REJECTED', file, `当前读取链未取得完整结构字段：${entry.名称}`))
    }
  }
  return issues
}

/** A failed preview exposes diagnostics only, never a fingerprint for partial writes. */
export function prepareBookUpgrade(root: string, ownedOperation?: string): PreparedBookUpgrade {
  const errors: MaintenanceIssue[] = []
  const reader = new UpgradeReader(root, new Map(), ownedOperation)
  let bookId: string | undefined, baseHead: string | undefined
  const resumable: string[] = []
  let inspectionBefore: BookInspection | undefined, inspectionAfter: BookInspection | undefined
  let expectedStaleIssues: readonly MaintenanceIssue[] = []
  let activeWork: ChapterOpeningInspection['在途项'] = []
  let notices: MaintenanceIssue[] = []
  // An early block has no identity, HEAD or inspections yet; omit those keys so the preview stays lossless JSON.
  const blocked = (): PreparedBookUpgrade => ({ preview: {
    ok: true, state: 'blocked', ruleVersion: BOOK_UPGRADE_RULE_VERSION,
    ...(bookId === undefined ? {} : { bookId }), ...(baseHead === undefined ? {} : { baseHead }),
    changes: [], effects: [], issues: uniqueMaintenanceIssues([...errors, ...reader.issues]),
    ...(inspectionBefore === undefined ? {} : { inspectionBefore }), ...(inspectionAfter === undefined ? {} : { inspectionAfter }),
    expectedStaleIssues, activeWork, ...(notices.length ? { notices } : {}), resumable: [...new Set(resumable)],
  } })
  try {
    const rootIdentity = upgradeRootIdentity(root)
    const inventory = readUpgradeInventory(reader)
    const original = inventory.files.get(paths.契约())
    const contract = original === undefined ? undefined : parseDocument(original)
    if (!contract?.ok || typeof contract.data.fields['书id'] !== 'string' || !contract.data.fields['书id'].trim()) {
      errors.push(issue('UPGRADE_BOOK_IDENTITY', paths.契约(), '无法核实作品契约中的书身份')); return blocked()
    }
    bookId = contract.data.fields['书id']
    const git = readOpeningGitState(reader)
    const config = git === undefined ? undefined : openingGit(root, ['config', '--null', '--list', '--show-origin'])
    if (config !== undefined && config.status !== 0) errors.push(issue('UPGRADE_GIT_CONFIG', '.git/config', '无法核对 Git 配置快照'))
    baseHead = git?.head
    if (git !== undefined) {
      if (!baseHead || git.pending || git.status !== '') errors.push(issue('UPGRADE_GIT_NOT_CLEAN', '.git', git.pending ?? '首次升级要求整书版本库干净且有有效提交'))
      const flags = openingGit(root, ['ls-files', '-v', '-z'])
      if (flags.status !== 0 || flags.stdout.split('\0').filter(Boolean).some(row => /^[a-zS]/.test(row))) errors.push(issue('UPGRADE_GIT_HIDDEN_CHANGES', '.git/index', '索引含跳过检查标志或无法读取，不能证明工作树干净'))
      const stages = openingGit(root, ['ls-files', '--stage', '-z'])
      if (stages.status !== 0 || stages.stdout.split('\0').filter(Boolean).some(row => !/^100(?:644|755) [a-f0-9]+ 0\t/.test(row))) errors.push(issue('UPGRADE_GIT_ENTRY', '.git/index', '版本库含非普通文件或冲突条目，不能整仓升级'))
    }
    // Receipt structure is independent evidence; history needs a verified Git state.
    for (const receipt of listUpgradeReceipts(reader)) if (baseHead !== undefined && !upgradeCommitted(root, receipt, baseHead)) resumable.push(receipt.operationId)
    for (const entry of reader.listDirectory('.webnovel/transactions') ?? []) {
      if (entry.kind !== 'directory') continue
      const manifest = reader.readFile(`.webnovel/transactions/${entry.name}/manifest.json`)
      try {
        const id: unknown = JSON.parse(manifest ?? 'null')?.provenance?.operationId
        if (typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)) resumable.push(id)
      } catch { /* Opening inspection reports invalid or pending evidence. */ }
    }
    const format = parseBookFormatVersion(original!)
    if (!format.ok && format.kind !== 'unversioned') errors.push(issue('UPGRADE_FORMAT_UNSUPPORTED', paths.契约(), format.reason))
    const rules = planUpgradeRules(inventory.files)
    errors.push(...rules.issues)
    const changes = [...rules.changes]
    if (!format.ok && format.kind === 'unversioned') changes.push(formatChange(original!))
    const openingReader = new UpgradeReader(root, new Map(changes.map(change => [change.relPath, change.after])), ownedOperation)
    const opening = inspectChapterOpeningSnapshot(openingReader)
    const pausedKinds = new Set(['草稿文件', '起草暂存', '材料包', '审核', '定稿准备'])
    activeWork = opening.在途项.filter(item => pausedKinds.has(item.种类))
    notices = uniqueMaintenanceIssues([...notices, ...(opening.提示 ?? [])])
    errors.push(...opening.问题, ...opening.在途项.filter(item => !pausedKinds.has(item.种类)).map(item => issue('UPGRADE_NOT_CLOSED', item.路径, item.说明)))
    if (!opening.快照.稳定) errors.push(issue('UPGRADE_UNSTABLE', '.', '维护边界检查期间书仓发生变化'))
    const targets = new Set<string>()
    const proof = baseHead ? new OpeningCommitProof(root, baseHead) : undefined
    for (const change of changes) {
      const key = change.relPath.normalize('NFC').toLowerCase()
      const localDraft = isUpgradeDraft(change.relPath)
      if ((!isUpgradeTarget(change.relPath) && !localDraft) || targets.has(key)) { errors.push(issue('UPGRADE_TARGET_INVALID', change.relPath, '规则目标不合法或重复')); continue }
      targets.add(key)
      if ((inventory.files.get(change.relPath) ?? null) !== change.before) errors.push(issue('UPGRADE_SOURCE_CHANGED', change.relPath, '规则原文与受检快照不一致'))
      if (proof === undefined) continue
      const tracked = proof.blob(baseHead!, change.relPath)
      if (localDraft) {
        if (change.before === null || tracked !== undefined || openingGit(root, ['check-ignore', '--quiet', '--no-index', '--', change.relPath]).status !== 0) errors.push(issue('UPGRADE_DRAFT_NOT_LOCAL', change.relPath, '草稿须为已有且未跟踪的忽略文件，不能混入真源提交'))
        continue
      }
      if (change.before === null ? tracked !== undefined : tracked !== upgradeGitBlob(root, change.relPath, change.before)) errors.push(issue('UPGRADE_SOURCE_NOT_SAVED', change.relPath, '原始目标未由当前 Git 提交完整保存'))
      if (change.before === null && openingGit(root, ['check-ignore', '--quiet', '--no-index', '--', change.relPath]).status !== 1) errors.push(issue('UPGRADE_SOURCE_IGNORED', change.relPath, '新建真源受忽略规则影响或无法核实，不能纳入同批提交'))
      // New C5 targets also need attributes checked before any write or hash filter.
      upgradeGitBlob(root, change.relPath, change.after)
    }
    const overlay = new Map(changes.map(change => [change.relPath, change.after]))
    const afterFiles = new Map([...inventory.files, ...overlay])
    const effects = upgradeEffects(inventory.files, changes)
    const sourceReader = new UpgradeReader(root, new Map(), ownedOperation)
    inspectionBefore = inspectBookDocumentSnapshot(sourceReader)
    const targetReader = new UpgradeReader(root, overlay, ownedOperation)
    const inspection = inspectionAfter = inspectBookDocumentSnapshot(targetReader)
    const expectedStale = expectedStaleIssues = expectedUpgradeStaleness(inspectionBefore, inspection, effects)
    notices = uniqueMaintenanceIssues([...notices, ...(inspection.提示 ?? [])])
    if (inspection.结论 !== '未发现已知问题' || inspection.状态 !== '已检查') errors.push(...inspection.问题.filter(problem => !expectedStale.includes(problem)),
      ...inspection.未检范围.map(item => issue('UPGRADE_UNCHECKED', item.路径, item.原因)))
    errors.push(...validateCurrentConsumers(afterFiles))
    if (!inspectionBefore.快照.稳定 || !inspection.快照.稳定) errors.push(issue('UPGRADE_UNSTABLE', '.', '原书或拟写结果检查期间书仓发生变化'))
    const afterGit = git === undefined ? undefined : readOpeningGitState(reader)
    const configAfter = config?.status === 0 && afterGit !== undefined ? openingGit(root, ['config', '--null', '--list', '--show-origin']) : undefined
    const gitChanged = git !== undefined && stableJson(afterGit) !== stableJson(git)
    const configChanged = config?.status === 0 && (configAfter?.status !== 0 || configAfter.stdout !== config.stdout)
    const originalFinal = reader.finish()
    if (gitChanged || configChanged || originalFinal.变更.length > 0) errors.push(issue('UPGRADE_STALE', '.', '预览期间文件、目录或 Git 证据变化，请重新预览'))
    // Receipt and supplemental evidence read only by an inspection must remain stable too.
    const sourceFinal = sourceReader.finish(), targetFinal = targetReader.finish(), openingFinal = openingReader.finish()
    if (!sourceFinal.稳定 || !targetFinal.稳定 || !openingFinal.稳定) {
      errors.push(issue('UPGRADE_UNSTABLE', '.', '检查前后态的来源证据在预览返回前发生变化'))
      errors.push(...openingReader.issues.filter(item => ['READ_FAILED', 'SNAPSHOT_CHANGED'].includes(item.代码)), ...sourceReader.issues.filter(item => ['READ_FAILED', 'SNAPSHOT_CHANGED'].includes(item.代码)), ...targetReader.issues.filter(item => ['READ_FAILED', 'SNAPSHOT_CHANGED'].includes(item.代码)))
    }
    if (errors.length || reader.issues.length || git === undefined || config === undefined) return blocked()
    const fingerprint = contentHash(stableJson({ rootIdentity, bookId, baseHead, ruleVersion: BOOK_UPGRADE_RULE_VERSION,
      inventory: inventory.fingerprint, gitConfig: contentHash(config.stdout), changes: changes.map(change => ({ path: change.relPath, before: change.before === null ? null : contentHash(change.before), after: contentHash(change.after), rules: change.rules })) }))
    if (openingGit(root, ['check-ignore', '--quiet', '--no-index', '--', upgradeReceiptPath(fingerprint)]).status !== 0) {
      errors.push(issue('UPGRADE_RECEIPT_NOT_IGNORED', UPGRADE_RECEIPT_DIR, '维护收据须位于书仓既有的忽略范围，预览不会修改 Git 配置')); return blocked()
    }
    return { preview: { ok: true, state: changes.length ? 'ready' : 'unchanged', ruleVersion: BOOK_UPGRADE_RULE_VERSION, bookId, baseHead,
      ...(changes.length ? { fingerprint } : {}), changes, effects, issues: [], inspectionBefore, inspectionAfter, expectedStaleIssues, activeWork, ...(notices.length ? { notices } : {}), resumable: [...new Set(resumable)] },
    inventoryAfter: upgradeInventoryFingerprint(afterFiles, [...new Set([...inventory.directories, ...(changes.length ? ['草稿区'] : [])])]) }
  } catch (error) {
    errors.push(issue('UPGRADE_PREVIEW_FAILED', '.', error instanceof Error ? error.message : String(error)))
    reader.finish()
    return blocked()
  }
}

export function previewBookUpgrade(root: string): BookUpgradePreview {
  return prepareBookUpgrade(root).preview
}
