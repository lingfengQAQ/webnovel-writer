import { promises as fs } from 'node:fs'
import path from 'node:path'
import { assembleBookStatus } from '../prep/book-status.js'
import { extractSection } from '../util/markdown.js'
import { assembleCharacterContext } from '../dto/character-context.js'
import { TimelineReader } from '../storage/adapters/TimelineReader.js'
import { SecretReader } from '../storage/adapters/SecretReader.js'
import { validateReviewReport } from './schema.js'

const 兼容声明 = '本次使用兼容模式（单上下文顺序审稿），审稿隔离度低于完整两审模式。'
const 完整声明 = '完整两审模式（事实审查/编辑审各自独立上下文）。'

/**
 * 组装两审共享的 ReviewInput DTO（AI 不见文件路径,实施计划 §1.5 原则 1）。
 * 复用 M1 读接口 + M2 全书近况 + 细纲「要写到的事」。
 * @param {{repoPath, cache}} ctx
 * @param {{chapterNum: number, draftPath: string}} args
 */
export async function assembleReviewInput(ctx, { chapterNum, draftPath }) {
  try {
    const { repoPath, cache } = ctx

    const 草稿全文 = await fs.readFile(path.join(repoPath, draftPath), 'utf8')

    let 本章要写到的事 = '（无细纲）'
    try {
      const outline = await fs.readFile(path.join(repoPath, '工作区', '细纲.md'), 'utf8')
      本章要写到的事 = extractSection(outline, '本章要写到的事') || '（细纲未声明）'
    } catch {
      // 无细纲
    }

    const status = await assembleBookStatus(ctx)
    const 当前卷 = status.ok ? status.data.当前卷 : 1

    // 相关角色:扫角色目录,正名出现在草稿里的纳入(不依赖缓存 schema)
    const 相关角色 = []
    try {
      const dir = path.join(repoPath, '定稿', '设定', '角色')
      for (const f of await fs.readdir(dir)) {
        if (!f.endsWith('.md')) continue
        const name = f.replace(/\.md$/, '')
        if (草稿全文.includes(name)) {
          const cc = await assembleCharacterContext(ctx, name)
          if (cc.ok) 相关角色.push(cc.context)
        }
      }
    } catch {
      // 无角色目录
    }

    const tl = await new TimelineReader(repoPath, cache).readVolumeRange(Math.max(1, 当前卷 - 1), 当前卷)
    const 时间线片段 = tl.ok ? tl.timeline.map((row) => ({ 章: row.章 ?? '', 事件: row.一句话事件 ?? '' })) : []

    const secrets = await new SecretReader(repoPath, cache).listUnrevealed()
    const 信息差候选 = secrets.map((s) => ({ id: s.id, 关键词: s.关键词 ?? s.keyword ?? '' }))

    return {
      ok: true,
      input: {
        章号: chapterNum,
        草稿全文,
        本章要写到的事,
        全书近况: status.ok ? status.markdown : '',
        相关角色,
        时间线片段,
        信息差候选,
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
export async function persistReviewReport(ctx, { chapterNum, merged, draft, 待确认新专名 = [], 章摘要 = '' }) {
  const { repoPath } = ctx
  const 工作区 = path.join(repoPath, '工作区')
  const 报告dir = path.join(工作区, '评审报告')
  await fs.mkdir(报告dir, { recursive: true })

  await fs.writeFile(path.join(报告dir, '事实审查.json'), JSON.stringify(merged.事实审查 ?? {}, null, 2), 'utf8')
  await fs.writeFile(path.join(报告dir, '编辑审.json'), JSON.stringify(merged.编辑审 ?? {}, null, 2), 'utf8')

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

  const 审稿路径 = path.join(工作区, '审稿.md')
  await fs.writeFile(审稿路径, md, 'utf8')
  return { ok: true, 审稿路径, error: '' }
}

/**
 * 两审编排:组装输入 → DI 注入两审 → 校验 → 合并 → 落盘。零真 AI(reviewers 由宿主壳/测试注入)。
 * @param {{repoPath, cache}} ctx
 * @param {{chapterNum, draftPath, mode, reviewers, 待确认新专名?, 章摘要?}} args
 */
export async function runReviews(ctx, { chapterNum, draftPath, mode = 'complete', reviewers, 待确认新专名, 章摘要 }) {
  const inp = await assembleReviewInput(ctx, { chapterNum, draftPath })
  if (!inp.ok) return { ok: false, errors: [inp.error] }

  const rawFact = await reviewers.factCheck(inp.input)
  const rawEdit = await reviewers.editorial(inp.input)

  const vFact = validateReviewReport(rawFact, { reviewType: 'factCheck' })
  const vEdit = validateReviewReport(rawEdit, { reviewType: 'editorial' })
  const errors = [...vFact.errors, ...vEdit.errors]
  if (errors.length) return { ok: false, errors }

  const merged = mergeReviews({ factCheck: vFact.report, editorial: vEdit.report }, { mode, chapterNum })
  const saved = await persistReviewReport(ctx, {
    chapterNum,
    merged,
    draft: inp.input.草稿全文,
    待确认新专名,
    章摘要,
  })
  return { ok: true, merged, 审稿路径: saved.审稿路径, errors: [] }
}
