import { promises as fs } from 'node:fs'
import path from 'node:path'
import { assembleBookStatus } from './book-status.js'
import { extractSection } from '../util/markdown.js'
import { TimelineReader } from '../storage/adapters/TimelineReader.js'
import { SecretReader } from '../storage/adapters/SecretReader.js'
import { ChapterReader } from '../storage/adapters/ChapterReader.js'
import { stagedFacts, overlayBookStatus } from '../staging/index.js'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'
import { ContractReader } from '../storage/adapters/ContractReader.js'
import { DesignReader } from '../storage/adapters/DesignReader.js'
import {
  CHAPTER_KNOWLEDGE_LABELS,
  parseChapterDeclarations,
  resolveChapterDeclarations,
} from '../knowledge/chapter.js'

/**
 * 备料：组装 工作区/本章写作材料.md（spec §8 step3，默认精准片段）。
 * 组件：全书近况 + 要写到的事 + 事实切片 + 信息差边界 + 近章结尾 + 反复读清单 + 文风锚点
 *       + 题材流派契约（§6.3，无契约的书降级）+ 细纲声明命中的知识切片（声明即路由，§7）。
 * 有待定稿批次时按"定稿 + 批内预登记"叠加组装（spec §8.1，批内事实只取本章之前的章）。
 * @param {{repoPath: string, cache: object, packageRoot?: string}} ctx
 * @param {{chapterNum: number}} args
 * @returns {Promise<{ok: boolean, filePath: string, content: string, error: string}>}
 */
