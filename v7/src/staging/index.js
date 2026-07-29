import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'
import { serializeFrontMatter } from '../storage/serializers/front-matter.js'
import { parseThreadDeclarations, OPENING_VERBS } from '../util/thread-declarations.js'
import { sanitizeFileName } from '../util/filename.js'
import { normalizeWorkspaceRel } from '../util/workspace-path.js'
import { splitAliases } from '../util/aliases.js'
import { isWeakHook } from '../util/hooks.js'
import { writeAtomicBatch } from '../storage/atomic.js'
import { finalizeChapter } from '../finalize/index.js'
import { createGit } from '../finalize/git.js'
import { BookConfigReader } from '../storage/adapters/BookConfigReader.js'
import {
  styleMetrics,
  AVG_SENTENCE_LEN_TOLERANCE,
  SENTENCE_VARIANCE_TOLERANCE,
} from '../style-stats/index.js'
import { runHealthCheck } from '../health-check/index.js'
import { readCurrentBaselineFingerprint } from '../health-check/baseline.js'
import { renderBookStatus } from '../prep/book-status.js'
import { applyReviewOutcome } from '../review/outcome.js'
import {
  decodeContractIssue,
  evaluateContractIssueSignals,
  readContractIssueHistory,
} from '../knowledge/contract-issues.js'
import {
  formatFactChangeValidationError,
  isFactPath,
  validateFactChanges,
} from '../knowledge/fact-changes.js'
import { validateFinalizePayloadPaths } from '../knowledge/payload-guards.js'
import { isDesignPath } from '../knowledge/design.js'
import {
  archiveChapterKnowledgeFromOutline,
  CHAPTER_KNOWLEDGE_SNAPSHOT_NAME,
} from '../knowledge/chapter.js'
import {
  acquireContractMutationLock,
  CONTRACT_INVALIDATION_GUARD,
  CONTRACT_INVALIDATION_MARKER,
  checkChapterContractInvalidation,
  contractInvalidationGuardFile,
  findPendingCommitProof,
  guardBlocksChapter,
  guardHasPendingChapters,
  moveGuardChapterToPendingCommit,
  movePendingCommitBackToAffected,
  overlapsMachineWorkspaceState,
  readContractInvalidationGuard,
  readContractInvalidationMarker,
  releaseContractInvalidationChapterAfterCommit,
  replacePendingCommitProof,
  verifyPendingCommitProofFile,
  workspaceRemovalIsContained,
} from './contract-invalidation.js'
import { clearRetryPolicyChapters } from '../retry-policy/index.js'

/**
 * staging：待定稿批次（自动模式，spec §8.1）。批次真源 = 工作区/待定稿/ 下的文件，
 * 本模块是其唯一读写点；不依赖也不写缓存——批次进行中删缓存重建，叠加视图输出不变。
 * 每章目录三件套：草稿.md / 定稿包.json（完整 finalize payload，转正时原样喂 finalizeChapter）/ 审稿单.md。
 */

const BATCH_DIR = path.join('工作区', '待定稿')
const META = '批次.json'

export const 章状态 = {
  待审收: '待审收',
  打回: '打回',
  受影响: '受影响',
  契约变更: '契约变更',
}

/**
 * 读批次元数据（含与实际章目录的对账）。
 * @param {{heal?: boolean}} [opts] heal=false 时批次.json 缺失只重建内存视图不落盘——
 *   名义只读的路径（next 路由组 DTO）不得隐含写盘（D5）
 * @returns {Promise<{exists: boolean, 起章: number, 章列表: Array<{章号,标题,状态,目录}>, warnings: string[]}>}
 */
export async function readBatch(repoPath, { heal = true } = {}) {
  const empty = { exists: false, 起章: 0, 章列表: [], warnings: [] }
  const dir = path.join(repoPath, BATCH_DIR)
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return empty
  }
  const dirNames = entries.filter((e) => e.isDirectory() && /^\d{4}-/.test(e.name)).map((e) => e.name)

  let meta = null
  try {
    meta = JSON.parse(await fs.readFile(path.join(dir, META), 'utf8'))
    if (!Array.isArray(meta?.章列表)) meta = null
  } catch {
    meta = null
  }

  const warnings = []
  const rows = []
  const seen = new Set()
  if (meta) {
    for (const r of meta.章列表) {
      if (!Number.isInteger(r.章号)) continue
      const dirExists = dirNames.includes(r.目录)
      // 打回章目录内容已清（工件按设计移除），元数据行保留；其余状态目录缺失 = 数据不一致，如实丢行
      if (!dirExists && r.状态 !== 章状态.打回) {
        warnings.push(`批次记录里第 ${r.章号} 章的目录（${r.目录}）不见了，已从批次中移除该记录。`)
        continue
      }
      rows.push({ 章号: r.章号, 标题: r.标题 || '', 状态: r.状态 || 章状态.受影响, 目录: r.目录 })
      seen.add(r.章号)
    }
    for (const d of dirNames) {
      const num = parseInt(d.slice(0, 4), 10)
      if (seen.has(num)) continue
      if (rows.some((r) => r.目录 === d)) continue
      warnings.push(`发现批次记录之外的章目录 ${d}，按「受影响」纳入，请重审后再定稿。`)
      rows.push(await rowFromDir(repoPath, d, warnings))
    }
  } else if (dirNames.length) {
    warnings.push('批次.json 缺失或损坏，已按章目录重建批次记录；为稳妥起见全部标记「受影响」，请重审后再定稿。')
    for (const d of dirNames) rows.push(await rowFromDir(repoPath, d, warnings))
    if (heal) await writeAtomicBatch(repoPath, [metaFile(rows)])
  }

  if (!rows.length) return empty
  rows.sort((a, b) => a.章号 - b.章号)
  return { exists: true, 起章: rows[0].章号, 章列表: rows, warnings }
}

async function rowFromDir(repoPath, dirName, warnings) {
  const num = parseInt(dirName.slice(0, 4), 10)
  let 标题 = dirName.slice(5)
  const dirP = path.join(repoPath, BATCH_DIR, dirName)

  // 三件套全缺 = rejectFrom 清空后的打回章形态，标「打回」保住 stage-chapter 覆盖通道（E6）；
  // 标「受影响」会成死行——finalize 读不到定稿包、restage 又拒打回章
  let 全缺 = true
  for (const f of ['草稿.md', '定稿包.json', '审稿单.md']) {
    try {
      await fs.access(path.join(dirP, f))
      全缺 = false
      break
    } catch {
      // 该工件不存在，继续查下一件
    }
  }
  if (全缺) return { 章号: num, 标题, 状态: 章状态.打回, 目录: dirName }

  try {
    const parsed = parseFrontMatter(await fs.readFile(path.join(dirP, '草稿.md'), 'utf8'))
    if (parsed.ok && parsed.data.标题) 标题 = parsed.data.标题
  } catch {
    warnings.push(`章目录 ${dirName} 里的草稿读不出来。`)
  }
  return { 章号: num, 标题, 状态: 章状态.受影响, 目录: dirName }
}

function metaFile(rows) {
  return {
    path: path.join(BATCH_DIR, META),
    content: JSON.stringify({ 章列表: rows }, null, 2),
  }
}

/**
 * 叠加视图的事实包：staged 章正文/档案 + 预登记（条目/名册/角色/时间线/信息差）。
 * 全部来自批次文件，供备料/审稿输入/机检合并；无批次时 exists=false 且各集合为空。
 * @param {string} repoPath
 * @param {{before?: number, heal?: boolean}} [opts] 只取章号 < before 的 staged 章——组装第 K 章材料/审稿/机检时
 *   批内事实只能来自更早的章（重审受影响章时，不许后章事实倒灌）；heal 透传 readBatch（D5）
 */
