import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { contentHash, stableJson } from '../commit/receipt'
import { checkCommitRelPath } from '../commit/paths'
import { relPathProblem } from '../repo/rel-path'
import { parseDocument } from '../repo/frontmatter'
import { paths } from '../repo/paths'
import { openingGit, externalFilterPath, OpeningCommitProof } from './opening-git'
import type { ReadonlyBookSnapshot } from './snapshot'
import { UPGRADE_RECEIPT_DIR, upgradeRootIdentity } from './upgrade-reader'
import type { UpgradeChange, UpgradeEffect } from './upgrade-types'
import { isUpgradeDraft } from './upgrade-rule-draft'

const HASH = /^[a-f0-9]{64}$/
const OBJECT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

export interface UpgradeReceipt {
  readonly schema: 1 | 2
  readonly ruleVersion: 1 | 2
  readonly operationId: string
  readonly bookId: string
  readonly rootIdentity: string
  readonly baseHead: string
  readonly message: string
  readonly inventoryAfter: string
  readonly effects: readonly UpgradeEffect[]
  readonly outputs: readonly { readonly relPath: string; readonly before: string | null; readonly sha256: string; readonly gitBlob: string }[]
  readonly drafts?: readonly { readonly relPath: string; readonly before: string; readonly after: string; readonly sha256: string }[]
}

export const upgradePaths = (receipt: UpgradeReceipt): string[] => [...receipt.outputs.map(item => item.relPath), ...(receipt.drafts ?? []).map(item => item.relPath)]

/** A schema-2 commit binds the entire local receipt, including draft backups never added to Git. */
export function upgradeCommitMessage(receipt: UpgradeReceipt): string {
  return receipt.schema === 1 ? receipt.message : `${receipt.message}\n\nScriptor-Maintenance: ${contentHash(serializeUpgradeReceipt(receipt))}`
}

export function upgradeReceiptPath(operationId: string): string {
  if (!HASH.test(operationId)) throw new Error('维护操作编号须为预览的完整指纹')
  return `${UPGRADE_RECEIPT_DIR}/${operationId}.json`
}

export function isUpgradeTarget(relative: string): boolean {
  return relPathProblem(relative, { strict: true }) === null && checkCommitRelPath(relative).ok
    && (relative === paths.契约() || /^账本\/(?:线索|时间线)\.md$/.test(relative)
      || /^本书记忆\/[^/]+\.md$/.test(relative) || /^世界书\/[^/]+\/[^/]+\.md$/.test(relative))
}

