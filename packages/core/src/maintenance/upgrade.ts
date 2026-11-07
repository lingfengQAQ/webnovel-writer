import path from 'node:path'
import { contentHash, stableJson } from '../commit/receipt'
import { commitWithIsolatedIndex, runGit } from '../commit/git'
import { withBookLock, lockIsStale, currentBookProvenance } from '../repo/lock'
import { writeBatchAtomic } from '../repo/atomic'
import { parseDocument } from '../repo/frontmatter'
import { paths } from '../repo/paths'
import { UpgradeReader, readUpgradeInventory, upgradeRootIdentity } from './upgrade-reader'
import { openingGit, readOpeningGitState } from './opening-git'
import { prepareBookUpgrade } from './upgrade-plan'
import { inspectUpgradeInterruption, recoverUpgradeInterruption, type UpgradeInterruption } from './upgrade-recovery'
import { makeUpgradeReceipt, serializeUpgradeReceipt, readUpgradeReceipt, parseUpgradeReceipt, upgradeReceiptPath,
  verifyUpgradeOutputs, verifyUpgradeBook, upgradeCommitted, upgradeCommitMessage, upgradePaths, type UpgradeReceipt } from './upgrade-receipt'
import type { BookUpgradeContext, BookUpgradeResult, BookUpgradeResumePreview } from './upgrade-types'

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)
const failure = (reason: string, operationId?: string, code = 'UPGRADE_BLOCKED'): BookUpgradeResult => ({ ok: false, state: 'blocked', code, reason, ...(operationId === undefined ? {} : { operationId }) })

function validateContext(context: BookUpgradeContext): void {
  if (context.signal?.aborted) throw new Error('本次维护已取消，没有执行新的写入')
  if (context.validateIdentity && !context.validateIdentity()) throw new Error('书身份或工作范围已变化，请重新选择作品并预览')
}

function commitUpgrade(root: string, receipt: UpgradeReceipt): BookUpgradeResult {
  const reader = new UpgradeReader(root)
  verifyUpgradeBook(reader, receipt, true)
  verifyUpgradeOutputs(reader, receipt)
  const oldCommit = upgradeCommitted(root, receipt)
  if (oldCommit !== undefined) {
    if (!reader.finish().稳定) throw new Error('核对历史提交期间维护目标已变化')
    return { ok: true, state: 'already-committed', operationId: receipt.operationId, commit: oldCommit, paths: upgradePaths(receipt), effects: receipt.effects }
  }
  const git = readOpeningGitState(reader)
  if (!git?.head || git.pending) throw new Error(git?.pending ?? '无法核对维护提交前的版本库状态')
  const targets = upgradePaths(receipt)
  const gitTargets = receipt.outputs.map(item => item.relPath)
  if (git.status.split('\0').filter(Boolean).some(row => !gitTargets.includes(row.slice(3)))) throw new Error('存在本次维护以外的未提交修改，请先保全并核对')
  for (const draft of receipt.drafts ?? []) {
    const tracked = openingGit(root, ['ls-files', '--error-unmatch', '--', draft.relPath])
    if (tracked.status !== 1 || openingGit(root, ['check-ignore', '--quiet', '--no-index', '--', draft.relPath]).status !== 0) throw new Error('本地草稿不再属于未跟踪的忽略文件，不能沿用收据提交')
  }
  if (readUpgradeInventory(reader).fingerprint !== receipt.inventoryAfter || !reader.finish().稳定) throw new Error('维护后的书仓或历史工件已经变化，不沿用原收据补交')
  const result = gitTargets.length ? commitWithIsolatedIndex(root, gitTargets, upgradeCommitMessage(receipt))
    : runGit(root, ['commit', '--only', '--allow-empty', '-m', upgradeCommitMessage(receipt)])
  const after = new UpgradeReader(root)
  try {
    verifyUpgradeOutputs(after, receipt)
    const committed = upgradeCommitted(root, receipt)
    if (readUpgradeInventory(after).fingerprint !== receipt.inventoryAfter || !after.finish().稳定) throw new Error('提交核对期间书仓文件或过程工件变化')
    if (committed !== undefined) return { ok: true, state: 'committed', operationId: receipt.operationId, commit: committed, paths: targets, effects: receipt.effects }
  } catch (error) {
    return { ok: false, state: 'written-pending-commit', operationId: receipt.operationId, paths: targets, code: 'UPGRADE_COMMIT_UNVERIFIED', reason: `维护文件已写入，提交结果尚未核实：${errorText(error)}` }
  }
  return { ok: false, state: 'written-pending-commit', operationId: receipt.operationId, paths: targets, code: 'UPGRADE_COMMIT_FAILED', reason: `维护文件已写入，但未形成可核实的完整提交：${result.stderr || '没有整批输出的提交证明'}。处理原因后按此操作编号续办` }
}