export async function stagedFacts(repoPath, opts = {}) {
  const batch = await readBatch(repoPath, { heal: opts.heal !== false })
  const facts = {
    exists: batch.exists,
    chapters: [],
    threads: new Map(),
    newEntities: new Set(),
    newAliases: new Set(),
    roster: [],
    characterUpdates: new Map(),
    timelineRows: [],
    secretWrites: [],
    factChanges: new Map(),
    removedPlans: new Set(),
    总字数: 0,
    warnings: [...batch.warnings],
  }
  if (!batch.exists) return facts

  const contractGuard = await readContractInvalidationGuard(repoPath)
  if (contractGuard?.corrupt) {
    facts.exists = false
    facts.warnings.push('契约失效记录损坏，批内正文与事实暂不叠加；请先修复工作区状态。')
    return facts
  }
  const contractMarker = await readContractInvalidationMarker(repoPath)
  if (contractMarker.corrupt) {
    facts.exists = false
    facts.warnings.push('契约重备料标记损坏，批内正文与事实暂不叠加；请先修复工作区状态。')
    return facts
  }
  const markerEffectiveChapter =
    (!contractGuard || !guardHasPendingChapters(contractGuard)) && contractMarker.exists
      ? contractMarker.effectiveChapter
      : null

  const rows = Number.isInteger(opts.before)
    ? batch.章列表.filter((r) => r.章号 < opts.before)
    : batch.章列表
  const usableRows = rows.filter((row) => row.状态 === 章状态.待审收)
  if (!usableRows.length) return { ...facts, exists: false }

  for (const row of usableRows) {
    const dirP = path.join(repoPath, BATCH_DIR, row.目录)
    const pendingProof = findPendingCommitProof(contractGuard, row.章号)
    let provenPayload = null
    if (pendingProof) {
      const verified = await verifyPendingCommitProofFile(repoPath, contractGuard, row.章号, {
        batchDir: row.目录,
        expectedProof: pendingProof,
      })
      if (!verified.ok) {
        facts.warnings.push(`批内第 ${row.章号} 章待提交证据失效：${verified.error}`)
        continue
      }
      provenPayload = verified.content
    } else if (guardBlocksChapter(contractGuard, row.章号)) {
      facts.warnings.push(`批内第 ${row.章号} 章仍在契约更新后的待重做范围，暂不叠加。`)
      continue
    } else if (markerEffectiveChapter !== null && row.章号 >= markerEffectiveChapter) {
      facts.warnings.push(`批内第 ${row.章号} 章的契约重备料标记尚未解除，暂不叠加。`)
      continue
    }

    let payload = null
    let fm = {}
    let body = ''
    if (provenPayload !== null) {
      try {
        payload = JSON.parse(provenPayload.toString('utf8'))
        if (payload?.chapterNum !== row.章号 || !payload?.frontMatter) {
          throw new Error('定稿包章号或章档案不对应')
        }
        fm = payload.frontMatter
        body = String(payload.body || '')
      } catch (err) {
        facts.warnings.push(`批内第 ${row.章号} 章定稿包读取失败：${err.message}`)
        continue
      }
    } else {
      try {
        const parsed = parseFrontMatter(await fs.readFile(path.join(dirP, '草稿.md'), 'utf8'))
        fm = parsed.ok ? parsed.data : {}
        body = parsed.body || ''
      } catch (err) {
        if (row.状态 !== 章状态.打回) facts.warnings.push(`批内第 ${row.章号} 章草稿读取失败：${err.message}`)
        continue
      }
    }
    facts.chapters.push({ 章号: row.章号, 标题: row.标题, 状态: row.状态, frontMatter: fm, body })
    facts.总字数 += Number(fm.字数) || 0

    // 声明推导条目事实（与机检/审稿共用解析器，不双写）
    const { declarations } = parseThreadDeclarations(fm)
    for (const d of declarations) {
      if (OPENING_VERBS.has(d.verb)) {
        facts.threads.set(d.id, {
          id: d.id,
          type: d.type,
          状态: '进行',
          开启章: row.章号,
          最后推进章: row.章号,
          新开: true,
        })
      } else {
        const t = facts.threads.get(d.id) || { id: d.id, type: d.type, 新开: false }
        t.最后推进章 = row.章号
        facts.threads.set(d.id, t)
      }
    }

    // 定稿包预登记
    if (payload === null) {
      try {
        payload = JSON.parse(await fs.readFile(path.join(dirP, '定稿包.json'), 'utf8'))
      } catch (err) {
        facts.warnings.push(`批内第 ${row.章号} 章定稿包读取失败：${err.message}`)
        continue
      }
    }
    for (const t of payload.threadCreates || []) {
      if (!t?.id) continue
      const cur = facts.threads.get(t.id) || { id: t.id, type: String(t.id).split('-')[0], 新开: true }
      cur.新开 = true
      cur.状态 = t.frontMatter?.状态 || '进行'
      cur.开启章 = t.frontMatter?.开启章 ?? row.章号
      cur.最后推进章 = cur.最后推进章 ?? row.章号
      facts.threads.set(t.id, cur)
    }
    for (const t of payload.threadUpdates || []) {
      if (!t?.id) continue
      const cur = facts.threads.get(t.id) || { id: t.id, type: String(t.id).split('-')[0], 新开: false }
      if (t.updates?.状态) cur.状态 = t.updates.状态
      cur.最后推进章 = t.updates?.最后推进章 ?? row.章号
      facts.threads.set(t.id, cur)
    }
    for (const r of payload.rosterUpserts || []) {
      if (!r?.正名) continue
      facts.newEntities.add(r.正名)
      const aliases = splitAliases(r.别名)
      for (const a of aliases) facts.newAliases.add(a)
      const pair = facts.roster.find((x) => x.正名 === r.正名)
      if (pair) {
        for (const a of aliases) {
          if (!pair.别名.includes(a)) pair.别名.push(a)
        }
      } else {
        facts.roster.push({ 正名: r.正名, 别名: aliases })
      }
    }
    for (const c of payload.characterUpdates || []) {
      if (!c?.name) continue
      facts.characterUpdates.set(c.name, { ...(facts.characterUpdates.get(c.name) || {}), ...c.updates })
    }
    for (const tr of payload.timelineRows || []) facts.timelineRows.push(tr)
    for (const s of payload.secretWrites || []) facts.secretWrites.push(s)
    for (const change of payload.factChanges || []) {
      if (change?.applyChange !== true) continue
      if (!isFactPath(change?.factPath) || !isDesignPath(change?.planPath)) continue
      if (!['无冲突', '作者已裁决'].includes(change.decision)) continue
      if (typeof change.content !== 'string' || !change.content.trim()) continue
      facts.factChanges.set(change.factPath, {
        ...change,
        章号: row.章号,
        content: change.content,
      })
      if (change.removePlan === true) facts.removedPlans.add(change.planPath)
    }
  }
  if (!facts.chapters.length) facts.exists = false
  return facts
}

/**
 * 全书近况叠加（备料/审稿输入消费）：staged 章计入位置与总量、连续弱钩接算、
 * 批内已推进的条目从"悬了太久"剔除。assembleBookStatus 本体保持只算定稿。
 * @param {{ok, data, markdown}} status assembleBookStatus 结果
 * @param {object} facts stagedFacts 结果
 */
