/**
 * 审核编排辅助:方案留痕 + 注册检查执行。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  MACHINE_SCHEMA_VERSION,
  countPendingReviewDrafts,
  emptyReviewRecord,
  extractVersionFields,
  findPendingReviewDraft,
  loadReviewRecord,
  parseDocument,
  paths,
  planReviewRecord,
  writeReviewRecord,
  normalizeFinding,
  draftHashOf,
  reviewInputFingerprintOf,
  loadMaterialPackage,
  type LoadedMaterialPackage,
  type ChapterKey,
  type Finding,
  type ModuleRunState,
  type ReviewPlan,
  type ReviewRecord,
  type ReviewDisposition,
} from '@webnovel/core'
import { 作者意见模块名, findingId, registerDefaultChecks } from './checks'
import { getCheck, listChecks } from './registry'
import { bookWriter } from '@webnovel/core'

export interface ReviewKey {
  readonly 卷: number
  readonly 章: number
  readonly 章名: string
}

export interface RunReviewResult {
  readonly ok: boolean
  readonly reason?: string
  readonly record: ReviewRecord | null
  readonly 材料段?: Readonly<Record<string, string>>
}

function readText(root: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf-8')
  } catch {
    return null
  }
}

function reviewId(key: ReviewKey): string {
  return `审-${String(key.卷).padStart(2, '0')}-${String(key.章).padStart(4, '0')}`
}

function reviewInput(bookRoot: string, key: ReviewKey, plan: ReviewPlan | undefined): { body: string; bodyHash: string; fingerprint: string; materials: LoadedMaterialPackage } | null {
  const pending = findPendingReviewDraft(bookRoot, key)
  if (pending === null) return null
  const outline = readText(bookRoot, paths.确认细纲(key.卷, key.章, key.章名)) ?? ''
  const materials = loadMaterialPackage(bookRoot, key)
  return {
    body: pending.body,
    bodyHash: draftHashOf(pending.body),
    fingerprint: reviewInputFingerprintOf({ 正文: pending.body, 细纲: outline, 材料清单: materials.审读材料标识, 方案: plan }),
    materials,
  }
}

/** 身份三元组分隔符:单元分隔符不会出现在发现项文本里。 */
const FINDING_KEY_SEP = '\u001F'

/**
 * 发现项身份:发现项编号按轮次内序号生成(前一项被解决后序号会平移),
 * 因此跨轮认亲只能用语义三元组,否则会把处置带给另一个问题。
 */
function findingIdentity(finding: Pick<Finding, '模块名' | '证据位置' | '问题说明'>): string {
  return [finding.模块名, finding.证据位置, finding.问题说明].join(FINDING_KEY_SEP)
}

function dispositionMap(record: ReviewRecord): Map<string, ReviewDisposition> {
  const result = new Map<string, ReviewDisposition>()
  for (const item of [...(record.待继承处置 ?? []), ...record.问题]) {
    if (item.处置状态 === '待处理') continue
    const { 模块名, 证据位置, 问题说明, 处置状态, 处置说明 } = item
    result.set(findingIdentity(item), { 模块名, 证据位置, 问题说明, 处置状态,
      ...(处置说明 === undefined ? {} : { 处置说明 }) })
  }
  return result
}

function inheritDisposition(finding: Finding, previous: Map<string, ReviewDisposition>): Finding {
  const old = previous.get(findingIdentity(finding))
  return old === undefined ? finding : { ...finding, 处置: old.处置状态, 处置状态: old.处置状态,
    ...(old.处置说明 === undefined ? {} : { 处置说明: old.处置说明 }) }
}

function remainingDispositions(record: ReviewRecord, resetting: boolean, processed: ReadonlySet<string>): ReviewDisposition[] {
  const active = new Set(listChecks().filter(c => c.执行形态 !== '作者').map(c => c.名称))
  const prior = resetting ? [...dispositionMap(record).values()] : record.待继承处置 ?? []
  return prior.filter(item => active.has(item.模块名) && !processed.has(item.模块名))
}