export async function prepareChapterMaterials(ctx, { chapterNum }) {
  try {
    const { repoPath, cache } = ctx
    const contract = await new ContractReader(repoPath).readWritingSections()
    if (!contract.ok) {
      return { ok: false, filePath: '', content: '', error: `备料停止：${contract.error}` }
    }

    const facts = await stagedFacts(repoPath, { before: chapterNum })
    const status = overlayBookStatus(await assembleBookStatus(ctx), facts)
    const 当前卷 = status.ok ? status.data.当前卷 : 1

    // 本章要写到的事 + 知识声明位（读细纲）
    let 要写到的事 = '（无细纲）'
    let outlineText = ''
    try {
      outlineText = await fs.readFile(path.join(repoPath, '工作区', '细纲.md'), 'utf8')
      要写到的事 = extractSection(outlineText, '本章要写到的事') || '（细纲未声明）'
    } catch {
      // 无细纲
    }

    // 事实切片：当前卷+上一卷时间线（精准片段）+ 批内预登记行
    const tl = await new TimelineReader(repoPath, cache).readVolumeRange(
      Math.max(1, 当前卷 - 1),
      当前卷
    )
    const 时间线行 =
      tl.ok && tl.timeline.length
        ? tl.timeline.map((row) => `- ${row.章 ?? ''} ${row.一句话事件 ?? ''}`)
        : []
    for (const tr of facts.timelineRows) {
      时间线行.push(`- ${tr.row?.章 ?? ''} ${tr.row?.一句话事件 ?? ''}（批内预登记）`)
    }
    const 时间线md = 时间线行.length ? 时间线行.join('\n') : '（无）'

    // 信息差边界（未揭晓，勿泄）：短题+知情人+关键词+内容首句——写稿 AI 知道秘密才守得住秘密
    const secretReader = new SecretReader(repoPath, cache)
    const secrets = await secretReader.listUnrevealed()
    const 信息差行 = []
    for (const s of secrets) {
      const fl = await secretReader.readContentFirstLine(s.id)
      const 知情人 = s.知情人.length ? s.知情人.join('、') : '（未登记）'
      const 关键词 = s.关键词.length ? s.关键词.join('/') : '（无）'
      信息差行.push(
        `- ${s.id}（${s.短题}）：知情人=${知情人}；关键词=${关键词}；内容：${fl.line || '（未读到）'}——读者未知，除知情人的对话与视角外不得出现`
      )
    }
    // 批内预登记的信息差（未揭晓）一并守住
    for (const s of facts.secretWrites) {
      const fm = s.frontMatter || {}
      if (fm.读者已知 === true || fm.读者已知 === 'true') continue
      const 知情人 = Array.isArray(fm.知情人) && fm.知情人.length ? fm.知情人.join('、') : '（未登记）'
      const 关键词 = Array.isArray(fm.关键词) && fm.关键词.length ? fm.关键词.join('/') : '（无）'
      信息差行.push(
        `- ${s.id}（批内预登记）：知情人=${知情人}；关键词=${关键词}；内容：${firstContentLine(s.content)}——读者未知，除知情人的对话与视角外不得出现`
      )
    }
    const 信息差md = 信息差行.length ? 信息差行.join('\n') : '（无）'

    // 近章结尾（近 2 章末尾 150 字，反复读防接不上）：批内暂存章优先，不足回定稿章补
    const stagedTail = facts.chapters.slice(-2)
    const tails = []
    const need = 2 - stagedTail.length
    if (need > 0) {
      const recent = await cache.query(
        'SELECT chapter_num FROM chapters ORDER BY chapter_num DESC LIMIT ?',
        [need]
      )
      const reader = new ChapterReader(repoPath, cache)
      for (const r of recent.reverse()) {
        const t = await reader.readTail(r.chapter_num, 150)
        tails.push(`### 第${r.chapter_num}章结尾\n${t.ok ? t.text : ''}`)
      }
    }
    for (const c of stagedTail) {
      tails.push(`### 第${c.章号}章结尾（批内暂存）\n${charTail(c.body, 150)}`)
    }

    // 文风锚点（读文风铁律：纯作者品味）
    let 文风锚点 = '（无文风铁律）'
    try {
      const fl = await fs.readFile(path.join(repoPath, '文风', '文风铁律.md'), 'utf8')
      const 铁律 = extractSection(fl, '铁律')
      const 节奏 = extractSection(fl, '节奏偏好')
      文风锚点 = [铁律 && `铁律：${铁律}`, 节奏 && `节奏偏好：${节奏}`].filter(Boolean).join('\n')
    } catch {
      // 无文风铁律
    }

    const 契约段 = `## 作品契约（本章所需）\n${contract.content.replace(/^## /gm, '### ')}`

    const declarations = parseChapterDeclarations(outlineText)
    const designObjects = await assembleDesignObjects(
      repoPath,
      declarations.对象,
      facts.removedPlans || new Set()
    )
    if (!designObjects.ok) {
      return { ok: false, filePath: '', content: '', error: `备料停止：${designObjects.error}` }
    }
    const stagedFactObjects = assembleStagedFactObjects(facts.factChanges)

    // 细纲声明命中的知识切片（声明即路由；查不到表注入声明文本本身，spec §7）
    const 知识切片 = await declaredKnowledge(ctx.packageRoot, outlineText)

    // 反复读清单：体检产出的跨章高频意象（meta imagery_top），提醒本章避免再用
    let 反复读 = '（尚未体检，暂无数据——首次体检后自动填充）'
    try {
      const metaRows = await cache.query("SELECT value FROM meta WHERE key = 'imagery_top'")
      if (metaRows.length) {
        const top = JSON.parse(metaRows[0].value || '[]')
        反复读 = top.length
          ? top
              .slice(0, 10)
              .map(
                (t) => `- 「${t.phrase}」全书已用 ${t.count} 次（${t.chapterCount} 章出现），本章避免再用`
              )
              .join('\n')
          : '（最近一次体检没有查出跨章高频复用短语）'
      }
    } catch {
      // meta 读不到按未体检处理
    }

    const parts = [
      `# 第 ${chapterNum} 章写作材料`,
      '',
      status.ok ? status.markdown : '## 全书近况\n（组装失败）',
      '',
      `## 本章要写到的事\n${要写到的事}`,
      '',
      `## 事实切片：时间线（当前卷+上一卷）\n${时间线md}`,
      '',
      `## 信息差边界（未揭晓，勿泄）\n${信息差md}`,
      '',
      `## 近章结尾\n${tails.join('\n\n') || '（无）'}`,
      '',
      `## 文风锚点\n${文风锚点}`,
      '',
      契约段,
      '',
      ...(designObjects.content ? [designObjects.content, ''] : []),
      ...(stagedFactObjects ? [stagedFactObjects, ''] : []),
      ...(知识切片 ? [知识切片, ''] : []),
      `## 反复读清单\n${反复读}`,
      '',
    ]
    const content = parts.join('\n')

    const dir = path.join(repoPath, '工作区')
    await fs.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, '本章写作材料.md')
    await fs.writeFile(filePath, content, 'utf8')
    await fs.rm(path.join(dir, '契约更新待重备料.md'), { force: true })

    return { ok: true, filePath, content, error: '' }
  } catch (err) {
    return { ok: false, filePath: '', content: '', error: `备料失败：${err.message}` }
  }
}