export function overlayBookStatus(status, facts) {
  if (!status?.ok || !facts?.exists || !facts.chapters.length) return status
  const staged = facts.chapters
  const data = { ...status.data, 卷内进度: { ...status.data.卷内进度 } }

  data.总章数 = status.data.总章数 + staged.length
  data.总字数 = status.data.总字数 + facts.总字数

  const 卷号 = (c) => Number(c.frontMatter.卷) || status.data.当前卷
  const 新当前卷 = Math.max(status.data.当前卷, ...staged.map(卷号))
  const 卷内新增 = staged.filter((c) => 卷号(c) === 新当前卷).length
  if (新当前卷 !== status.data.当前卷) {
    data.当前卷 = 新当前卷
    data.卷内进度.写到 = 卷内新增
  } else {
    data.卷内进度.写到 = status.data.卷内进度.写到 + 卷内新增
  }

  let weak = 0
  let broke = false
  for (let i = staged.length - 1; i >= 0; i--) {
    if (isWeakHook(staged[i].frontMatter.钩子)) weak++
    else {
      broke = true
      break
    }
  }
  data.连续弱钩 = broke ? weak : weak + status.data.连续弱钩

  data.悬了太久 = status.data.悬了太久.filter((t) => !facts.threads.get(t.id)?.最后推进章)

  const 起 = staged[0].章号
  const 止 = staged[staged.length - 1].章号
  const markdown = renderBookStatus(data, [
    `- 批内已暂存：第 ${起}-${止} 章共 ${staged.length} 章（未定稿，作者批量过稿后入档）`,
  ])
  return { ...status, data, markdown }
}

/**
 * 暂存一章（自动模式的"第 7-8 步推迟"）：校验 → 落批次目录 → 清本章工作区文件 → 停止判定。
 * 前置：本章两审已跑（工作区/审稿.md 在）——自动模式砍的是逐章问作者，不是逐章审。
 */
export async function stageChapter(ctx, { chapterNum, payload }) {
  const lock = await acquireContractMutationLock(ctx.repoPath, '章节暂存')
  if (!lock.ok) return { ok: false, error: lock.error }
  try {
    return await stageChapterLocked(ctx, { chapterNum, payload })
  } finally {
    await lock.release()
  }
}

async function stageChapterLocked(ctx, { chapterNum, payload }) {
  const { repoPath, cache } = ctx
  try {
    if (!Number.isInteger(chapterNum)) return { ok: false, error: '章号必须是整数' }
    if (!payload || typeof payload !== 'object') return { ok: false, error: '缺少定稿包 payload' }
    if (payload.chapterNum !== undefined && payload.chapterNum !== chapterNum) {
      return { ok: false, error: `章号不一致：命令行是 ${chapterNum}，payload 里是 ${payload.chapterNum}` }
    }
    if (!payload.frontMatter || !payload.frontMatter.标题) {
      return { ok: false, error: '缺少章档案或标题' }
    }
    const contractCheck = await checkChapterContractInvalidation(repoPath, chapterNum, { payload })
    if (!contractCheck.ok) {
      if (contractCheck.kind === 'corrupt') {
        return { ok: false, error: '契约失效记录损坏，不能确认哪些章已重做，请先修复工作区状态' }
      }
      if (contractCheck.kind === 'stale') {
        return {
          ok: false,
          error: `第 ${chapterNum} 章受作品契约更新影响，不能沿用旧工件暂存：${contractCheck.error}`,
        }
      }
      return {
        ok: false,
        error: `第 ${chapterNum} 章受作品契约更新影响，须先重新起草或核对细纲并备料，不能沿用旧工件暂存`,
      }
    }
    const batch = await readBatch(repoPath)
    const existing = batch.章列表.find((r) => r.章号 === chapterNum)
    if (contractCheck.proof) {
      if (!existing) {
        return { ok: false, error: `第 ${chapterNum} 章待提交证据找不到对应批次记录，不能覆盖暂存` }
      }
      const verified = await verifyPendingCommitProofFile(repoPath, contractCheck.guard, chapterNum, {
        batchDir: existing.目录,
        expectedProof: contractCheck.proof,
      })
      if (!verified.ok) {
        return { ok: false, error: `第 ${chapterNum} 章待提交证据失效，不能覆盖暂存：${verified.error}` }
      }
    }
    if (!existing) {
      const rows = await cache.query('SELECT MAX(chapter_num) AS m FROM chapters')
      const maxChapter = rows[0]?.m || 0
      const expected = (batch.exists ? batch.章列表[batch.章列表.length - 1].章号 : maxChapter) + 1
      if (chapterNum !== expected) {
        return { ok: false, error: `批内章号必须连续：下一章应是第 ${expected} 章，收到的是第 ${chapterNum} 章` }
      }
    }

    let 审稿单 = ''
    try {
      审稿单 = await fs.readFile(path.join(repoPath, '工作区', '审稿.md'), 'utf8')
    } catch {
      return {
        ok: false,
        error: '工作区没有审稿单（审稿.md）——自动模式每章仍要过机检与两审，先完成两审再暂存',
      }
    }

    const reviewed = await applyReviewOutcome(repoPath, chapterNum, payload)
    if (!reviewed.ok) return reviewed
    payload = reviewed.payload

    const archived = await archiveChapterKnowledgeFromOutline(ctx, payload)
    if (!archived.ok) return { ok: false, error: `暂存停止：${archived.error}` }
    payload = archived.payload

    // P0-F1/F2 payload 校验层（R6：与 finalize 共用 knowledge/payload-guards.js，
    // 不开第二条口径）：批次预登记前带索引定位人话拒绝。
    const payloadPaths = validateFinalizePayloadPaths(payload)
    if (!payloadPaths.ok) {
      return { ok: false, error: `暂存停止：${payloadPaths.error}` }
    }

    const priorFacts = await stagedFacts(repoPath, { before: chapterNum })
    const factValidation = await validateFactChanges(repoPath, payload.factChanges, {
      factOverlay: priorFacts.factChanges,
      removedPlans: priorFacts.removedPlans,
    })
    if (!factValidation.ok) {
      return { ok: false, error: `事实转正停止：${formatFactChangeValidationError(factValidation)}` }
    }
    const appliedFactChanges = factValidation.changes.filter(
      (change) => change.applyChange === true
    )
    if (appliedFactChanges.length) payload.factChanges = appliedFactChanges
    else delete payload.factChanges

    const 标题 = payload.frontMatter.标题
    const dirName = `${String(chapterNum).padStart(4, '0')}-${sanitizeFileName(标题)}`
    const rel = (f) => path.join(BATCH_DIR, dirName, f)
    const payloadContent = JSON.stringify({ ...payload, chapterNum }, null, 2)

    const rows = batch.章列表.filter((r) => r.章号 !== chapterNum)
    rows.push({ 章号: chapterNum, 标题, 状态: 章状态.待审收, 目录: dirName })
    rows.sort((a, b) => a.章号 - b.章号)

    const stageWrites = [
      { path: rel('草稿.md'), content: serializeFrontMatter(payload.frontMatter, payload.body || '') },
      { path: rel('定稿包.json'), content: payloadContent },
      { path: rel('审稿单.md'), content: 审稿单 },
      metaFile(rows),
    ]
    if (contractCheck.kind === 'fresh' || contractCheck.kind === 'ready') {
      const stagedGuard = moveGuardChapterToPendingCommit(
        contractCheck.guard,
        chapterNum,
        dirName,
        payloadContent
      )
      stageWrites.push(contractInvalidationGuardFile(stagedGuard.guard))
    }
    await writeAtomicBatch(repoPath, stageWrites)

    // 批次已落盘；此后的清理失败只记 warning，不得把已成功的暂存反转成失败（E4）
    const warnings = []

    // 覆盖重暂存且标题变了：旧目录成孤儿，写成后清掉
    if (existing && existing.目录 !== dirName) {
      try {
        await fs.rm(path.join(repoPath, BATCH_DIR, existing.目录), { recursive: true, force: true })
      } catch (err) {
        warnings.push(`旧章目录 ${existing.目录} 清理失败（${err.message}），不影响批次，可手动删除。`)
      }
    }

    // 清本章工作区单章文件（已搬进批次目录；评审报告是本章两审产物一并清）
    const clears = new Set([
      '细纲.md',
      CHAPTER_KNOWLEDGE_SNAPSHOT_NAME,
      '本章写作材料.md',
      '草稿-A.md',
      '审稿输入.json',
      '审稿.md',
      '评审报告',
    ])
    for (const wf of payload.workspaceFiles || []) {
      const name = normalizeWorkspaceRel(wf)
      if (!name) {
        warnings.push(`工作区清理跳过可疑路径「${wf}」（不在工作区内）。`)
        continue
      }
      // 批次与契约失效状态由本模块管理；payload 不能删除它们或共同祖先（如 工作区/.）。
      if (await overlapsMachineWorkspaceState(repoPath, name)) {
        continue
      }
      if (!(await workspaceRemovalIsContained(repoPath, name))) {
        warnings.push(`工作区清理跳过指向工作区外的路径「${wf}」。`)
        continue
      }
      clears.add(path.normalize(name))
    }
    for (const wf of clears) {
      if (!(await workspaceRemovalIsContained(repoPath, wf))) {
        warnings.push(`工作区清理跳过指向工作区外的路径「${wf}」。`)
        continue
      }
      try {
        await fs.rm(path.join(repoPath, '工作区', wf), { recursive: true, force: true })
      } catch (err) {
        warnings.push(`工作区/${wf} 清理失败（${err.message}），本章已暂存，稍后手动删除即可。`)
      }
    }

    const 停止 = await judgeStop(ctx, await readBatch(repoPath))
    return { ok: true, 章号: chapterNum, staged: rows.length, 停止, warnings, error: '' }
  } catch (err) {
    return { ok: false, error: `暂存第 ${chapterNum} 章失败：${err.message}` }
  }
}