export function parseUpgradeReceipt(text: string, operationId: string): UpgradeReceipt {
  upgradeReceiptPath(operationId)
  const envelope: unknown = JSON.parse(text)
  if (!object(envelope) || !object(envelope['receipt']) || envelope['checksum'] !== contentHash(stableJson(envelope['receipt']))) throw new Error('维护收据校验失败，原证据已保留')
  const value = envelope['receipt']
  if ((value['schema'] !== 1 && value['schema'] !== 2) || (value['ruleVersion'] !== 1 && value['ruleVersion'] !== 2) || value['operationId'] !== operationId
    || typeof value['bookId'] !== 'string' || !value['bookId'].trim() || /[\r\n]/.test(value['bookId'])
    || typeof value['rootIdentity'] !== 'string' || !value['rootIdentity']
    || typeof value['baseHead'] !== 'string' || !OBJECT.test(value['baseHead'])
    || value['message'] !== `fix: 书仓格式升级 ${operationId.slice(0, 12)}`
    || typeof value['inventoryAfter'] !== 'string' || !HASH.test(value['inventoryAfter'])
    || !Array.isArray(value['outputs']) || !Array.isArray(value['effects'])) throw new Error('维护收据协议或书身份无效')
  for (const effect of value['effects']) if (!object(effect) || typeof effect['path'] !== 'string' || relPathProblem(effect['path'], { strict: true }) !== null
    || typeof effect['reason'] !== 'string' || !Array.isArray(effect['sources']) || effect['sources'].some(source => typeof source !== 'string' || !(isUpgradeTarget(source) || value['schema'] === 2 && isUpgradeDraft(source)))) throw new Error('维护收据的依赖影响记录无效')
  const names = new Set<string>()
  for (const output of value['outputs']) {
    if (!object(output) || typeof output['relPath'] !== 'string' || !isUpgradeTarget(output['relPath'])
      || typeof output['sha256'] !== 'string' || !HASH.test(output['sha256'])
      || typeof output['gitBlob'] !== 'string' || !OBJECT.test(output['gitBlob'])
      || !(output['before'] === null || typeof output['before'] === 'string' && HASH.test(output['before']))
      || names.has(output['relPath'].normalize('NFC').toLowerCase())) throw new Error('维护收据目标不合法或重复')
    names.add(output['relPath'].normalize('NFC').toLowerCase())
  }
  if (value['schema'] === 1 && (value['drafts'] !== undefined || value['outputs'].length === 0)) throw new Error('旧收据不得携带本地草稿目标')
  if (value['schema'] === 2) {
    if (value['ruleVersion'] !== 2 || !Array.isArray(value['drafts']) || value['drafts'].length === 0) throw new Error('本地草稿维护收据缺少完整备份')
    for (const draft of value['drafts']) {
      if (!object(draft) || typeof draft['relPath'] !== 'string' || !isUpgradeDraft(draft['relPath'])
        || typeof draft['before'] !== 'string' || typeof draft['after'] !== 'string' || draft['before'] === draft['after']
        || draft['sha256'] !== contentHash(draft['after']) || names.has(draft['relPath'].normalize('NFC').toLowerCase())) throw new Error('本地草稿维护目标或备份无效')
      names.add(draft['relPath'].normalize('NFC').toLowerCase())
    }
  }
  return value as unknown as UpgradeReceipt
}

export function readUpgradeReceipt(reader: ReadonlyBookSnapshot, operationId: string): UpgradeReceipt | undefined {
  const value = reader.readFile(upgradeReceiptPath(operationId))
  return value === undefined ? undefined : parseUpgradeReceipt(value, operationId)
}

export function listUpgradeReceipts(reader: ReadonlyBookSnapshot): UpgradeReceipt[] {
  const result: UpgradeReceipt[] = []
  for (const entry of reader.listDirectory(UPGRADE_RECEIPT_DIR) ?? []) {
    if (entry.kind !== 'file' || !/^[a-f0-9]{64}\.json$/.test(entry.name)) throw new Error('维护收据目录含未知或非普通文件，已保留供核对')
    const receipt = readUpgradeReceipt(reader, entry.name.slice(0, -5))
    if (receipt === undefined) throw new Error('维护收据读取失败或已消失')
    result.push(receipt)
  }
  return result
}

/** Git clean normalization can differ from raw SHA-256; external filters are never run here. */
export function upgradeGitBlob(root: string, relative: string, content: string): string {
  if (!isUpgradeTarget(relative)) throw new Error('迁移目标不属于已批准规则范围')
  if (externalFilterPath(root, [relative]) !== undefined) throw new Error('迁移目标配置外部 Git 过滤器，未执行该程序')
  const result = spawnSync('git', ['--no-optional-locks', '--no-lazy-fetch', '--literal-pathspecs', '-c', 'core.fsmonitor=false', 'hash-object', `--path=${relative}`, '--stdin'], {
    cwd: root, input: content, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  })
  if (result.status !== 0 || !OBJECT.test(result.stdout.trim())) throw new Error(`无法计算 Git 格式指纹：${relative}`)
  return result.stdout.trim()
}