function assembleStagedFactObjects(changes) {
  if (!(changes instanceof Map) || !changes.size) return ''
  const parts = [
    '## 批内待转正事实',
    '',
    '> 以下事实来自本章之前已过审的批内章节，尚未正式入档，但本章须按其保持一致。',
  ]
  for (const [factPath, change] of changes) {
    parts.push('', `### 第 ${change.章号} 章：${factPath}`, '', change.content)
  }
  return parts.join('\n')
}

async function assembleDesignObjects(repoPath, references, excludePaths) {
  if (!references.length) return { ok: true, content: '', error: '' }
  const result = await new DesignReader(repoPath).readMany(references, { excludePaths })
  if (!result.ok) return { ok: false, content: '', error: result.error }
  const parts = [
    '## 本章计划对象（尚未转正）',
    '',
    '> 以下内容用于保持设计一致，不代表正文已经建立这些事实。',
  ]
  for (const object of result.objects) {
    const type = object.对象类型 ? `/${object.对象类型}` : ''
    parts.push(
      '',
      `### ${object.ID} ${object.正名 || object.名称}（${object.分类}${type}）`,
      '',
      '#### 本书设计',
      object.sections.get('本书设计'),
      '',
      '#### 一致性边界',
      object.sections.get('一致性边界')
    )
  }
  if (result.missing.length) {
    parts.push('', `- 未找到计划对象：${result.missing.join('、')}。按本章文本继续，不要求临时对象补档。`)
  }
  return { ok: true, content: parts.join('\n'), error: '' }
}

// 批内暂存章的结尾片段（与 ChapterReader.readTail 同口径：正文末 N 个字符）
function charTail(body, n) {
  return [...String(body)].slice(-n).join('').trim()
}

/** 确认细纲的四维选择 → 落笔切片；自定义与真实变体保留原文。 */
async function declaredKnowledge(packageRoot, outlineText) {
  const { declarations, selections } = await resolveChapterDeclarations(packageRoot, outlineText)
  const parts = []
  for (const selection of selections) {
    const label = CHAPTER_KNOWLEDGE_LABELS[selection.维度]
    if (selection.条目?.落笔时) {
      parts.push(`### ${label}：${selection.声明}\n${selection.条目.落笔时}`)
    } else if (selection.条目) {
      parts.push(`### ${label}：${selection.声明}\n（该条目没有额外落笔切片，按细纲声明执行）`)
    } else {
      parts.push(`### ${label}：${selection.声明}\n（自定义选择，按细纲声明执行）`)
    }
  }
  if (declarations.变体.length) {
    parts.push(`### 知识变体\n${declarations.变体.map((item) => `- ${item}`).join('\n')}`)
  }
  return parts.length ? `## 本章知识切片（按细纲声明注入）\n\n${parts.join('\n\n')}` : ''
}

// 信息差内容首句（跳过空行与小节标题）
function firstContentLine(content) {
  for (const line of String(content || '').split('\n')) {
    const t = line.trim()
    if (t && !t.startsWith('#')) return t
  }
  return '（未读到）'
}
