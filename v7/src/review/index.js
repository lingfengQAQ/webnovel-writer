import { promises as fs } from 'node:fs'
import path from 'node:path'
import { assembleBookStatus } from '../prep/book-status.js'
import { extractSection } from '../util/markdown.js'
import { parseThreadDeclarations } from '../util/thread-declarations.js'
import { assembleCharacterContext } from '../dto/character-context.js'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'
import { TimelineReader } from '../storage/adapters/TimelineReader.js'
import { SecretReader } from '../storage/adapters/SecretReader.js'
import { ThreadLedgerReader } from '../storage/adapters/ThreadLedgerReader.js'
import { writeAtomicBatch } from '../storage/atomic.js'
import { validateReviewReport } from './schema.js'
import { stagedFacts, overlayBookStatus } from '../staging/index.js'
import { ContractReader } from '../storage/adapters/ContractReader.js'
import { parseOutlineDeclarations, findDeclared } from '../knowledge/index.js'
import { reviewOutcomeFile } from './outcome.js'
import { DesignReader } from '../storage/adapters/DesignReader.js'

const 兼容声明 = '本次使用兼容模式（单上下文顺序审稿），审稿隔离度低于完整两审模式。'
const 完整声明 = '完整两审模式（事实审查/编辑审各自独立上下文）。'

const 类型英文 = { 伏笔: 'foreshadow', 悬念: 'suspense', 感情线: 'romance' }

/**
 * 细纲声明命中的章级审查切片。书级规则只读本书作品契约，不回读通用题材/流派。
 */
async function assembleKnowledgeChecks(ctx, outlineText) {
  const out = []
  if (!ctx.packageRoot) return out
  try {
    const decl = parseOutlineDeclarations(outlineText)
    const hits = [
      ['节拍', decl.节拍 ? [decl.节拍] : []],
      ['追读', decl.钩子 ? [decl.钩子] : []],
      ['场景', decl.场景],
    ]
    for (const [dir, decls] of hits) {
      for (const d of decls) {
        const entry = await findDeclared(ctx.packageRoot, dir, d)
        if (!entry) continue
        if (entry.审稿时) out.push(`【${entry.fm.名称 || d}·核对】${entry.审稿时.replace(/\n+/g, ' ')}`)
      }
    }
  } catch {
    // 知识库不可用则略
  }
  return out
}

/**
 * 组装两审共享的 ReviewInput DTO（AI 不见文件路径,实施计划 §1.5 原则 1）。
 * 复用 M1 读接口 + M2 全书近况 + 细纲「要写到的事」。
 * 有待定稿批次时叠加批内预登记（只取本章之前的章）——批内第 K+1 章审稿能看到第 K 章事实。
 * @param {{repoPath, cache}} ctx
 * @param {{chapterNum: number, draftPath: string}} args
 */