function planReviewLocked(bookRoot: string, key: ReviewKey, plan: ReviewPlan): ReviewRecord {
  registerDefaultChecks()
  return planReviewRecord(bookRoot, key, plan)
}

export const planReview = bookWriter(planReviewLocked)

export function computeReview(bookRoot: string, key: ReviewKey): RunReviewResult {
  registerDefaultChecks()
  const pendingCount = countPendingReviewDrafts(bookRoot, key)
  const pending = findPendingReviewDraft(bookRoot, key)
  if (pendingCount === 0) {
    return { ok: false, reason: '无待审稿', record: null }
  }
  if (pendingCount > 1 || pending === null) {
    return { ok: false, reason: `待审稿不唯一:${pendingCount}份`, record: null }
  }

  const existing = loadReviewRecord(bookRoot, key) ?? emptyReviewRecord()
  const plan = existing.方案
  const skips = new Map<string, string>()
  for (const item of plan?.跳过 ?? []) {
    if (item.理由.trim() !== '') skips.set(item.模块, item.理由)
  }

  const 细纲 = readText(bookRoot, paths.确认细纲(key.卷, key.章, key.章名)) ?? ''
  const pendingDoc = parseDocument(pending.text)
  const 材料版本 = extractVersionFields(pendingDoc.ok ? pendingDoc.data.fields : {}).版本
  // F5(2026-09-05):审核证据绑定被审正文哈希。换稿(哈希失配)→新审读轮:模块态重置、
  // 旧稿发现项不保留(作者意见条目除外——作者指示跨稿有效),旧完成态不再冒充当前稿已审。
  const inputIdentity = reviewInput(bookRoot, key, plan)
  if (inputIdentity === null) return { ok: false, reason: '待审稿在审核过程中消失', record: null }
  if (inputIdentity.materials.问题.length > 0) {
    return { ok: false, reason: `材料需要核对：${inputIdentity.materials.问题.join('；')}`, record: null }
  }
  const 审稿哈希 = inputIdentity.bodyHash
  const 审读指纹 = inputIdentity.fingerprint
  const stale = existing.审读指纹 !== 审读指纹
  const 审核编号 = reviewId(key)
  const input = {
    bookRoot,
    key: key as ChapterKey,
    待审稿: pending.body,
    细纲,
    审核编号,
    材料版本: 材料版本 === null ? pending.relPath : `${pending.relPath}@${材料版本}`,
    材料段: inputIdentity.materials.段,
  }

  // Keep removed/legacy module keys as audit history, but never reuse their
  // completion state for the current input when the fingerprint is stale.
  const 模块: Record<string, ModuleRunState> = { ...existing.模块 }
  const 旧处置 = dispositionMap(existing)
  const checks = listChecks().filter((c) => c.执行形态 !== '作者')
  const names = checks.map((c) => c.名称)
  // 确定性模块每次运行都会重算；隔离子 Agent 模块的发现项由 ingestFindings
  // 生产，必须跨过本次脚本运行保留，否则脚本与语义回写的先后顺序会改变记录内容。
  const deterministicNames = new Set(checks.filter((c) => c.run !== undefined).map((c) => c.名称))
  const 问题: Finding[] = stale
    ? existing.问题.filter((finding) => finding.模块名 === 作者意见模块名)
    : existing.问题.filter((finding) => !deterministicNames.has(finding.模块名))

  for (const name of names) {
    const skipReason = skips.get(name)
    if (skipReason !== undefined) {
      模块[name] = { 完成: true, 失败: false, 跳过: true, 理由: skipReason }
      continue
    }
    const mod = getCheck(name)
    if (mod === undefined) {
      模块[name] = { 完成: false, 失败: true, 理由: '未注册' }
      continue
    }
    try {
      if (mod.run === undefined) {
        // 隔离子 Agent 形态:主 Agent 编排派发(§9),本确定性执行面不调 run。
        // 发现项须经 ingestFindings 回写后才算完成——空审不再自动通过(拍板:空审 fail-closed)。
        const previous = stale ? undefined : 模块[name]
        模块[name] = previous?.完成 === true && previous.待回写 !== true
          ? previous
          : { 完成: false, 失败: false, 待回写: true, 理由: '隔离子 Agent 编排' }
        continue
      }
      for (const finding of mod.run(input)) {
        问题.push(inheritDisposition(finding, 旧处置))
      }
      模块[name] = { 完成: true, 失败: false }
    } catch (err) {
      模块[name] = { 完成: false, 失败: true, 理由: String(err) }
    }
  }

  /**
   * `模块` 合并历史键只为留痕；`完成` 只看本轮处理过的模块。
   *
   * 若对合并后的全集取 every，一个曾经失败、之后被摘掉或改名的模块会永久压住 `完成`，
   * 章节卡在改稿且重跑无法自愈——只能手改审核记录 JSON。
   */
  const 完成 = names.every((name) => 模块[name]?.完成 === true)
  const record: ReviewRecord = {
    schemaVersion: MACHINE_SCHEMA_VERSION,
    完成,
    问题,
    模块,
    方案: plan,
    审稿哈希,
    审读指纹,
    待继承处置: remainingDispositions(existing, stale, new Set([...deterministicNames, ...skips.keys()])),
  }
  return { ok: true, record, 材料段: inputIdentity.materials.段 }
}

