import path from 'node:path'
import { createHash } from 'node:crypto'
import { currentBookProvenance, TRANSACTION_DIR } from '../repo/lock'
import { recoverTransactions, QUARANTINE_DIR } from '../repo/transaction'
import { checkCommitRelPath } from '../commit/paths'
import { classifyDocumentPath } from '../repo/document-types'
import { createReadonlyBookSnapshot, type ReadonlyBookSnapshot } from './snapshot'
import { upgradeRootIdentity } from './upgrade-reader'
import { isUpgradeDraft } from './upgrade-rule-draft'

const HASH = /^[a-f0-9]{64}$/
const TX_ID = /^[A-Za-z0-9_-]{1,120}$/
const SOURCE_UNITS = new Set(['I01', 'I11', 'I14', 'I15', 'I19', 'I20', 'I21'])
const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const identity = (relative: string): string => process.platform === 'win32' ? relative.toLowerCase() : relative

export interface UpgradeInterruption {
  /** Business files only; the internal receipt is not a Git target. */
  readonly paths: readonly string[]
  readonly fingerprint: string
  readonly phase: 'interrupted' | 'committed'
  readonly manifestPaths: readonly string[]
  /** Existing, hash-validated engine temporary files; never commit targets. */
  readonly transientPaths: readonly string[]
  readonly receiptText?: string
}

function require(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(`维护续办拒绝：${reason}；已保留事务证据`)
}

