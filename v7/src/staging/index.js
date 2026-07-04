import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'
import { serializeFrontMatter } from '../storage/serializers/front-matter.js'
import { parseThreadDeclarations, OPENING_VERBS } from '../util/thread-declarations.js'
import { sanitizeFileName } from '../util/filename.js'
import { writeAtomicBatch } from '../storage/atomic.js'
import { finalizeChapter } from '../finalize/index.js'
import { BookConfigReader } from '../storage/adapters/BookConfigReader.js'
import {
  styleMetrics,
  AVG_SENTENCE_LEN_TOLERANCE,
  SENTENCE_VARIANCE_TOLERANCE,
} from '../style-stats/index.js'
import { runHealthCheck } from '../health-check/index.js'

/**
 * staging：待定稿批次（自动模式，spec §8.1）。批次真源 = 工作区/待定稿/ 下的文件，
 * 本模块是其唯一读写点；不依赖也不写缓存——批次进行中删缓存重建，叠加视图输出不变。
 * 每章目录三件套：草稿.md / 定稿包.json（完整 finalize payload，转正时原样喂 finalizeChapter）/ 审稿单.md。
 */

const BATCH_DIR = path.join('工作区', '待定稿')
const META = '批次.json'

export const 章状态 = { 待审收: '待审收', 打回: '打回', 受影响: '受影响' }

/**
 * 读批次元数据（含与实际章目录的对账）。
 * @returns {Promise<{exists: boolean, 起章: number, 章列表: Array<{章号,标题,状态,目录}>, warnings: string[]}>}
 */
export async function readBatch(repoPath) {
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
    await writeAtomicBatch(repoPath, [metaFile(rows)])
  }

  if (!rows.length) return empty
  rows.sort((a, b) => a.章号 - b.章号)
  return { exists: true, 起章: rows[0].章号, 章列表: rows, warnings }
}