/**
 * 进程内写入路径（R21 写侧）:computeReview＋写入器落盘。技能脚本只调 computeReview
 * （脚本只算不写），脚本算出的确定性模块发现项经常驻工具 novel_record_review_findings
 * （ingestFindings 逐模块回写）落盘——模块态置完成、发现项整批替换、跨轮认亲沿用旧
 * 处置，净效果与本函数写盘一致。
 */
function runReviewLocked(bookRoot: string, key: ReviewKey): RunReviewResult {
  const result = computeReview(bookRoot, key)
  if (result.ok && result.record !== null) writeReviewRecord(bookRoot, key, result.record)
  return result
}

export const runReview = bookWriter(runReviewLocked)

/**
 * 发现项回写(拍板:堵「空审通过」):隔离子 Agent 产出的发现项并入审核记录。
 *
 * 该模块置为 {完成:true, 待回写:false};并入复用 runReview 既有的跨轮认亲
 * (模块名+证据位置+问题说明三元组沿用旧处置),不另写第二套认亲规则。
 * 本模块本轮结果整批替换、其他模块留痕不动;全部模块完成且无待回写时记录完成为真。
 */
function ingestFindingsLocked(
  bookRoot: string,
  key: ReviewKey,
  模块名: string,
  rawFindings: readonly unknown[],
  expectedFingerprint?: string,
): { readonly ok: boolean; readonly reason?: string; readonly record: ReviewRecord | null; readonly 待回写模块?: readonly string[] } {
  registerDefaultChecks()
  if (getCheck(模块名) === undefined) {
    return { ok: false, reason: `未注册的审读模块:${模块名}`, record: null }
  }
  const existing = loadReviewRecord(bookRoot, key) ?? emptyReviewRecord()

  const inputIdentity = reviewInput(bookRoot, key, existing.方案)
  if (inputIdentity === null) return { ok: false, reason: '无唯一待审稿，拒绝回写可能属于旧稿的结果', record: null }
  if (expectedFingerprint !== undefined && expectedFingerprint !== inputIdentity.fingerprint) {
    return { ok: false, reason: '审读结果已过期：回写指纹与当前审核输入不一致，请重新运行审核', record: null }
  }
  const hasPriorReviewState = existing.完成 || existing.问题.length > 0 || Object.keys(existing.模块).length > 0
  const stale = (existing.审读指纹 !== undefined && existing.审读指纹 !== inputIdentity.fingerprint)
    || (existing.审读指纹 === undefined && hasPriorReviewState)
  // 重跑通道（2026-09-18 真机缺陷 D-002）：记录陈旧时，调用方传与当前输入一致的
  // 审读指纹（确定性脚本当轮产出）即证明发现项是新跑的，按 F5 语义重置旧轮次后
  // 接收——旧完成态与旧稿发现项不再冒充当前稿已审（作者意见条目跨稿保留，处置
  // 认亲照旧）。无指纹证明的陈旧记录仍拒绝迟到回写。
  const resetting = stale && expectedFingerprint !== undefined
  if (stale && !resetting) {
    return { ok: false, reason: existing.审读指纹 === undefined
      ? '旧审核记录没有输入指纹，不能接收迟到回写；请重新运行审核'
      : '审读结果已过期：待审稿、确认细纲、材料清单或审核方案已改变，请重新运行审核（重跑后请带上脚本当轮的审读指纹）', record: null }
  }

  const 旧处置 = dispositionMap(existing)

  const findings: Finding[] = []
  let n = 1
  for (const raw of rawFindings) {
    const f = normalizeFinding(raw)
    if (f === null) continue
    const withModule: Finding = { ...f, 模块名, 审核编号: reviewId(key) }
    const numbered: Finding = { ...withModule, 发现项编号: findingId(withModule.审核编号, 模块名, n++) }
    findings.push(inheritDisposition(numbered, 旧处置))
  }

  // 重置轮次（resetting）：旧完成态一律不作数，各模块须按当前输入重新回写；
  // 旧稿发现项不保留（作者意见跨稿有效），认亲处置仍按三元组沿用。
  const base问题 = resetting ? existing.问题.filter((p) => p.模块名 === 作者意见模块名) : existing.问题
  const base模块 = resetting ? {} : existing.模块
  const 问题: Finding[] = [...base问题.filter((p) => p.模块名 !== 模块名), ...findings]
  const 模块: Record<string, ModuleRunState> = {
    ...base模块,
    [模块名]: { 完成: true, 失败: false, 待回写: false },
  }
  const names = listChecks().filter((c) => c.执行形态 !== '作者').map((c) => c.名称)
  // 待办与完成同源:记录里的「模块」只有回写过的键(首轮与重置轮都不含未回写模块),
  // 从中筛待回写会漏报;一律按注册模块全集减去已完成者计算,完成＝待办为空。
  const 待回写模块 = names.filter((name) => 模块[name]?.完成 !== true || 模块[name]?.待回写 === true)
  const 完成 = 待回写模块.length === 0
  const record: ReviewRecord = {
    ...existing,
    完成,
    问题,
    模块,
    审稿哈希: inputIdentity.bodyHash,
    审读指纹: inputIdentity.fingerprint,
    待继承处置: remainingDispositions(existing, resetting, new Set([模块名])),
  }
  writeReviewRecord(bookRoot, key, record)
  return { ok: true, record, 待回写模块 }
}