export async function assembleReviewInput(ctx, { chapterNum, draftPath }) {
  try {
    const { repoPath, cache } = ctx
    const contract = await new ContractReader(repoPath).readReviewSections()
    if (!contract.ok) {
      return { ok: false, input: null, error: `组装审稿输入停止：${contract.error}` }
    }
    const facts = await stagedFacts(repoPath, { before: chapterNum })

    // resolve 而非 join：draftPath 传绝对路径时 join 会拼出坏路径
    const 草稿全文 = await fs.readFile(path.resolve(repoPath, draftPath), 'utf8')

    // 拟条目变动：草稿 front matter 三数组声明（与机检共用同一解析，不双写）
    const draftFm = parseFrontMatter(草稿全文)
    const { declarations } = parseThreadDeclarations(draftFm.ok ? draftFm.data : null)
    const 拟条目变动 = declarations.map(({ type, verb, id }) => ({ type, verb, id }))

    let 本章要写到的事 = '（无细纲）'
    let outlineText = ''
    try {
      outlineText = await fs.readFile(path.join(repoPath, '工作区', '细纲.md'), 'utf8')
      本章要写到的事 = extractSection(outlineText, '本章要写到的事') || '（细纲未声明）'
    } catch {
      // 无细纲
    }

    const 知识审查 = await assembleKnowledgeChecks(ctx, outlineText)
    const designDeclarations = parseOutlineDeclarations(outlineText).对象
    const designObjects = designDeclarations.length
      ? await new DesignReader(repoPath).readMany(designDeclarations, {
          excludePaths: facts.removedPlans || new Set(),
        })
      : { ok: true, objects: [], missing: [], error: '' }
    if (!designObjects.ok) {
      return { ok: false, input: null, error: `组装审稿输入停止：${designObjects.error}` }
    }

    const status = overlayBookStatus(await assembleBookStatus(ctx), facts)
    const 当前卷 = status.ok ? status.data.当前卷 : 1

    // P1-1：名册快照（正名+别名）,供 AI 判新专名,不泄漏路径;同时建 aliasMap 供角色别名命中
    let 名册 = []
    const aliasMap = new Map() // 正名 → 别名[]
    try {
      const rows = await cache.query(
        "SELECT e.id AS 正名, group_concat(a.alias, ',') AS 别名从句 FROM entities e LEFT JOIN entity_aliases a ON a.entity_id = e.id WHERE e.type = 'character' GROUP BY e.id"
      )
      名册 = rows.map((r) => {
        const 别名 = r.别名从句 ? r.别名从句.split(',').map((s) => s.trim()).filter(Boolean) : []
        if (别名.length) aliasMap.set(r.正名, 别名)
        return { 正名: r.正名, 别名 }
      })
    } catch {
      // 缓存不可用则略
    }
    // 批内预登记的名册行（新角色/新别名）
    for (const pair of facts.roster) {
      const row = 名册.find((x) => x.正名 === pair.正名)
      if (row) {
        for (const a of pair.别名) if (!row.别名.includes(a)) row.别名.push(a)
      } else {
        名册.push({ 正名: pair.正名, 别名: [...pair.别名] })
      }
      const known = aliasMap.get(pair.正名) || []
      aliasMap.set(pair.正名, [...new Set([...known, ...pair.别名])])
    }

    // 相关角色:扫角色目录,正名或别名出现在草稿里的纳入（P1-1:别名也要命中）
    const 相关角色 = []
    try {
      const dir = path.join(repoPath, '定稿', '设定', '角色')
      for (const f of await fs.readdir(dir)) {
        if (!f.endsWith('.md')) continue
        const name = f.replace(/\.md$/, '')
        const cc = await assembleCharacterContext(ctx, name)
        if (!cc.ok) continue
        // 别名合集:名册 entity_aliases（规范源）+ 角色卡 fm.别名
        const aliases = new Set(aliasMap.get(name) || [])
        const fmAliases = cc.context.别名
        if (Array.isArray(fmAliases)) fmAliases.forEach((a) => a && aliases.add(a))
        else if (typeof fmAliases === 'string')
          fmAliases.split(',').forEach((a) => a.trim() && aliases.add(a.trim()))
        const hit = 草稿全文.includes(name) || [...aliases].some((a) => a && 草稿全文.includes(a))
        if (!hit) continue
        // 批内预登记的角色变更叠加（第 K 章改了状态，K+1 章审稿要看到最新值）
        const upd = facts.characterUpdates.get(name)
        相关角色.push(upd ? { ...cc.context, ...upd } : cc.context)
      }
    } catch {
      // 无角色目录
    }

    const tl = await new TimelineReader(repoPath, cache).readVolumeRange(Math.max(1, 当前卷 - 1), 当前卷)
    const 时间线片段 = tl.ok ? tl.timeline.map((row) => ({ 章: row.章 ?? '', 事件: row.一句话事件 ?? '' })) : []
    for (const tr of facts.timelineRows) {
      时间线片段.push({ 章: tr.row?.章 ?? '', 事件: `${tr.row?.一句话事件 ?? ''}（批内预登记）` })
    }

    const secrets = await new SecretReader(repoPath, cache).listUnrevealed()
    const 信息差候选 = secrets.map((s) => ({ id: s.id, 短题: s.短题, 关键词: s.关键词 }))
    for (const s of facts.secretWrites) {
      const fm = s.frontMatter || {}
      if (fm.读者已知 === true || fm.读者已知 === 'true') continue
      信息差候选.push({ id: s.id, 短题: fm.短题 || s.id, 关键词: Array.isArray(fm.关键词) ? fm.关键词 : [] })
    }

    // P1-1：相关条目 = 仍在进行、且在本章前开启的条目（不泄漏 file_path）
    let 相关条目 = []
    try {
      const rows = await cache.query(
        "SELECT id, type, short_title, status, opened_chapter, last_advanced_chapter FROM threads WHERE status = '进行' AND opened_chapter <= ? ORDER BY opened_chapter",
        [chapterNum]
      )
      相关条目 = rows.map((r) => ({
        id: r.id,
        type: r.type,
        简述: r.short_title,
        状态: r.status,
        开启章: r.opened_chapter,
        最后推进章: r.last_advanced_chapter,
      }))
    } catch {
      // 缓存不可用则略
    }
    // 批内预登记的条目事实：新开条目补进清单，已有条目刷状态/最后推进章
    for (const [id, t] of facts.threads) {
      const row = 相关条目.find((x) => x.id === id)
      if (row) {
        if (t.状态) row.状态 = t.状态
        if (t.最后推进章) row.最后推进章 = t.最后推进章
      } else if (t.新开) {
        相关条目.push({
          id,
          type: 类型英文[t.type] || t.type,
          简述: id,
          状态: t.状态 || '进行',
          开启章: t.开启章,
          最后推进章: t.最后推进章 ?? t.开启章,
          批内预登记: true,
        })
      }
    }

    // 草稿声明涉及的条目附履历尾部（末 3 行）；未声明的维持纯元数据（控 token）
    const declaredIds = new Set(拟条目变动.map((d) => d.id))
    if (declaredIds.size) {
      const ledger = new ThreadLedgerReader(repoPath, cache)
      for (const t of 相关条目) {
        if (!declaredIds.has(t.id)) continue
        const h = await ledger.readHistory(t.id)
        if (h.ok && h.history.length) t.履历尾部 = h.history.slice(-3).map((x) => x.原文)
      }
    }

    return {
      ok: true,
      input: {
        章号: chapterNum,
        草稿全文,
        本章要写到的事,
        全书近况: status.ok ? status.markdown : '',
        相关角色,
        相关条目,
        拟条目变动,
        名册,
        时间线片段,
        信息差候选,
        作品契约: contract.content,
        知识审查,
        批内待转正事实: [...(facts.factChanges || new Map()).entries()].map(
          ([factPath, change]) => ({
            事实路径: factPath,
            来源章: change.章号,
            内容: change.content,
          })
        ),
        本章计划对象: designObjects.objects.map((object) => ({
          计划路径: object.path,
          分类: object.分类,
          ID: object.ID,
          名称: object.名称,
          ...(object.对象类型 ? { 对象类型: object.对象类型 } : {}),
          ...(object.正名 ? { 正名: object.正名 } : {}),
          ...(object.别名.length ? { 别名: object.别名 } : {}),
          本书设计: object.sections.get('本书设计'),
          一致性边界: object.sections.get('一致性边界'),
          提醒: '这是计划对象，不是已经成立的正文事实。',
        })),
        ...(designObjects.missing.length
          ? { 计划对象缺失提醒: `未找到：${designObjects.missing.join('、')}。按正文实际内容审查，不要求临时对象补档。` }
          : {}),
      },
      error: '',
    }
  } catch (err) {
    return { ok: false, input: null, error: `组装审稿输入失败：${err.message}` }
  }
}