/**
 * 停止条件四件套（spec §8.1，零 token）：写满 / 收卷或卷纲耗尽 / 连续无条目变动 / 批次质检不过线。
 * @param {{heal?: boolean}} [opts] heal 透传 stagedFacts→readBatch（D5：dto 读路径不落盘自愈）
 * @returns {Promise<{stop: boolean, reasons: string[]}>}
 */
export async function judgeStop(ctx, batch, opts = {}) {
  const { repoPath, cache } = ctx
  if (!batch?.exists) return { stop: false, reasons: [] }
  const reasons = []
  const config = await new BookConfigReader(repoPath).read()
  const cfg = config.ok ? config.data : {}
  const 批次大小 = cfg.连写批次大小 || 8
  const 无变动上限 = cfg.连写无条目变动上限 || 3

  const facts = await stagedFacts(repoPath, { heal: opts.heal })
  const staged = facts.chapters

  if (staged.length >= 批次大小) {
    reasons.push(`批次写满（${staged.length}/${批次大小} 章），该交作者批量过稿了`)
  }

  const last = staged[staged.length - 1]
  if (last && (last.frontMatter.收卷 === '是' || last.frontMatter.收卷 === true)) {
    reasons.push(`第 ${last.章号} 章声明收卷，批次到此为止（随后进卷复盘）`)
  } else if (last) {
    const vol = Number(last.frontMatter.卷) || 1
    const nn = String(vol).padStart(2, '0')
    try {
      await fs.access(path.join(repoPath, '大纲', '卷纲', `第${nn}卷.md`))
    } catch {
      reasons.push(`第 ${vol} 卷没有卷纲，连写到此为止——绝不让模型裸奔编纲，请先补卷纲`)
    }
  }

  let 连续无变动 = 0
  for (let i = staged.length - 1; i >= 0; i--) {
    if (parseThreadDeclarations(staged[i].frontMatter).declarations.length) break
    连续无变动++
  }
  if (连续无变动 >= 无变动上限) {
    reasons.push(`连续 ${连续无变动} 章无条目变动（上限 ${无变动上限}）——剧情可能在原地踏步`)
  }

  const baseline = await readCurrentBaselineFingerprint(cache, config.ok ? cfg : null)
  const q = judgeBatchQuality(staged, baseline, cfg)
  if (!q.过线) reasons.push(...q.原因)

  if (last) {
    const history = await readContractIssueHistory(repoPath)
    for (const chapter of staged) {
      const encoded = Array.isArray(chapter.frontMatter.契约问题)
        ? chapter.frontMatter.契约问题
        : []
      history.push({
        章号: chapter.章号,
        卷: Number(chapter.frontMatter.卷) || 1,
        问题: encoded.map(decodeContractIssue).filter(Boolean),
      })
    }
    const signals = evaluateContractIssueSignals(history, {
      volume: Number(last.frontMatter.卷) || 1,
    })
    for (const signal of signals) {
      const threshold = signal.连续章.length
        ? `连续第 ${signal.连续章.join('、')} 章出现`
        : `本卷已出现 ${signal.卷内次数} 次`
      reasons.push(`作品契约「${signal.条款}」相关问题${threshold}，批次停在作者确认点复盘`)
    }
  }

  return { stop: reasons.length > 0, reasons }
}

/**
 * 批次质检（"体检不过线"的批次落点，纯函数零 IO）：弱钩尾 / 缺书内时间 / 句式 vs 基线。
 * @param {Array<{章号, frontMatter, body}>} staged 升序 staged 章
 * @param {{avg_sentence_length, sentence_length_variance}|null} baselineFp 基线指纹行（无则句式判据跳过）
 * @param {object} config book.yaml 配置
 * @returns {{过线: boolean, 原因: string[]}}
 */
export function judgeBatchQuality(staged, baselineFp, config = {}) {
  const 原因 = []
  if (!staged?.length) return { 过线: true, 原因 }

  const 弱上限 = config.连续弱钩上限 || 3
  let weak = 0
  for (let i = staged.length - 1; i >= 0; i--) {
    if (isWeakHook(staged[i].frontMatter.钩子)) weak++
    else break
  }
  if (weak >= 弱上限) 原因.push(`批内连续 ${weak} 章弱钩（上限 ${弱上限}），追读力要垮，先人工过一眼节奏`)

  const 缺锚 = staged.filter((c) => !String(c.frontMatter.书内时间 ?? '').trim()).map((c) => c.章号)
  if (缺锚.length) 原因.push(`第 ${缺锚.join('、')} 章缺「书内时间」——时间锚点从第 1 章起强制`)

  if (baselineFp && baselineFp.avg_sentence_length > 0) {
    const m = styleMetrics(staged.map((c) => c.body).join('\n\n'))
    const devLen = Math.abs(m.平均句长 - baselineFp.avg_sentence_length) / baselineFp.avg_sentence_length
    if (devLen >= AVG_SENTENCE_LEN_TOLERANCE) {
      原因.push(
        `批内平均句长 ${m.平均句长.toFixed(1)} 字 vs 基线 ${baselineFp.avg_sentence_length.toFixed(1)} 字，偏了 ${Math.round(devLen * 100)}%——文风可能漂了`
      )
    }
    if (baselineFp.sentence_length_variance > 0) {
      const devVar =
        Math.abs(m.句长方差 - baselineFp.sentence_length_variance) / baselineFp.sentence_length_variance
      if (devVar >= SENTENCE_VARIANCE_TOLERANCE) {
        原因.push(
          `批内句长方差 ${m.句长方差.toFixed(1)} vs 基线 ${baselineFp.sentence_length_variance.toFixed(1)}，偏了 ${Math.round(devVar * 100)}%——句子长短的节奏感变了`
        )
      }
    }
  }

  return { 过线: 原因.length === 0, 原因 }
}

/**
 * 打回第 K 章：K 置「打回」并清空该章工件（重写后 stage 覆盖），K+1..N 置「受影响」（工件保留，需重审）。
 */
export async function rejectFrom(repoPath, chapterNum) {
  const lock = await acquireContractMutationLock(repoPath, '批次打回')
  if (!lock.ok) return { ok: false, error: lock.error }
  try {
    return await rejectFromLocked(repoPath, chapterNum)
  } finally {
    await lock.release()
  }
}