export const ingestFindings = bookWriter(ingestFindingsLocked)

/**
 * 作者意见回写（M1 design §3）：作者「只提意见、不改正文」时，意见进当前轮审核记录，
 * 作为发现项（模块名=作者意见，处置=待处理，建议返回节点=改稿），草稿字节不变。
 * **无审核记录时拒绝**——不凭意见凭空建记录（否则推导会把章节直接判到改稿、跳过检查项库）。
 * 「作者意见」模块执行形态=「作者」（checks.ts）：不进 names.every 完成判定、重跑不丢、
 * 非待处理处置沿用（与其它发现项同一认亲规则）。
 */
function recordAuthorFindingLocked(
  bookRoot: string,
  key: ReviewKey,
  input: { readonly 问题说明: string; readonly 证据位置?: string; readonly 修改建议?: string },
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  registerDefaultChecks()
  const existing = loadReviewRecord(bookRoot, key)
  if (existing === null) return { ok: false, reason: '无审核记录——先完成一轮审核（含确定性检查与语义回写），作者意见才有可附着的记录' }
  const raw = {
    模块名: 作者意见模块名,
    问题说明: input.问题说明,
    ...(input.证据位置 === undefined ? {} : { 证据位置: input.证据位置 }),
    ...(input.修改建议 === undefined ? {} : { 修改建议: input.修改建议 }),
    建议返回节点: '改稿',
  }
  const r = ingestFindings(bookRoot, key, 作者意见模块名, [raw])
  if (!r.ok) return { ok: false, reason: r.reason ?? '作者意见回写失败' }
  return { ok: true }
}

export const recordAuthorFinding = bookWriter(recordAuthorFindingLocked)