/**
 * 合并两审输出 → 审稿单结构。已假定各报告经 schema 复算。
 * @param {{factCheck: object, editorial: object}} reports
 * @param {{mode: 'complete'|'degraded', chapterNum: number}} opts
 */
export function mergeReviews({ factCheck, editorial }, { mode, chapterNum }) {
  const fIssues = factCheck?.issues || []
  const eIssues = editorial?.issues || []
  const issues = [...fIssues, ...eIssues]
  const blocking_count = issues.filter((x) => x.blocking).length
  return {
    章号: chapterNum,
    mode,
    模式声明: mode === 'degraded' ? 兼容声明 : 完整声明,
    事实审查: factCheck,
    编辑审: editorial,
    issues,
    issues_count: issues.length,
    blocking_count,
    has_blocking: blocking_count > 0,
  }
}

/**
 * 落盘审稿单(§8 第7步:草稿+两审意见+待确认新专名+章摘要)与原始评审报告。
 * @param {{repoPath}} ctx
 * @param {{chapterNum, merged, draft, 待确认新专名?: string[], 章摘要?: string}} args
 */
export async function persistReviewReport(ctx, { chapterNum, merged, draft, 待确认新专名 = [], 章摘要 = '', raw = null }) {
  const { repoPath } = ctx

  const issueLines = merged.issues.length
    ? merged.issues
        .map((i) => `- [${i.severity}/${i.category}${i.blocking ? '/阻断' : ''}] ${i.location}：${i.description}（修复：${i.fix_hint}）`)
        .join('\n')
    : '（无问题）'

  const md = [
    `# 第 ${chapterNum} 章审稿单`,
    '',
    `> ${merged.模式声明}`,
    `> 共 ${merged.issues_count} 个问题：${merged.blocking_count} 阻断。`,
    '',
    '## 两审意见',
    issueLines,
    '',
    '## 待确认新专名',
    待确认新专名.length ? 待确认新专名.map((n) => `- ${n}`).join('\n') : '（无）',
    '',
    '## 章摘要（扫一眼可改）',
    章摘要 || '（无）',
    '',
    '## 草稿',
    draft,
    '',
  ].join('\n')

  // P0-3：多文件原子落盘;P1-3：原始输出与归一化结果分存,便于回溯模型原话
  const files = [
    { path: path.join('工作区', '评审报告', '事实审查.json'), content: JSON.stringify(merged.事实审查 ?? {}, null, 2) },
    { path: path.join('工作区', '评审报告', '编辑审.json'), content: JSON.stringify(merged.编辑审 ?? {}, null, 2) },
    reviewOutcomeFile(merged),
  ]
  if (raw) {
    files.push({ path: path.join('工作区', '评审报告', '事实审查.raw.json'), content: JSON.stringify(raw.factCheck ?? {}, null, 2) })
    files.push({ path: path.join('工作区', '评审报告', '编辑审.raw.json'), content: JSON.stringify(raw.editorial ?? {}, null, 2) })
  }
  files.push({ path: path.join('工作区', '审稿.md'), content: md })

  await writeAtomicBatch(repoPath, files)

  const 审稿路径 = path.join(repoPath, '工作区', '审稿.md')
  return { ok: true, 审稿路径, error: '' }
}