function safeRelative(value: unknown): value is string {
  return typeof value === 'string' && !path.isAbsolute(value) && !/[\\\x00-\x1f<>:"|?*]/.test(value)
    && value.split('/').every(part => part !== '' && part !== '.' && part !== '..' && part.trim() === part)
}

/**
 * Read only the selected operation's complete recovery evidence. The general
 * recovery engine handles every pending transaction, so every other entry must
 * be rejected before that engine can be called by this maintenance entry point.
 */
export function inspectUpgradeInterruption(reader: ReadonlyBookSnapshot, operationId: string): UpgradeInterruption | undefined {
  require(HASH.test(operationId), '操作编号无效')
  const observations: [string, 'file' | 'directory', unknown][] = []
  const read = (relative: string): string | undefined => {
    const content = reader.readFile(relative)
    observations.push([relative, 'file', content === undefined ? null : hash(content)])
    return content
  }
  const list = (relative: string) => {
    const contents = reader.listDirectory(relative)
    observations.push([relative, 'directory', contents ?? null])
    return contents ?? []
  }
  const finish = (): void => {
    require(reader.finish().稳定 && !reader.issues.some(issue => issue.代码 === 'READ_FAILED'), '恢复证据无法完整读取或已变化')
  }
  require(list(QUARANTINE_DIR).length === 0, '存在隔离事务，须先核对隔离证据')
  const transactions = list(TRANSACTION_DIR)
  if (transactions.length === 0) { finish(); return undefined }
  require(transactions.length === 1, '存在其他事务，不能在本次续办中一起恢复')
  const transaction = transactions[0]!
  const suffix = /\.(preparing|done)$/.exec(transaction.name)?.[1]
  const transactionId = suffix === undefined ? transaction.name : transaction.name.slice(0, -(suffix.length + 1))
  require(transaction.kind === 'directory' && TX_ID.test(transactionId), '事务目录未知，不能猜测归属')
  const directory = `${TRANSACTION_DIR}/${transaction.name}`
  const manifestPath = `${directory}/manifest.json`
  const members = list(directory)
  require(members.length === 2 && members.some(member => member.name === 'manifest.json' && member.kind === 'file')
    && members.some(member => member.name === 'backups' && member.kind === 'directory'), '事务目录缺少清单或包含无法核实的文件')
  const manifestText = read(manifestPath)
  require(manifestText !== undefined, '事务清单不存在')
  let raw: unknown
  try { raw = JSON.parse(manifestText) } catch { throw new Error('维护续办拒绝：事务清单无法解析；已保留事务证据') }
  require(object(raw) && raw.schemaVersion === 1 && raw.id === transactionId && typeof raw.createdAt === 'string'
    && Array.isArray(raw.entries) && raw.entries.length >= 2, '事务清单协议或条目无效')
  require(object(raw.provenance) && raw.provenance.operationId === operationId && raw.provenance.toolName === 'book-upgrade', '事务不属于本次书仓升级')
  require(raw.provenance.bookRootIdentity === upgradeRootIdentity(reader.root), '事务不属于当前物理书仓，不能在副本中沿用旧操作')
  require(typeof raw.phase === 'string' && ['staged', 'backed-up', 'applying', 'committed'].includes(raw.phase), '事务阶段无效')
  if (suffix === 'preparing') require(raw.phase === 'staged', '准备目录包含不应存在的已发布阶段')
  if (suffix === 'done') require(raw.phase === 'committed', '清理目录没有完整落盘证明')

  const receiptPath = `草稿区/.maintenance-receipts/${operationId}.json`
  const targets = new Set<string>()
  const backups = new Set<string>()
  const paths: string[] = []
  const transientPaths: string[] = []
  let receiptCount = 0
  let receiptText: string | undefined
  let unbacked = false
  let unapplied = false
  for (const [index, entry] of raw.entries.entries()) {
    require(object(entry) && safeRelative(entry.relPath) && safeRelative(entry.tmpRel) && safeRelative(entry.backupRel), '事务目标或临时路径无效')
    const relative = entry.relPath
    const receipt = relative === receiptPath
    require(!targets.has(identity(relative)), '事务目标重复或大小写冲突')
    targets.add(identity(relative))
    if (receipt) receiptCount++
    else {
      const routed = classifyDocumentPath(relative)
      require((checkCommitRelPath(relative).ok && routed?.units.some(unit => SOURCE_UNITS.has(unit)) || isUpgradeDraft(relative))
        && relative.split('/').every(part => !part.startsWith('.')), '事务目标不在维护规则的真源范围内')
      paths.push(relative)
    }
    const expectedTmp = path.posix.join(path.posix.dirname(relative), `.webnovel-txn-${transactionId}-${index}.tmp`)
    const expectedBackup = `${TRANSACTION_DIR}/${transactionId}/backups/${index}.bak`
    require(entry.tmpRel === expectedTmp && entry.backupRel === expectedBackup, '事务临时文件或备份不在原批次位置')
    backups.add(`${index}.bak`)
    require(typeof entry.contentHash === 'string' && HASH.test(entry.contentHash)
      && typeof entry.hadOriginal === 'boolean' && typeof entry.backupRecorded === 'boolean' && typeof entry.applied === 'boolean'
      && (entry.hadOriginal ? typeof entry.originalHash === 'string' && HASH.test(entry.originalHash) : entry.originalHash === null), '事务恢复字段无效')
    require(!receipt || !entry.hadOriginal, '维护收据不能覆盖既有收据')
    require(!isUpgradeDraft(relative) || !entry.backupRecorded || entry.hadOriginal, '草稿身份迁移必须保留已有原稿备份')
    if (!entry.backupRecorded) unbacked = true
    else require(!unbacked, '事务备份记录次序无效')
    if (!entry.applied) unapplied = true
    else require(!unapplied && entry.backupRecorded, '事务落位记录次序无效')
    if (raw.phase !== 'staged') require(entry.backupRecorded, '事务阶段与备份记录不符')
    if (raw.phase === 'committed') require(entry.applied, '已落盘事务缺少落位记录')
    if (raw.phase === 'staged' || raw.phase === 'backed-up') require(!entry.applied, '事务阶段与落位记录不符')
    if (!entry.backupRecorded) require(!entry.hadOriginal && entry.originalHash === null, '未记录备份的条目不能声明原值')
    if (suffix === 'preparing') require(!entry.backupRecorded && !entry.applied, '准备目录不能已有备份或落位记录')

    // .done is a renamed transaction container. Its manifest deliberately
    // retains original backup paths; verify remaining bytes at the relocation.
    const backup = read(`${directory}/backups/${index}.bak`)
    const current = read(relative)
    const temporary = read(entry.tmpRel)
    const restored = read(`${entry.tmpRel}.restore`)
    const currentHash = current === undefined ? null : hash(current)
    if (entry.backupRecorded) {
      require(entry.hadOriginal ? (suffix === 'done' && backup === undefined) || backup !== undefined && hash(backup) === entry.originalHash : backup === undefined, '原文备份缺失或校验失败')
      require(currentHash === entry.originalHash || (entry.applied && currentHash === entry.contentHash), '目标已被另行修改或删除，不得覆盖作者修改')
      if (raw.phase === 'committed') require(currentHash === entry.contentHash, '已落盘目标与本次输出不一致')
    } else if (backup !== undefined) {
      // A process can die after writing the backup but before publishing its
      // manifest entry. The engine will not restore an unrecorded backup.
      require(current !== undefined && backup === current, '尚未登记的备份与当前原文不符')
    }
    if (suffix !== undefined) require(temporary === undefined && restored === undefined, '准备或清理目录之外留有不符合阶段的临时输出')
    if (suffix === 'preparing') require(backup === undefined, '准备目录含尚未获发布的备份，不能猜测清理')
    if (temporary !== undefined) {
      require(hash(temporary) === entry.contentHash, '待落位内容与清单指纹不符')
      transientPaths.push(entry.tmpRel)
    }
    if (restored !== undefined) {
      require(entry.hadOriginal && hash(restored) === entry.originalHash, '恢复临时文件与原文指纹不符')
      transientPaths.push(`${entry.tmpRel}.restore`)
    }
    if (receipt) {
      require(current === undefined || entry.applied, '尚未落位的收据路径已被占用')
      if (current !== undefined) receiptText = current
      else if (temporary !== undefined) receiptText = temporary
    }
  }
  require(receiptCount === 1, '事务缺少本次专用维护收据')
  for (const entry of list(`${directory}/backups`)) require(entry.kind === 'file' && backups.has(entry.name), '备份目录包含未登记的文件')
  finish()
  return {
    paths,
    phase: raw.phase === 'committed' ? 'committed' : 'interrupted',
    manifestPaths: [manifestPath],
    transientPaths,
    fingerprint: hash(JSON.stringify({ root: reader.root, operationId, observations })),
    ...(receiptText === undefined ? {} : { receiptText }),
  }
}

/** Must run inside the caller's already acquired upgrade lock. */
export function recoverUpgradeInterruption(root: string, operationId: string, expectedFingerprint: string): void {
  const owner = currentBookProvenance(root)
  require(owner?.operationId === operationId && owner.toolName === 'book-upgrade', '没有持有本次升级的书仓锁')
  const current = inspectUpgradeInterruption(createReadonlyBookSnapshot(root), operationId)
  require(current !== undefined && HASH.test(expectedFingerprint) && current.fingerprint === expectedFingerprint, '恢复证据已变化，请重新预览')
  recoverTransactions(root)
}
