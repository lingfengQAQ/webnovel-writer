import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'
import { KNOWLEDGE_GROUPS, readEntry } from './index.js'

export const CHAPTER_KNOWLEDGE_DIMENSIONS = KNOWLEDGE_GROUPS.篇章执行
export const RECENT_KNOWLEDGE_CHAPTER_LIMIT = 8

export const CHAPTER_KNOWLEDGE_LABELS = Object.freeze({
  节拍: '本章节拍',
  场景: '本章场景',
  技法: '本章技法',
  追读: '本章追读',
})

const LABEL_TO_KEY = Object.freeze({
  本章节拍: '节拍',
  本章场景: '场景',
  本章技法: '技法',
  本章追读: '追读',
  知识变体: '变体',
  本章对象: '对象',
})

/** 确认细纲的六类声明位；四维知识都可空、可多选，变体按完整行保留。 */
export function parseChapterDeclarations(outline) {
  const out = { 节拍: [], 场景: [], 技法: [], 追读: [], 变体: [], 对象: [] }
  for (const line of String(outline || '').split(/\r?\n/)) {
    const match = line.trim().match(
      /^(本章节拍|本章场景|本章技法|本章追读|知识变体|本章对象)[：:]\s*(.*)$/
    )
    if (!match || !match[2].trim()) continue
    const key = LABEL_TO_KEY[match[1]]
    const values = key === '变体' ? [match[2].trim()] : normalizeList(match[2])
    for (const value of values) {
      if (!out[key].includes(value)) out[key].push(value)
    }
  }
  return out
}

/** 把细纲声明解析为已命中条目或自定义选择；匹配只认精确名称/编号。 */
export async function resolveChapterDeclarations(packageRoot, outlineOrDeclarations) {
  const declarations = typeof outlineOrDeclarations === 'string'
    ? parseChapterDeclarations(outlineOrDeclarations)
    : outlineOrDeclarations || parseChapterDeclarations('')
  const selections = []
  for (const dimension of CHAPTER_KNOWLEDGE_DIMENSIONS) {
    const declarationsForDimension = declarations?.[dimension] || []
    if (!declarationsForDimension.length) continue
    const files = packageRoot ? await listDimensionFiles(packageRoot, dimension) : []
    for (const declaration of declarationsForDimension) {
      selections.push({
        维度: dimension,
        声明: declaration,
        条目: packageRoot
          ? await readDeclaredEntry(packageRoot, dimension, files, declaration)
          : null,
      })
    }
  }
  return { declarations, selections }
}

/** 章档案使用平铺列表：`维度｜名称` 与真实发生的 `变体｜说明`。 */
export async function buildChapterKnowledgeArchive(packageRoot, outline) {
  const { declarations, selections } = await resolveChapterDeclarations(packageRoot, outline)
  const archived = []
  for (const selection of selections) {
    const name = selection.条目?.名称 || selection.声明
    pushUnique(archived, `${selection.维度}｜${name}`)
  }
  for (const variant of declarations.变体) pushUnique(archived, `变体｜${variant}`)
  return archived
}

/** 解析定稿章的最小历史，供候选软降权与重复提醒使用。 */
export function parseChapterKnowledgeArchive(value, { chapterNum } = {}) {
  if (!Array.isArray(value)) return []
  const selections = []
  const variants = []
  for (const raw of value) {
    const text = typeof raw === 'string' ? raw.trim() : ''
    const split = text.indexOf('｜')
    if (split <= 0 || split === text.length - 1) continue
    const dimension = text.slice(0, split).trim()
    const name = text.slice(split + 1).trim()
    if (dimension === '变体') variants.push(name)
    else if (CHAPTER_KNOWLEDGE_DIMENSIONS.includes(dimension)) {
      selections.push({ 维度: dimension, 名称: name })
    }
  }
  const variant = variants.join('；')
  return selections.map((selection) => ({
    ...selection,
    ...(Number.isInteger(chapterNum) ? { 章号: chapterNum } : {}),
    ...(variant ? { 变体: variant } : {}),
  }))
}