async function rejectFromLocked(repoPath, chapterNum) {
  const batch = await readBatch(repoPath)
  if (!batch.exists) return { ok: false, error: '没有进行中的待定稿批次' }
  const row = batch.章列表.find((r) => r.章号 === chapterNum)
  if (!row) {
    const 尾 = batch.章列表[batch.章列表.length - 1].章号
    return { ok: false, error: `第 ${chapterNum} 章不在批次内（批内是第 ${batch.起章}-${尾} 章）` }
  }
  const contractGuard = await readContractInvalidationGuard(repoPath)
  if (contractGuard?.corrupt) {
    return { ok: false, error: '契约失效记录损坏，不能安全打回批内章节' }
  }
  const downstreamProofs = (contractGuard?.待提交章 || []).filter(
    (proof) => proof.章号 >= chapterNum
  )
  for (const pendingProof of downstreamProofs) {
    const verified = await verifyPendingCommitProofFile(
      repoPath,
      contractGuard,
      pendingProof.章号,
      {
        batchDir: pendingProof.批次目录,
        expectedProof: pendingProof,
      }
    )
    if (!verified.ok) {
      return {
        ok: false,
        error: `第 ${pendingProof.章号} 章待提交证据失效，不能从第 ${chapterNum} 章起打回：${verified.error}`,
      }
    }
  }
  const 受影响 = []
  for (const r of batch.章列表) {
    if (r.章号 === chapterNum) r.状态 = 章状态.打回
    else if (r.章号 > chapterNum) {
      r.状态 = 章状态.受影响
      受影响.push(r.章号)
    }
  }
  const writes = [metaFile(batch.章列表)]
  const demotedChapters = [...new Set([
    ...batch.章列表
      .filter((batchRow) => batchRow.章号 >= chapterNum)
      .map((batchRow) => batchRow.章号),
    ...downstreamProofs.map((proof) => proof.章号),
  ])].sort((left, right) => left - right)
  let nextGuard = contractGuard
  for (const affectedChapter of demotedChapters) {
    if (
      findPendingCommitProof(nextGuard, affectedChapter) ||
      guardBlocksChapter(nextGuard, affectedChapter)
    ) {
      nextGuard = movePendingCommitBackToAffected(nextGuard, affectedChapter)
    }
  }
  if (nextGuard && nextGuard !== contractGuard) {
    writes.push(contractInvalidationGuardFile(nextGuard))
  }
  await writeAtomicBatch(repoPath, writes)

  // 打回章工件清空（目录保留，元数据行保留——重写后 stage-chapter 覆盖）
  const dirP = path.join(repoPath, BATCH_DIR, row.目录)
  try {
    for (const f of ['草稿.md', '定稿包.json', '审稿单.md']) {
      await fs.rm(path.join(dirP, f), { force: true })
    }
  } catch (err) {
    return {
      ok: false,
      打回: chapterNum,
      受影响,
      error: `第 ${chapterNum} 章已标为打回，但批内旧工件清理失败：${err.message}`,
    }
  }
  return { ok: true, 打回: chapterNum, 受影响, error: '' }
}

/**
 * 受影响章重审完成后回到「待审收」（重审通道：重跑两审 → save-review → 本函数搬审稿单更新状态）。
 */
export async function restageReview(repoPath, chapterNum) {
  const lock = await acquireContractMutationLock(repoPath, '批次重审收口')
  if (!lock.ok) return { ok: false, error: lock.error }
  try {
    return await restageReviewLocked(repoPath, chapterNum)
  } finally {
    await lock.release()
  }
}

async function restageReviewLocked(repoPath, chapterNum) {
  const batch = await readBatch(repoPath)
  if (!batch.exists) return { ok: false, error: '没有进行中的待定稿批次' }
  const row = batch.章列表.find((r) => r.章号 === chapterNum)
  if (!row) return { ok: false, error: `第 ${chapterNum} 章不在批次内` }
  const contractGuard = await readContractInvalidationGuard(repoPath)
  if (contractGuard?.corrupt) {
    return { ok: false, error: '契约失效记录损坏，不能安全更新批内审稿结果' }
  }
  const pendingProof = findPendingCommitProof(contractGuard, chapterNum)
  let provenPayload = null
  if (pendingProof) {
    const verified = await verifyPendingCommitProofFile(repoPath, contractGuard, chapterNum, {
      batchDir: row.目录,
      expectedProof: pendingProof,
    })
    if (!verified.ok) {
      return { ok: false, error: `第 ${chapterNum} 章待提交证据失效，不能覆盖审稿结果：${verified.error}` }
    }
    provenPayload = verified.content
  } else if (guardBlocksChapter(contractGuard, chapterNum)) {
    return {
      ok: false,
      error: `第 ${chapterNum} 章受作品契约变更影响，须重新备料、修订正文并用 stage-chapter 重暂存，不能只换审稿单`,
    }
  }
  if (row.状态 === 章状态.打回) {
    return { ok: false, error: `第 ${chapterNum} 章是打回章，要重写后用 stage-chapter 重新暂存，不能只重审` }
  }
  if (row.状态 === 章状态.契约变更) {
    return {
      ok: false,
      error: `第 ${chapterNum} 章受作品契约变更影响，须重新备料、修订正文并用 stage-chapter 重暂存，不能只换审稿单`,
    }
  }
  let 审稿单 = ''
  try {
    审稿单 = await fs.readFile(path.join(repoPath, '工作区', '审稿.md'), 'utf8')
  } catch {
    return { ok: false, error: '工作区没有新审稿单（审稿.md），先重跑两审' }
  }
  let payload
  const payloadPath = path.join(BATCH_DIR, row.目录, '定稿包.json')
  try {
    payload = JSON.parse(
      provenPayload === null
        ? await fs.readFile(path.join(repoPath, payloadPath), 'utf8')
        : provenPayload.toString('utf8')
    )
  } catch (err) {
    return { ok: false, error: `第 ${chapterNum} 章定稿包读取失败：${err.message}` }
  }
  const reviewed = await applyReviewOutcome(repoPath, chapterNum, payload)
  if (!reviewed.ok) return reviewed
  const payloadContent = JSON.stringify(reviewed.payload, null, 2)
  row.状态 = 章状态.待审收
  const writes = [
    { path: path.join(BATCH_DIR, row.目录, '审稿单.md'), content: 审稿单 },
    { path: payloadPath, content: payloadContent },
    metaFile(batch.章列表),
  ]
  if (pendingProof) {
    const next = replacePendingCommitProof(
      contractGuard,
      chapterNum,
      row.目录,
      payloadContent
    )
    writes.push(contractInvalidationGuardFile(next.guard))
  }
  await writeAtomicBatch(repoPath, writes)
  const warnings = []
  for (const [name, options] of [
    ['审稿输入.json', { force: true }],
    ['审稿.md', { force: true }],
    ['评审报告', { recursive: true, force: true }],
  ]) {
    try {
      await fs.rm(path.join(repoPath, '工作区', name), options)
    } catch (err) {
      warnings.push(`工作区/${name} 清理失败（${err.message}），本章已完成重审收口，可稍后手动删除。`)
    }
  }
  return { ok: true, 章号: chapterNum, warnings, error: '' }
}

const ACTIVE_WORKSPACE_NAMES = new Set([
  '细纲.md',
  CHAPTER_KNOWLEDGE_SNAPSHOT_NAME,
  '本章写作材料.md',
  '审稿输入.json',
  '审稿.md',
  '评审报告',
])

/**
 * 只读准备契约失效计划。批次状态与当前工作区 marker 会和契约源文件进入同一原子写批；
 * 草稿/细纲改名及材料/审稿清理延后到 commit 成功后，清理失败也不会重新放行旧工件。
 */