/**
 * 两审产物入库：schema 校验 → 合并 → 落盘。runReviews 与 save-review CLI 共用,不双写。
 * @param {{repoPath}} ctx
 * @param {{chapterNum, rawFact, rawEdit, mode?, 待确认新专名?, 章摘要?, draft}} args
 */
export async function saveReviews(ctx, { chapterNum, rawFact, rawEdit, mode = 'complete', 待确认新专名 = [], 章摘要 = '', draft }) {
  const vFact = validateReviewReport(rawFact, { reviewType: 'factCheck' })
  const vEdit = validateReviewReport(rawEdit, { reviewType: 'editorial' })
  const errors = [...vFact.errors, ...vEdit.errors]
  if (errors.length) return { ok: false, errors }

  const merged = mergeReviews({ factCheck: vFact.report, editorial: vEdit.report }, { mode, chapterNum })
  const saved = await persistReviewReport(ctx, {
    chapterNum,
    merged,
    draft,
    待确认新专名,
    章摘要,
    raw: { factCheck: rawFact, editorial: rawEdit },
  })
  return { ok: true, merged, 审稿路径: saved.审稿路径, errors: [] }
}

/**
 * 两审编排:组装输入 → DI 注入两审 → 校验 → 合并 → 落盘。零真 AI(reviewers 由宿主壳/测试注入)。
 * @param {{repoPath, cache}} ctx
 * @param {{chapterNum, draftPath, mode, reviewers, 待确认新专名?, 章摘要?}} args
 */
export async function runReviews(ctx, { chapterNum, draftPath, mode = 'complete', reviewers, 待确认新专名, 章摘要 }) {
  const inp = await assembleReviewInput(ctx, { chapterNum, draftPath })
  if (!inp.ok) return { ok: false, errors: [inp.error] }

  let rawFact
  let rawEdit
  if (mode === 'degraded') {
    if (typeof reviewers.degraded !== 'function') {
      return { ok: false, errors: ['兼容模式需要注入 degraded reviewer（单次 AI 调用）'] }
    }
    const raw = await reviewers.degraded(inp.input)
    rawFact = raw.factCheck ?? raw.事实审查 ?? { issues: [] }
    rawEdit = raw.editorial ?? raw.编辑审 ?? { issues: [] }
  } else {
    rawFact = await reviewers.factCheck(inp.input)
    rawEdit = await reviewers.editorial(inp.input)
  }

  return saveReviews(ctx, {
    chapterNum,
    rawFact,
    rawEdit,
    mode,
    待确认新专名,
    章摘要,
    draft: inp.input.草稿全文,
  })
}