/** 最近若干章的选择历史；stagedChapters 覆盖同章定稿视图并参与统一倒序截断。 */
export async function readRecentChapterKnowledge(
  repoPath,
  { before = Number.POSITIVE_INFINITY, limit = RECENT_KNOWLEDGE_CHAPTER_LIMIT, stagedChapters = [] } = {}
) {
  const chapters = new Map()
  for (const chapter of Array.isArray(stagedChapters) ? stagedChapters : []) {
    if (!Number.isInteger(chapter?.章号) || chapter.章号 >= before) continue
    chapters.set(chapter.章号, { frontMatter: chapter.frontMatter || {} })
  }

  const dir = path.join(repoPath, '定稿', '正文')
  try {
    const files = (await fs.readdir(dir))
      .filter((file) => /^\d+-.*\.md$/.test(file))
      .sort(compareCodePoints)
    for (const file of files) {
      const chapterNum = Number(file.match(/^(\d+)-/)[1])
      if (!Number.isInteger(chapterNum) || chapterNum >= before || chapters.has(chapterNum)) continue
      chapters.set(chapterNum, { filePath: path.join(dir, file) })
    }
  } catch {
    // 新书尚无定稿目录时，近期历史自然为空。
  }

  const recent = [...chapters.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, Math.max(0, Number.isInteger(limit) ? limit : RECENT_KNOWLEDGE_CHAPTER_LIMIT))
  const history = []
  for (const [chapterNum, source] of recent) {
    let frontMatter = source.frontMatter
    if (!frontMatter) {
      try {
        const parsed = parseFrontMatter(await fs.readFile(source.filePath, 'utf8'))
        if (!parsed.ok) continue
        frontMatter = parsed.data
      } catch {
        continue
      }
    }
    history.push(...parseChapterKnowledgeArchive(frontMatter?.知识选择, { chapterNum }))
  }
  return history
}

/** 有确认细纲时以其覆盖 payload 里的知识选择；批量定稿无细纲时保留暂存值。 */
export async function archiveChapterKnowledgeFromOutline(ctx, payload) {
  let outline
  try {
    outline = await fs.readFile(path.join(ctx.repoPath, '工作区', '细纲.md'), 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: true, payload, found: false, error: '' }
    return { ok: false, payload, found: false, error: `确认细纲读取失败：${err.message}` }
  }

  try {
    const frontMatter = { ...(payload?.frontMatter || {}) }
    const archive = await buildChapterKnowledgeArchive(ctx.packageRoot, outline)
    if (archive.length) frontMatter.知识选择 = archive
    else delete frontMatter.知识选择
    return {
      ok: true,
      payload: { ...payload, frontMatter },
      found: true,
      error: '',
    }
  } catch (err) {
    return { ok: false, payload, found: true, error: `确认细纲知识解析失败：${err.message}` }
  }
}

async function listDimensionFiles(packageRoot, dimension) {
  try {
    return (await fs.readdir(path.join(packageRoot, 'references', dimension), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort(compareCodePoints)
  } catch {
    return []
  }
}

async function readDeclaredEntry(packageRoot, dimension, files, declaration) {
  const value = String(declaration || '').trim()
  if (!value) return null
  const id = dimension === '节拍' ? value.split(/[\s　]/)[0] : ''
  const candidateFiles = files.filter((file) => {
    const stem = file.slice(0, -3)
    return stem === value || stem.endsWith(`-${value}`) ||
      (id && (stem === id || stem.startsWith(`${id}-`)))
  })
  for (const file of candidateFiles) {
    const entry = await readEntry(packageRoot, `${dimension}/${file}`)
    if (!entry) continue
    const name = String(entry.fm.名称 || '').trim()
    const entryId = String(entry.fm.编号 || '').trim()
    if (value === name || (entryId && (
      value === entryId || value === `${entryId} ${name}` ||
      value.startsWith(`${entryId} `) || value.startsWith(`${entryId}　`)
    ))) {
      return { ...entry, 名称: name, ...(entryId ? { 编号: entryId } : {}) }
    }
  }
  return null
}

function normalizeList(value) {
  const out = []
  for (const item of String(value || '').split(/[、,，]/)) {
    const text = item.trim()
    if (text && !out.includes(text)) out.push(text)
  }
  return out
}

function pushUnique(values, value) {
  if (value && !values.includes(value)) values.push(value)
}

function compareCodePoints(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}