export function makeUpgradeReceipt(root: string, bookId: string, operationId: string, baseHead: string, changes: readonly UpgradeChange[], inventoryAfter: string, effects: readonly UpgradeEffect[] = []): UpgradeReceipt {
  const drafts = changes.filter(change => isUpgradeDraft(change.relPath)).map(change => {
    if (change.before === null) throw new Error('草稿身份迁移不得创建新稿')
    return { relPath: change.relPath, before: change.before, after: change.after, sha256: contentHash(change.after) }
  })
  return {
    schema: drafts.length ? 2 : 1, ruleVersion: 2, operationId, bookId, rootIdentity: upgradeRootIdentity(root), baseHead, inventoryAfter, effects,
    message: `fix: 书仓格式升级 ${operationId.slice(0, 12)}`,
    outputs: changes.filter(change => !isUpgradeDraft(change.relPath)).map(change => ({ relPath: change.relPath, before: change.before === null ? null : contentHash(change.before), sha256: contentHash(change.after), gitBlob: upgradeGitBlob(root, change.relPath, change.after) })),
    ...(drafts.length ? { drafts } : {}),
  }
}

export function serializeUpgradeReceipt(receipt: UpgradeReceipt): string {
  return stableJson({ checksum: contentHash(stableJson(receipt)), receipt }) + '\n'
}

/** Historical proof is separate from current output verification, so later writing stays legal. */
export function upgradeCommitted(root: string, receipt: UpgradeReceipt, head?: string): string | undefined {
  const current = head ?? openingGit(root, ['rev-parse', '--verify', 'HEAD']).stdout.trim()
  if (!OBJECT.test(current) || openingGit(root, ['merge-base', '--is-ancestor', receipt.baseHead, current]).status !== 0) throw new Error('维护收据的基线不在当前历史中')
  const history = openingGit(root, ['rev-list', `${receipt.baseHead}..${current}`])
  if (history.status !== 0) throw new Error('无法只读核对维护提交历史')
  const proof = new OpeningCommitProof(root, current)
  for (const commit of history.stdout.trim().split('\n').filter(Boolean)) {
    if (receipt.schema === 2) {
      const message = openingGit(root, ['show', '-s', '--format=%B', commit])
      if (message.status !== 0) throw new Error('无法核对维护提交的本地收据绑定')
      if (message.stdout.trimEnd() !== upgradeCommitMessage(receipt)) continue
    }
    if (!receipt.outputs.every(output => proof.blob(commit, output.relPath) === output.gitBlob)) continue
    const changed = openingGit(root, ['diff-tree', '--root', '--no-commit-id', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv', '-r', '-z', commit])
    const lineage = openingGit(root, ['rev-list', '--parents', '-n', '1', commit])
    if (changed.status !== 0 || lineage.status !== 0) throw new Error('无法核对维护同批提交的变更范围')
    const names = new Set(changed.stdout.split('\0').filter(Boolean))
    const parents = lineage.stdout.trim().split(' ').slice(1)
    if (parents.length === 1 && (receipt.schema === 1 || names.size === receipt.outputs.length)
      && receipt.outputs.every(output => names.has(output.relPath)
      && proof.blob(parents[0]!, output.relPath) === proof.blob(receipt.baseHead, output.relPath))) return commit
  }
  return undefined
}

export function verifyUpgradeOutputs(reader: ReadonlyBookSnapshot, receipt: UpgradeReceipt): void {
  for (const output of [...receipt.outputs, ...(receipt.drafts ?? [])]) {
    const content = reader.readFile(output.relPath)
    if (content === undefined || contentHash(content) !== output.sha256) throw new Error(`维护目标已变化，保留当前内容：${output.relPath}`)
  }
}

export function verifyUpgradeBook(reader: ReadonlyBookSnapshot, receipt: UpgradeReceipt, requirePhysicalRoot = false): void {
  if (requirePhysicalRoot && receipt.rootIdentity !== upgradeRootIdentity(reader.root)) throw new Error('维护收据属于不同的物理书仓，不能沿用旧批准续办')
  const contract = reader.readFile(paths.契约())
  const parsed = contract === undefined ? undefined : parseDocument(contract)
  if (!parsed?.ok || parsed.data.fields['书id'] !== receipt.bookId) throw new Error('维护收据与当前书身份不一致')
}

export function upgradeReceiptId(relative: string): string {
  return path.posix.basename(relative, '.json')
}