export async function prepareContractInvalidation(
  repoPath,
  effectiveChapter,
  { nextChapter = effectiveChapter, contractVersion = null } = {}
) {
  const result = {
    ok: false,
    受影响章: [],
    当前工作区失效: false,
    当前工作区章: [],
    writes: [],
    snapshots: [],
    artifacts: [],
    warnings: [],
    error: '',
  }
  try {
    const previousGuard = await readContractInvalidationGuard(repoPath)
    if (previousGuard?.corrupt) throw new Error('既有契约失效记录损坏，请先修复工作区状态')
    const previousMarker = await readContractInvalidationMarker(repoPath)
    if (previousMarker.corrupt) {
      throw new Error('既有契约重备料标记损坏，请先修复工作区状态')
    }
    if ((previousGuard !== null) !== previousMarker.exists) {
      throw new Error('既有契约失效守卫与重备料标记不一致，请先修复工作区状态')
    }
    if (
      previousGuard &&
      previousMarker.effectiveChapter !== previousGuard.生效起章
    ) {
      throw new Error('既有契约失效守卫与重备料标记的生效章不一致，请先修复工作区状态')
    }
    if (guardHasPendingChapters(previousGuard)) {
      throw new Error('上一次契约更新仍有待重做或待提交章节，请先完成入档或丢弃后再更新契约')
    }
    if (previousGuard || previousMarker.exists) {
      throw new Error('上一次契约更新仍有未清理的失效状态，请先处理后再更新契约')
    }
    if (!Number.isInteger(contractVersion) || contractVersion < 1) {
      throw new Error('新契约版本无效，不能建立失效守卫')
    }
    const batch = await readBatch(repoPath, { heal: false })
    result.warnings.push(...batch.warnings)
    const rows = batch.章列表.map((row) => ({ ...row }))
    for (const row of rows) {
      if (row.章号 < effectiveChapter) continue
      row.状态 = 章状态.契约变更
      result.受影响章.push(row.章号)
    }
    if (result.受影响章.length) result.writes.push(metaFile(rows))

    const inferredActiveChapter = batch.exists
      ? Math.max(...batch.章列表.map((row) => row.章号)) + 1
      : nextChapter
    // 工件自身无章号时无法证明它早于生效章：按生效章保守失效，避免未来跳章工件漏过。
    const fallbackChapter = Math.max(inferredActiveChapter, effectiveChapter)
    const names = await readWorkspaceNames(repoPath)
    for (const name of names) {
      if (!name.startsWith('草稿') && !ACTIVE_WORKSPACE_NAMES.has(name)) continue
      const chapter = await workspaceArtifactChapter(repoPath, name, fallbackChapter)
      if (!Number.isInteger(chapter) || chapter < effectiveChapter) continue
      result.artifacts.push({ name, chapter, preserve: name.startsWith('草稿') || name === '细纲.md' })
    }

    if (result.artifacts.length) {
      result.当前工作区失效 = true
      result.当前工作区章 = [...new Set(result.artifacts.map((item) => item.chapter))].sort(
        (a, b) => a - b
      )
    }

    const guardedBatchChapters = [
      ...new Set([...(previousGuard?.受影响批次章 || []), ...result.受影响章]),
    ].sort((a, b) => a - b)
    const guardedWorkspaceChapters = [
      ...new Set([...(previousGuard?.当前工作区章 || []), ...result.当前工作区章]),
    ]
      .filter((chapter) => !guardedBatchChapters.includes(chapter))
      .sort((a, b) => a - b)
    const previousGuardPending =
      (previousGuard?.受影响批次章.length || 0) > 0 ||
      (previousGuard?.当前工作区章.length || 0) > 0

    // 作者可见 marker 覆盖两种失效来源：批次中的旧章和当前工作区工件。
    // 机器 guard 是最终裁决，但 marker 让作者在清理/重备料前仍能看到待处理范围。
    if (result.受影响章.length || result.当前工作区章.length || previousGuardPending) {
      const markerLines = [
        '# 契约更新待重备料',
        '',
        `作品契约从第 ${
          previousGuardPending
            ? Math.min(previousGuard.生效起章, effectiveChapter)
            : effectiveChapter
        } 章起更新，以下未定稿内容受影响：`,
      ]
      if (guardedBatchChapters.length) {
        markerLines.push(
          `- 批次中的第 ${guardedBatchChapters.join('、')} 章：须重新起草或核对细纲、备料、修订正文并审查。`
        )
      }
      if (guardedWorkspaceChapters.length) {
        markerLines.push(
          `- 当前工作区的第 ${guardedWorkspaceChapters.join('、')} 章：旧细纲与草稿会改名保留；旧材料和审稿结果不得继续使用。`
        )
      }
      markerLines.push('请完成受影响章节的新工件后再暂存或定稿。', '')
      result.writes.push({ path: CONTRACT_INVALIDATION_MARKER, content: markerLines.join('\n') })
    }

    if (guardedBatchChapters.length || guardedWorkspaceChapters.length) {
      result.writes.push(contractInvalidationGuardFile({
        契约版本: contractVersion,
        生效起章: previousGuardPending
          ? Math.min(previousGuard.生效起章, effectiveChapter)
          : effectiveChapter,
        受影响批次章: guardedBatchChapters,
        当前工作区章: guardedWorkspaceChapters,
        待提交章: [],
      }))
    }

    result.snapshots = await snapshotInvalidationWrites(repoPath, result.writes)
    result.ok = true
    return result
  } catch (err) {
    return { ...result, error: `准备契约失效状态失败：${err.message}` }
  }
}

/** commit 成功后清理可重建工件；持久状态已先落盘，清理失败只需报告 warning。 */
export async function finishContractInvalidation(repoPath, plan) {
  const result = {
    受影响章: [...(plan?.受影响章 || [])],
    当前工作区失效: plan?.当前工作区失效 === true,
    当前工作区章: [...(plan?.当前工作区章 || [])],
    warnings: [...(plan?.warnings || [])],
  }
  const workspace = path.join(repoPath, '工作区')
  for (const artifact of plan?.artifacts || []) {
    try {
      const source = path.join(workspace, artifact.name)
      if (artifact.preserve) {
        await fs.rename(source, await availableInvalidatedArtifactPath(workspace, artifact.name))
      } else {
        await fs.rm(source, { recursive: true, force: true })
      }
    } catch (err) {
      result.warnings.push(`旧工件「${artifact.name}」作废失败：${err.message}`)
    }
  }
  return result
}

/** 契约 commit 失败时，把随契约原子写入的工作区状态恢复到原样。 */
export async function rollbackContractInvalidation(repoPath, plan) {
  const restores = []
  const removes = []
  for (const snapshot of plan?.snapshots || []) {
    if (snapshot.kind === 'file') restores.push({ path: snapshot.path, content: snapshot.content })
    else if (snapshot.kind === 'missing') removes.push(snapshot.path)
  }
  if (restores.length) await writeAtomicBatch(repoPath, restores)
  for (const rel of removes) await fs.rm(path.join(repoPath, rel), { force: true })
}

/** 独立调用兼容层；persist-contract 使用 prepare → 同批保存 → finish 的更强原子边界。 */
export async function invalidateAfterContractUpdate(
  repoPath,
  effectiveChapter,
  options = {}
) {
  const lock = await acquireContractMutationLock(repoPath, '契约失效处理')
  if (!lock.ok) {
    return {
      ok: false,
      受影响章: [],
      当前工作区失效: false,
      当前工作区章: [],
      warnings: [],
      error: lock.error,
    }
  }
  try {
    return await invalidateAfterContractUpdateLocked(repoPath, effectiveChapter, options)
  } finally {
    await lock.release()
  }
}

async function invalidateAfterContractUpdateLocked(repoPath, effectiveChapter, options) {
  const plan = await prepareContractInvalidation(repoPath, effectiveChapter, options)
  if (!plan.ok) {
    return {
      ok: false,
      受影响章: [],
      当前工作区失效: false,
      当前工作区章: [],
      warnings: [],
      error: plan.error,
    }
  }
  try {
    if (plan.writes.length) await writeAtomicBatch(repoPath, plan.writes)
  } catch (err) {
    return {
      ok: false,
      受影响章: [],
      当前工作区失效: false,
      当前工作区章: [],
      warnings: [],
      error: `契约失效状态写入失败：${err.message}`,
    }
  }
  return { ok: true, ...(await finishContractInvalidation(repoPath, plan)), error: '' }
}