/** Called only after the host has obtained the author's approval of this exact preview. */
export function applyBookUpgrade(root: string, options: BookUpgradeContext & { readonly fingerprint: string }): BookUpgradeResult {
  const id = options.fingerprint
  try {
    validateContext(options)
    upgradeReceiptPath(id)
    const before = prepareBookUpgrade(root)
    if (before.preview.state !== 'ready' || before.preview.fingerprint !== id || before.preview.bookId !== options.bookId) return failure('预览已失效或整仓尚不可升级，请重新预览后呈报作者', id, 'UPGRADE_STALE')
    const provenance = { ...options.provenance, operationId: id, toolName: 'book-upgrade', bookRootIdentity: upgradeRootIdentity(root) }
    return withBookLock(root, () => {
      validateContext(options)
      const current = prepareBookUpgrade(root, id)
      const plan = current.preview
      if (plan.state !== 'ready' || plan.fingerprint !== id || plan.bookId !== options.bookId || !plan.baseHead || !current.inventoryAfter) return failure('锁内复验与批准预览不一致，没有写入书仓', id, 'UPGRADE_STALE')
      const receiptReader = new UpgradeReader(root)
      if (readUpgradeReceipt(receiptReader, id) !== undefined || receiptReader.issues.length) return failure('此操作已有收据或收据路径无法核实，请使用续办入口', id)
      const receipt = makeUpgradeReceipt(root, options.bookId, id, plan.baseHead, plan.changes, current.inventoryAfter, plan.effects)
      validateContext(options)
      try {
        writeBatchAtomic(root, [...plan.changes.map(change => ({ relPath: change.relPath, content: change.after })),
          { relPath: upgradeReceiptPath(id), content: serializeUpgradeReceipt(receipt) }], { provenance })
      } catch (error) {
        // A committed marker can survive a failed fsync/cleanup. Never guess a rollback.
        return failure(`维护事务未确认完成：${errorText(error)}。按操作编号核对续办；原证据保留`, id, 'UPGRADE_TRANSACTION_INCOMPLETE')
      }
      try { return commitUpgrade(root, receipt) } catch (error) {
        return { ok: false, state: 'written-pending-commit', operationId: id, paths: upgradePaths(receipt), code: 'UPGRADE_COMMIT_UNVERIFIED', reason: `维护文件已写入，提交尚未完成：${errorText(error)}` }
      }
    }, provenance)
  } catch (error) { return failure(errorText(error), id) }
}

function checkResumeLocks(reader: UpgradeReader, operationId: string): void {
  const owned = currentBookProvenance(reader.root)?.operationId === operationId
  const owner = (relative: string): void => {
    const raw = reader.readFile(relative)
    if (raw === undefined) throw new Error('维护锁归属无法读取')
    const value = JSON.parse(raw) as { operationId?: unknown; toolName?: unknown }
    if (value.operationId !== operationId || value.toolName !== 'book-upgrade'
      || (!owned && !lockIsStale(path.join(reader.root, relative)))) throw new Error('存在其他活跃或无法核实的写入锁，不能续办')
  }
  for (const entry of reader.listDirectory('.webnovel') ?? []) {
    if (entry.name === 'book.lock' && entry.kind === 'file') owner('.webnovel/book.lock')
    else if (entry.name === 'writer.lock' && entry.kind === 'directory') {
      const members = reader.listDirectory('.webnovel/writer.lock')
      if (members?.length !== 1 || members[0]?.kind !== 'file' || !/^owner-[a-f0-9-]+\.json$/.test(members[0].name)) throw new Error('写入互斥锁归属无法核实')
      owner(`.webnovel/writer.lock/${members[0].name}`)
    } else if (entry.name === 'acquire.lock' || /^\.writer-.*\.stage$/.test(entry.name) || entry.name === 'book.lock' || entry.name === 'writer.lock') throw new Error('存在未完成的锁操作，须先人工核对')
  }
}

interface ResumePrepared {
  readonly preview: BookUpgradeResumePreview
  readonly receipt?: UpgradeReceipt
  readonly interruption?: UpgradeInterruption
}