async function rowFromDir(repoPath, dirName, warnings) {
  const num = parseInt(dirName.slice(0, 4), 10)
  let 标题 = dirName.slice(5)
  try {
    const parsed = parseFrontMatter(
      await fs.readFile(path.join(repoPath, BATCH_DIR, dirName, '草稿.md'), 'utf8')
    )
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
 */
export async function stagedFacts(repoPath) {
  const batch = await readBatch(repoPath)
  const facts = {
    exists: batch.exists,
    chapters: [],
    threads: new Map(),
    newEntities: new Set(),
    newAliases: new Set(),
    characterUpdates: new Map(),
    timelineRows: [],
    secretWrites: [],
    总字数: 0,
    warnings: [...batch.warnings],
  }
  if (!batch.exists) return facts

  for (const row of batch.章列表) {
    const dirP = path.join(repoPath, BATCH_DIR, row.目录)

    let fm = {}
    let body = ''
    try {
      const parsed = parseFrontMatter(await fs.readFile(path.join(dirP, '草稿.md'), 'utf8'))
      fm = parsed.ok ? parsed.data : {}
      body = parsed.body || ''
    } catch (err) {
      if (row.状态 !== 章状态.打回) facts.warnings.push(`批内第 ${row.章号} 章草稿读取失败：${err.message}`)
      continue
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
    let payload = null
    try {
      payload = JSON.parse(await fs.readFile(path.join(dirP, '定稿包.json'), 'utf8'))
    } catch (err) {
      facts.warnings.push(`批内第 ${row.章号} 章定稿包读取失败：${err.message}`)
      continue
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
      if (r?.正名) facts.newEntities.add(r.正名)
      for (const a of splitAliases(r?.别名)) facts.newAliases.add(a)
    }
    for (const c of payload.characterUpdates || []) {
      if (!c?.name) continue
      facts.characterUpdates.set(c.name, { ...(facts.characterUpdates.get(c.name) || {}), ...c.updates })
    }
    for (const tr of payload.timelineRows || []) facts.timelineRows.push(tr)
    for (const s of payload.secretWrites || []) facts.secretWrites.push(s)
  }
  return facts
}

function splitAliases(v) {
  if (Array.isArray(v)) return v.filter(Boolean).map((s) => String(s).trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
  return []
}

/**
 * 暂存一章（自动模式的"第 7-8 步推迟"）：校验 → 落批次目录 → 清本章工作区文件 → 停止判定。
 * 前置：本章两审已跑（工作区/审稿.md 在）——自动模式砍的是逐章问作者，不是逐章审。
 */
export async function stageChapter(ctx, { chapterNum, payload }) {
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

    const batch = await readBatch(repoPath)
    const existing = batch.章列表.find((r) => r.章号 === chapterNum)
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

    const 标题 = payload.frontMatter.标题
    const dirName = `${String(chapterNum).padStart(4, '0')}-${sanitizeFileName(标题)}`
    const rel = (f) => path.join(BATCH_DIR, dirName, f)

    const rows = batch.章列表.filter((r) => r.章号 !== chapterNum)
    rows.push({ 章号: chapterNum, 标题, 状态: 章状态.待审收, 目录: dirName })
    rows.sort((a, b) => a.章号 - b.章号)

    await writeAtomicBatch(repoPath, [
      { path: rel('草稿.md'), content: serializeFrontMatter(payload.frontMatter, payload.body || '') },
      { path: rel('定稿包.json'), content: JSON.stringify({ ...payload, chapterNum }, null, 2) },
      { path: rel('审稿单.md'), content: 审稿单 },
      metaFile(rows),
    ])

    // 覆盖重暂存且标题变了：旧目录成孤儿，写成后清掉
    if (existing && existing.目录 !== dirName) {
      await fs.rm(path.join(repoPath, BATCH_DIR, existing.目录), { recursive: true, force: true })
    }

    // 清本章工作区单章文件（已搬进批次目录；评审报告是本章两审产物一并清）
    const clears = new Set(['细纲.md', '本章写作材料.md', '草稿-A.md', '审稿.md', '评审报告'])
    for (const wf of payload.workspaceFiles || []) {
      const name = String(wf).replace(/^工作区[\\/]/, '')
      if (!name.includes('..')) clears.add(name)
    }
    for (const wf of clears) {
      await fs.rm(path.join(repoPath, '工作区', wf), { recursive: true, force: true })
    }

    const 停止 = await judgeStop(ctx, await readBatch(repoPath))
    return { ok: true, 章号: chapterNum, staged: rows.length, 停止, error: '' }
  } catch (err) {
    return { ok: false, error: `暂存第 ${chapterNum} 章失败：${err.message}` }
  }
}

/**
 * 停止条件四件套（spec §8.1，零 token）：写满 / 收卷或卷纲耗尽 / 连续无条目变动 / 批次质检不过线。
 * @returns {Promise<{stop: boolean, reasons: string[]}>}
 */
export async function judgeStop(ctx, batch) {
  const { repoPath, cache } = ctx
  if (!batch?.exists) return { stop: false, reasons: [] }
  const reasons = []
  const config = await new BookConfigReader(repoPath).read()
  const cfg = config.ok ? config.data : {}
  const 批次大小 = cfg.连写批次大小 || 8
  const 无变动上限 = cfg.连写无条目变动上限 || 3

  const facts = await stagedFacts(repoPath)
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

  const baseline = await readBaselineFingerprint(cache)
  const q = judgeBatchQuality(staged, baseline, cfg)
  if (!q.过线) reasons.push(...q.原因)

  return { stop: reasons.length > 0, reasons }
}

async function readBaselineFingerprint(cache) {
  try {
    const rows = await cache.query(
      'SELECT avg_sentence_length, sentence_length_variance FROM fingerprints WHERE is_baseline = 1 ORDER BY chapter_range_end DESC LIMIT 1'
    )
    return rows[0] || null
  } catch {
    return null
  }
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
    const h = String(staged[i].frontMatter.钩子 || '')
    if (h.includes('弱钩') || h.endsWith('-弱')) weak++
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
  const batch = await readBatch(repoPath)
  if (!batch.exists) return { ok: false, error: '没有进行中的待定稿批次' }
  const row = batch.章列表.find((r) => r.章号 === chapterNum)
  if (!row) {
    const 尾 = batch.章列表[batch.章列表.length - 1].章号
    return { ok: false, error: `第 ${chapterNum} 章不在批次内（批内是第 ${batch.起章}-${尾} 章）` }
  }
  const 受影响 = []
  for (const r of batch.章列表) {
    if (r.章号 === chapterNum) r.状态 = 章状态.打回
    else if (r.章号 > chapterNum) {
      r.状态 = 章状态.受影响
      受影响.push(r.章号)
    }
  }
  // 打回章工件清空（目录保留，元数据行保留——重写后 stage-chapter 覆盖）
  const dirP = path.join(repoPath, BATCH_DIR, row.目录)
  for (const f of ['草稿.md', '定稿包.json', '审稿单.md']) {
    await fs.rm(path.join(dirP, f), { force: true })
  }
  await writeAtomicBatch(repoPath, [metaFile(batch.章列表)])
  return { ok: true, 打回: chapterNum, 受影响, error: '' }
}

/**
 * 受影响章重审完成后回到「待审收」（重审通道：重跑两审 → save-review → 本函数搬审稿单更新状态）。
 */
export async function restageReview(repoPath, chapterNum) {
  const batch = await readBatch(repoPath)
  if (!batch.exists) return { ok: false, error: '没有进行中的待定稿批次' }
  const row = batch.章列表.find((r) => r.章号 === chapterNum)
  if (!row) return { ok: false, error: `第 ${chapterNum} 章不在批次内` }
  if (row.状态 === 章状态.打回) {
    return { ok: false, error: `第 ${chapterNum} 章是打回章，要重写后用 stage-chapter 重新暂存，不能只重审` }
  }
  let 审稿单 = ''
  try {
    审稿单 = await fs.readFile(path.join(repoPath, '工作区', '审稿.md'), 'utf8')
  } catch {
    return { ok: false, error: '工作区没有新审稿单（审稿.md），先重跑两审' }
  }
  await writeAtomicBatch(repoPath, [
    { path: path.join(BATCH_DIR, row.目录, '审稿单.md'), content: 审稿单 },
  ])
  row.状态 = 章状态.待审收
  await writeAtomicBatch(repoPath, [metaFile(batch.章列表)])
  await fs.rm(path.join(repoPath, '工作区', '审稿.md'), { force: true })
  await fs.rm(path.join(repoPath, '工作区', '评审报告'), { recursive: true, force: true })
  return { ok: true, 章号: chapterNum, error: '' }
}

/**
 * 批量定稿：全部（或 --until 前的）章须为「待审收」；升序逐章 finalizeChapter——
 * 每章独立原子 commit，中途失败停在该章、已入档保留（原子性按章保留）。
 */
export async function finalizeBatch(ctx, { until } = {}) {
  const { repoPath } = ctx
  const batch = await readBatch(repoPath)
  if (!batch.exists) return { ok: false, 已入档: [], error: '没有进行中的待定稿批次' }

  const inScope = (r) => (until ? r.章号 <= until : true)
  const 目标 = batch.章列表.filter(inScope)
  if (!目标.length) return { ok: false, 已入档: [], error: `--until=${until} 范围内没有批内章` }

  const 障碍 = 目标.filter((r) => r.状态 !== 章状态.待审收)
  if (障碍.length) {
    const list = 障碍.map((r) => `第 ${r.章号} 章（${r.状态}）`).join('、')
    return {
      ok: false,
      已入档: [],
      error: `批内还有未收口的章：${list}——打回章要重写重暂存、受影响章要重审，都回到「待审收」才能批量定稿`,
    }
  }

  const 已入档 = []
  let remaining = [...batch.章列表]
  for (const row of 目标) {
    const dirP = path.join(repoPath, BATCH_DIR, row.目录)
    let payload
    try {
      payload = JSON.parse(await fs.readFile(path.join(dirP, '定稿包.json'), 'utf8'))
    } catch (err) {
      return {
        ok: false,
        已入档,
        error: `第 ${row.章号} 章定稿包读取失败：${err.message}——之前 ${已入档.length} 章已入档保留，批次剩余原样`,
      }
    }
    // 本章工作区文件在暂存时已清；批次目录由本函数自管，防误删他章工件
    payload.workspaceFiles = []
    const r = await finalizeChapter(ctx, payload)
    if (!r.ok) {
      return {
        ok: false,
        已入档,
        失败章: row.章号,
        error: `第 ${row.章号} 章定稿失败：${r.error}——之前 ${已入档.length} 章已入档保留，批次剩余原样，修好后重跑 finalize-batch`,
      }
    }
    已入档.push({ 章号: row.章号, commit: r.commitHash })
    await fs.rm(dirP, { recursive: true, force: true })
    remaining = remaining.filter((x) => x.章号 !== row.章号)
    if (remaining.length) await writeAtomicBatch(repoPath, [metaFile(remaining)])
  }

  let 体检 = ''
  if (!remaining.length) {
    await fs.rm(path.join(repoPath, BATCH_DIR), { recursive: true, force: true })
    // 体检与批次对齐（spec §9：连写中每批次一次）；失败不阻断——批次已转正完成
    const hc = await runHealthCheck(ctx)
    体检 = hc.ok ? `体检已随批次完成（报告见 工作区/体检报告.md）` : `批末体检没跑成：${hc.error}`
  }
  return { ok: true, 已入档, 剩余: remaining.length, 体检, error: '' }
}

/** 整批丢弃：删工作区批次（未入 git，定稿零变化）。破坏性操作，宿主必须先经作者确认。 */
export async function discardBatch(repoPath) {
  const batch = await readBatch(repoPath)
  if (!batch.exists) return { ok: false, 章数: 0, error: '没有进行中的待定稿批次' }
  await fs.rm(path.join(repoPath, BATCH_DIR), { recursive: true, force: true })
  return { ok: true, 章数: batch.章列表.length, error: '' }
}