async function readWorkspaceNames(repoPath) {
  try {
    return await fs.readdir(path.join(repoPath, '工作区'))
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

async function workspaceArtifactChapter(repoPath, name, fallbackChapter) {
  const full = path.join(repoPath, '工作区', name)
  if (name === '评审报告') {
    try {
      const outcome = JSON.parse(await fs.readFile(path.join(full, '审稿结果.json'), 'utf8'))
      const chapter = normalizeArtifactChapter(outcome?.章号)
      if (chapter !== null) return chapter
    } catch {
      // 报告不完整时仍按当前活动章保守处理
    }
    return fallbackChapter
  }

  try {
    const content = await fs.readFile(full, 'utf8')
    const parsed = parseFrontMatter(content)
    const frontMatterChapter = normalizeArtifactChapter(parsed.ok ? parsed.data.章号 : null)
    if (frontMatterChapter !== null) return frontMatterChapter
    const heading = content.match(/(?:^|\n)#\s*第\s*(\d+)\s*章(?:细纲|写作材料|审稿单)/)
    if (heading) return Number(heading[1])
  } catch {
    // 读不出章号时仍按批次尾章/下一未定稿章保守处理
  }
  return fallbackChapter
}

function normalizeArtifactChapter(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const chapter = Number(value)
  return Number.isInteger(chapter) && chapter > 0 ? chapter : null
}

async function snapshotInvalidationWrites(repoPath, writes) {
  const snapshots = []
  for (const file of writes) {
    const full = path.join(repoPath, file.path)
    try {
      const stat = await fs.stat(full)
      if (stat.isFile()) {
        snapshots.push({ path: file.path, kind: 'file', content: await fs.readFile(full, 'utf8') })
      } else {
        // 非文件目标会由 writeAtomicBatch 拒绝；保留类型用于失败注入后的零变化断言。
        snapshots.push({ path: file.path, kind: 'other', content: '' })
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      snapshots.push({ path: file.path, kind: 'missing', content: '' })
    }
  }
  return snapshots
}

async function availableInvalidatedArtifactPath(workspace, originalName) {
  let candidate = path.join(workspace, '契约更新前-' + originalName)
  for (let index = 2; ; index++) {
    try {
      await fs.access(candidate)
      candidate = path.join(workspace, '契约更新前-' + index + '-' + originalName)
    } catch {
      return candidate
    }
  }
}

/**
 * 批量定稿：全部（或 --until 前的）章须为「待审收」；升序逐章 finalizeChapter——
 * 每章独立原子 commit，中途失败停在该章、已入档保留（原子性按章保留）。
 * 可安全重跑（E3/决策 D3）：上次中断留下的「已入档但残留未清」章自动跳过转正、只清残留。
 */
export async function finalizeBatch(ctx, options = {}) {
  const lock = await acquireContractMutationLock(ctx.repoPath, '批量定稿')
  if (!lock.ok) return { ok: false, 已入档: [], error: lock.error }
  try {
    return await finalizeBatchLocked(ctx, options, lock)
  } finally {
    await lock.release()
  }
}

async function finalizeBatchLocked(ctx, { until } = {}, contractMutationLock) {
  const { repoPath } = ctx
  const 已入档 = []
  try {
    const batch = await readBatch(repoPath)
    if (!batch.exists) return { ok: false, 已入档, error: '没有进行中的待定稿批次' }

    const inScope = (r) => (until ? r.章号 <= until : true)
    const 目标 = batch.章列表.filter(inScope)
    if (!目标.length) return { ok: false, 已入档, error: `--until=${until} 范围内没有批内章` }

    // 幂等重跑检测：定稿文件已在且章号 ≤ 缓存最大章 = 上次 finalizeChapter 全链路完成
    // （缓存刷新在 commit 之后），本次只清残留；也不受状态拦——残留目录被 readBatch
    // 重建标的「受影响」是保守值，不代表要重审
    const 已定稿残留 = new Set()
    for (const row of 目标) {
      if (await alreadyFinalized(ctx, row.章号)) 已定稿残留.add(row.章号)
    }

    const contractGuard = await readContractInvalidationGuard(repoPath)
    if (contractGuard?.corrupt) {
      return {
        ok: false,
        已入档,
        error: '契约失效记录损坏，整批不能定稿，请先修复工作区状态',
      }
    }
    const contractMarker = await readContractInvalidationMarker(repoPath)
    if (contractMarker.corrupt) {
      return {
        ok: false,
        已入档,
        error: '契约重备料标记损坏，整批不能定稿，请先修复工作区状态',
      }
    }
    const markerEffectiveChapter =
      (!contractGuard || !guardHasPendingChapters(contractGuard)) && contractMarker.exists
        ? contractMarker.effectiveChapter
        : null

    const 障碍 = 目标.filter((r) => r.状态 !== 章状态.待审收 && !已定稿残留.has(r.章号))
    if (障碍.length) {
      const list = 障碍.map((r) => `第 ${r.章号} 章（${r.状态}）`).join('、')
      return {
        ok: false,
        已入档,
        error: `批内还有未收口的章：${list}——打回章要重写重暂存、受影响章要重审；当前不能批量定稿`,
      }
    }

    // 在任何 commit 前完整读取并校验全部目标。guard 中的待提交证据绑定原始 JSON 字节；
    // 任一章目录、契约版本或 hash 不符，整批零提交。
    const preflight = new Map()
    for (const row of 目标) {
      const pendingProof = findPendingCommitProof(contractGuard, row.章号)
      let rawPayload
      if (已定稿残留.has(row.章号)) {
        if (pendingProof) {
          if (!(await createGit(repoPath).findChapterCommit(row.章号))) {
            return {
              ok: false,
              已入档,
              error: `第 ${row.章号} 章只有文件与缓存残留，没有对应的章节提交，不能释放待提交证据`,
            }
          }
          const verified = await verifyPendingCommitProofFile(repoPath, contractGuard, row.章号, {
            batchDir: row.目录,
            expectedProof: pendingProof,
          })
          if (!verified.ok) {
            return {
              ok: false,
              已入档,
              error: `第 ${row.章号} 章虽已入档，但残留待提交证据失效：${verified.error}`,
            }
          }
        } else if (guardBlocksChapter(contractGuard, row.章号)) {
          return {
            ok: false,
            已入档,
            error: `第 ${row.章号} 章虽已入档，但契约失效守卫没有可核验的待提交证据`,
          }
        }
        preflight.set(row.章号, { payload: null, pendingProof })
        continue
      }
      if (pendingProof) {
        const verified = await verifyPendingCommitProofFile(repoPath, contractGuard, row.章号, {
          batchDir: row.目录,
          expectedProof: pendingProof,
        })
        if (!verified.ok) {
          return {
            ok: false,
            已入档,
            error: `第 ${row.章号} 章待提交证据失效：${verified.error}；整批尚未开始定稿`,
          }
        }
        rawPayload = verified.content
      } else if (guardBlocksChapter(contractGuard, row.章号)) {
        return {
          ok: false,
          已入档,
          error: `作品契约已从第 ${contractGuard.生效起章} 章起更新，第 ${row.章号} 章尚未完成新备料与审查，也没有待提交绑定，不能批量定稿`,
        }
      } else if (markerEffectiveChapter !== null && row.章号 >= markerEffectiveChapter) {
        return {
          ok: false,
          已入档,
          error: `作品契约已从第 ${markerEffectiveChapter} 章起更新，第 ${row.章号} 章的重备料标记尚未解除，不能批量定稿`,
        }
      } else {
        try {
          rawPayload = await fs.readFile(
            path.join(repoPath, BATCH_DIR, row.目录, '定稿包.json')
          )
        } catch (err) {
          return {
            ok: false,
            已入档,
            error: `第 ${row.章号} 章定稿包读取失败：${err.message}；整批尚未开始定稿`,
          }
        }
      }

      let payload
      try {
        payload = JSON.parse(rawPayload.toString('utf8'))
      } catch (err) {
        return {
          ok: false,
          已入档,
          error: `第 ${row.章号} 章定稿包解析失败：${err.message}；整批尚未开始定稿`,
        }
      }
      if (payload?.chapterNum !== row.章号) {
        return {
          ok: false,
          已入档,
          error: `第 ${row.章号} 章定稿包内章号不一致；整批尚未开始定稿`,
        }
      }
      preflight.set(row.章号, { payload, pendingProof })
    }

    let remaining = [...batch.章列表]
    for (const row of 目标) {
      const dirP = path.join(repoPath, BATCH_DIR, row.目录)
      const prepared = preflight.get(row.章号)

      if (!已定稿残留.has(row.章号)) {
        const payload = prepared.payload
        // 本章工作区文件在暂存时已清；批次目录由本函数自管，防误删他章工件
        payload.workspaceFiles = []
        const r = await finalizeChapter(ctx, payload, {
          archiveOutline: false,
          fromBatch: true,
          contractCommitProof: prepared.pendingProof,
          contractMutationLock,
        })
        if (!r.ok) {
          return {
            ok: false,
            已入档,
            失败章: row.章号,
            error: `第 ${row.章号} 章定稿失败：${r.error}——之前 ${已入档.length} 章已入档保留，批次剩余原样，修好后重跑 finalize-batch`,
          }
        }
        已入档.push({ 章号: row.章号, commit: r.commitHash })
        if (prepared.pendingProof && r.contractGuardReleased !== true) {
            return {
              ok: false,
              已入档,
              失败章: row.章号,
              error: `第 ${row.章号} 章已入档，但契约待提交证据未能安全释放；批次目录与守卫均保留，请修复工作区状态后重跑`,
            }
        }
      } else if (prepared?.pendingProof) {
        const released = await releaseContractInvalidationChapterAfterCommit(
          repoPath,
          row.章号,
          prepared.pendingProof
        )
        if (!released.ok) {
          return {
            ok: false,
            已入档,
            失败章: row.章号,
            error: `第 ${row.章号} 章已入档，但残留待提交证据未能释放：${released.error}`,
          }
        }
      }

      // 先记录后删目录（决策 D3）：先把该章行移出批次.json 再删章目录——反过来会在
      // 「目录已删、记录未更」窗口让已入档章以旧状态复活。清残留失败必须报错止步：
      // 行已移、目录残留会被 readBatch 按「受影响」重新纳入，静默继续会掩盖残留
      remaining = remaining.filter((x) => x.章号 !== row.章号)
      try {
        if (remaining.length) await writeAtomicBatch(repoPath, [metaFile(remaining)])
        await fs.rm(dirP, { recursive: true, force: true })
      } catch (err) {
        return {
          ok: false,
          已入档,
          失败章: row.章号,
          error: `第 ${row.章号} 章已入档，但批次残留清理失败：${err.message}——关闭占用该目录的程序后重跑 finalize-batch，已入档的章会自动跳过转正、只清残留`,
        }
      }
    }

    let 体检 = ''
    if (!remaining.length) {
      await fs.rm(path.join(repoPath, BATCH_DIR), { recursive: true, force: true })
      // 体检与批次对齐（spec §9：连写中每批次一次）；失败不阻断——批次已转正完成
      const hc = await runHealthCheck(ctx)
      体检 = hc.ok ? `体检已随批次完成（报告见 工作区/体检报告.md）` : `批末体检没跑成：${hc.error}`
    }
    return { ok: true, 已入档, 剩余: remaining.length, 体检, error: '' }
  } catch (err) {
    // 兜底防裸栈（E3）：finalizeChapter 已 commit 的章保留，指引重跑续走
    return {
      ok: false,
      已入档,
      error: `批量定稿中断：${err.message}——已入档的 ${已入档.length} 章保留，处理后重跑 finalize-batch 续走`,
    }
  }
}

// 决策 D3 的「上次已转正」判据：定稿文件存在 且 章号 ≤ 缓存最大章，二者都在
// 才认（只看文件会把手工拷贝误判为已定稿；只看缓存会在缓存陈旧时误判）
async function alreadyFinalized(ctx, chapterNum) {
  const prefix = String(chapterNum).padStart(4, '0')
  let files
  try {
    files = await fs.readdir(path.join(ctx.repoPath, '定稿', '正文'))
  } catch {
    return false
  }
  if (!files.some((f) => f.startsWith(`${prefix}-`) && f.endsWith('.md'))) return false
  try {
    const rows = await ctx.cache.query('SELECT MAX(chapter_num) AS m FROM chapters')
    return chapterNum <= (rows[0]?.m || 0)
  } catch {
    return false
  }
}

/** 整批丢弃：删工作区批次（未入 git，定稿零变化）。破坏性操作，宿主必须先经作者确认。 */
export async function discardBatch(repoPath) {
  const lock = await acquireContractMutationLock(repoPath, '丢弃批次')
  if (!lock.ok) return { ok: false, 章数: 0, error: lock.error }
  try {
    return await discardBatchLocked(repoPath)
  } finally {
    await lock.release()
  }
}

async function discardBatchLocked(repoPath) {
  const batch = await readBatch(repoPath)
  if (!batch.exists) return { ok: false, 章数: 0, error: '没有进行中的待定稿批次' }
  const contractGuard = await readContractInvalidationGuard(repoPath)
  if (contractGuard?.corrupt) {
    return {
      ok: false,
      章数: batch.章列表.length,
      error: '契约失效记录损坏，不能确认丢弃哪些受影响章，请先修复工作区状态',
    }
  }
  const discardedChapters = new Set(batch.章列表.map((row) => row.章号))
  try {
    await fs.rm(path.join(repoPath, BATCH_DIR), { recursive: true, force: true })
  } catch (err) {
    return { ok: false, 章数: batch.章列表.length, error: `整批丢弃失败：${err.message}` }
  }

  if (contractGuard) {
    const remainingBatchChapters = contractGuard.受影响批次章.filter(
      (chapter) => !discardedChapters.has(chapter)
    )
    const nextGuard = {
      ...contractGuard,
      受影响批次章: remainingBatchChapters,
      待提交章: contractGuard.待提交章.filter(
        (proof) => !discardedChapters.has(proof.章号)
      ),
    }
    try {
      if (guardHasPendingChapters(nextGuard)) {
        await writeAtomicBatch(repoPath, [contractInvalidationGuardFile(nextGuard)])
      } else {
        await fs.rm(path.join(repoPath, CONTRACT_INVALIDATION_MARKER), { force: true })
        await fs.rm(path.join(repoPath, CONTRACT_INVALIDATION_GUARD), { force: true })
      }
    } catch (err) {
      return {
        ok: false,
        章数: batch.章列表.length,
        error: `批次已丢弃，但契约失效记录清理失败：${err.message}；为安全起见仍保留失效守卫`,
      }
    }
  }

  // 整批丢弃即放弃这些章的当前稿：清重试预算（决策 2026-07-23），否则重写同一
  // 章号会顶着旧计数直接被挡。失败只记 warning，批次本体已经丢弃成功。
  const warnings = []
  try {
    const cleared = await clearRetryPolicyChapters(repoPath, [...discardedChapters])
    if (!cleared.ok) {
      warnings.push(`批次已丢弃，但重试预算清理失败：${cleared.error}；重写这些章前请手动删除 工作区/重试预算.json 中对应章记录。`)
    } else if (cleared.file) {
      await writeAtomicBatch(repoPath, [cleared.file])
    }
  } catch (err) {
    warnings.push(`批次已丢弃，但重试预算清理失败（${err.message}）；重写这些章前请手动删除 工作区/重试预算.json 中对应章记录。`)
  }
  return { ok: true, 章数: batch.章列表.length, warnings, error: '' }
}