function prepareResume(root: string, operationId: string, ownedOperation?: string): ResumePrepared {
  const reader = new UpgradeReader(root, new Map(), ownedOperation)
  let bookId: string | undefined
  try {
    upgradeReceiptPath(operationId)
    checkResumeLocks(reader, operationId)
    const contract = reader.readFile(paths.契约())
    const parsed = contract === undefined ? undefined : parseDocument(contract)
    if (!parsed?.ok || typeof parsed.data.fields['书id'] !== 'string' || !parsed.data.fields['书id'].trim()) throw new Error('当前书身份无法核实')
    bookId = parsed.data.fields['书id']
    const beforeGit = readOpeningGitState(reader)
    if (!beforeGit?.head || beforeGit.pending) throw new Error(beforeGit?.pending ?? '版本库状态无法核实')
    const interruption = inspectUpgradeInterruption(reader, operationId)
    const receipt = interruption?.receiptText === undefined ? readUpgradeReceipt(reader, operationId) : parseUpgradeReceipt(interruption.receiptText, operationId)
    if (receipt !== undefined) verifyUpgradeBook(reader, receipt, true)
    if (interruption === undefined && receipt === undefined) throw new Error('没有此操作的可信收据或中断事务，不能推断已完成升级')
    let state: BookUpgradeResumePreview['state'] = interruption?.phase === 'interrupted' ? 'interrupted' : 'pending-commit'
    let commit: string | undefined
    const targets = receipt ? upgradePaths(receipt) : interruption!.paths
    if (state !== 'interrupted') {
      if (receipt === undefined) throw new Error('已落盘事务缺少可校验的维护收据')
      verifyUpgradeOutputs(reader, receipt)
      const committed = upgradeCommitted(root, receipt, beforeGit.head)
      if (committed !== undefined) { state = interruption === undefined ? 'committed' : 'pending-commit'; commit = committed }
      else if (readUpgradeInventory(reader).fingerprint !== receipt.inventoryAfter) throw new Error('维护后的文件或过程工件已被修改，不沿用旧收据提交')
    }
    if (state !== 'committed' && beforeGit.status.split('\0').filter(Boolean).some(row => !targets.includes(row.slice(3))
      && !(row.startsWith('?? ') && interruption?.transientPaths.includes(row.slice(3))))) throw new Error('存在维护目标之外的未提交修改，不能续办写入')
    const afterGit = readOpeningGitState(reader)
    if (stableJson(beforeGit) !== stableJson(afterGit) || !reader.finish().稳定) throw new Error('续办预览期间证据变化，请重新核对')
    // Exclude the caller's transient lock files; include all data that author approval can affect.
    const fingerprint = contentHash(stableJson({ bookId, operationId, git: beforeGit, interruption: interruption?.fingerprint,
      receipt: receipt === undefined ? undefined : contentHash(serializeUpgradeReceipt(receipt)), inventory: readUpgradeInventory(reader).fingerprint }))
    if (!reader.finish().稳定) throw new Error('续办快照发生变化')
    const reason = state === 'interrupted' ? '恢复本次中断的文件批次：已落位文件还原为本次升级前的内容，并清理本批临时文件。之后须重新预览并取得新的升级批准'
      : state === 'committed' ? '已核实整批升级属于同一次提交；本次只返回原提交证明，不再写入或提交'
        : commit === undefined ? '保留已写入的升级文件；核验原收据后只补本次 Git 提交，不再执行转换'
          : '已核实整批提交；只清理这次已完成事务的残留证据，不改写业务文件或新增提交'
    return { preview: { ok: true, bookId, operationId, fingerprint, state, paths: targets, reason,
      ...(receipt === undefined ? {} : { effects: receipt.effects, outputs: receipt.outputs, drafts: receipt.drafts }), ...(commit === undefined ? {} : { commit }) }, receipt, interruption }
  } catch (error) { return { preview: { ok: false, bookId, operationId, state: 'blocked', paths: [], reason: errorText(error) } } }
}

export function previewBookUpgradeResume(root: string, operationId: string): BookUpgradeResumePreview {
  return prepareResume(root, operationId).preview
}

/** Resume never repeats the transform. An interrupted batch restores first, then needs a fresh preview. */
export function resumeBookUpgrade(root: string, options: BookUpgradeContext & { readonly operationId: string; readonly fingerprint: string }): BookUpgradeResult {
  const id = options.operationId
  try {
    validateContext(options)
    const before = prepareResume(root, id)
    if (!before.preview.ok || before.preview.fingerprint !== options.fingerprint || before.preview.bookId !== options.bookId) return failure(before.preview.reason ?? '续办预览已变化，请重新呈报作者', id, 'UPGRADE_STALE')
    if (before.preview.state === 'committed' && before.interruption === undefined) return { ok: true, state: 'already-committed', operationId: id, commit: before.preview.commit, paths: before.preview.paths, effects: before.preview.effects }
    const provenance = { ...options.provenance, operationId: id, toolName: 'book-upgrade', bookRootIdentity: upgradeRootIdentity(root) }
    return withBookLock(root, () => {
      validateContext(options)
      const current = prepareResume(root, id, id)
      if (!current.preview.ok || current.preview.fingerprint !== options.fingerprint || current.preview.bookId !== options.bookId) return failure(current.preview.reason ?? '锁内续办证据已变化', id, 'UPGRADE_STALE')
      if (current.interruption !== undefined) {
        recoverUpgradeInterruption(root, id, current.interruption.fingerprint)
        if (current.interruption.phase === 'interrupted') return { ok: true, state: 'recovered', operationId: id, paths: current.interruption.paths, reason: '本次中断文件批次已恢复到原状态；如需升级，请重新预览并取得作者批准' }
      }
      if (current.receipt === undefined) return failure('维护收据不存在，不能补提交', id)
      return commitUpgrade(root, current.receipt)
    }, provenance)
  } catch (error) { return failure(errorText(error), id) }
}
