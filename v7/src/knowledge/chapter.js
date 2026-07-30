import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'
import { sha256 } from '../util/hash.js'
import { KNOWLEDGE_GROUPS, readEntry } from './index.js'

export const CHAPTER_KNOWLEDGE_DIMENSIONS = KNOWLEDGE_GROUPS.篇章执行
export const RECENT_KNOWLEDGE_CHAPTER_LIMIT = 8
export const CHAPTER_OUTLINE_NAME = '细纲.md'
export const CHAPTER_KNOWLEDGE_SNAPSHOT_NAME = '细纲知识快照.json'
export const CHAPTER_OUTLINE_PATH = path.join('工作区', CHAPTER_OUTLINE_NAME)
export const CHAPTER_KNOWLEDGE_SNAPSHOT_PATH = path.join(
  '工作区',
  CHAPTER_KNOWLEDGE_SNAPSHOT_NAME
)

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
const CUSTOM_CHAPTER_SOURCES = new Set(['作者自定义', '对谈共创'])
const CHAPTER_SOURCE_RE = /^(节拍|场景|技法|追读)\/([^<>:"/\\|?*\u0000-\u001f@]+\.md)@sha256:[0-9a-f]{64}$/u
const CHAPTER_KNOWLEDGE_SNAPSHOT_SCHEMA_VERSION = 1
const DEFAULT_PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SNAPSHOT_KEYS = Object.freeze(['schemaVersion', 'outlineSha256', '知识选择'].sort())

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

/**
 * 章档案使用平铺列表：`维度｜名称｜来源` 与真实发生的 `变体｜说明`。
 * 正式条目只留最小 `路径@sha256`，自定义选择显式标明作者自定义。
 */
export async function buildChapterKnowledgeArchive(packageRoot, outline) {
  const { declarations, selections } = await resolveChapterDeclarations(packageRoot, outline)
  const archived = []
  for (const selection of selections) {
    const name = selection.条目?.名称 || selection.声明
    const source = selection.条目?.来源版本 || '作者自定义'
    pushUnique(archived, `${selection.维度}｜${name}｜${source}`)
  }
  for (const variant of declarations.变体) pushUnique(archived, `变体｜${variant}`)
  return archived
}

/** 细纲确认时冻结正式来源；运行时缺 packageRoot 的测试/嵌入调用使用当前分发包根。 */
export async function buildChapterKnowledgeSnapshot(ctx, outline) {
  const text = String(outline ?? '')
  const archive = await buildChapterKnowledgeArchive(
    ctx?.packageRoot || DEFAULT_PACKAGE_ROOT,
    text
  )
  const archiveValidation = validateChapterKnowledgeArchive(archive)
  if (!archiveValidation.ok) {
    throw new Error(`冻结知识选择格式不正确：${archiveValidation.errors.join('；')}`)
  }
  return {
    schemaVersion: CHAPTER_KNOWLEDGE_SNAPSHOT_SCHEMA_VERSION,
    outlineSha256: sha256(text),
    知识选择: archive,
  }
}

export function chapterKnowledgeSnapshotFile(snapshot) {
  return {
    path: CHAPTER_KNOWLEDGE_SNAPSHOT_PATH,
    content: JSON.stringify(snapshot, null, 2) + '\n',
  }
}

/** 快照只接受当前 schema；缺字段、旧字段和细纲 hash 漂移都要求重新确认。 */
export function validateChapterKnowledgeSnapshot(snapshot, outline) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { ok: false, data: null, error: '冻结快照必须是 JSON 对象' }
  }
  const keys = Object.keys(snapshot).sort()
  if (keys.length !== SNAPSHOT_KEYS.length || keys.some((key, index) => key !== SNAPSHOT_KEYS[index])) {
    return { ok: false, data: null, error: '冻结快照结构不正确，须重新确认细纲' }
  }
  if (snapshot.schemaVersion !== CHAPTER_KNOWLEDGE_SNAPSHOT_SCHEMA_VERSION) {
    return { ok: false, data: null, error: '冻结快照版本不受支持，须重新确认细纲' }
  }
  if (!/^[0-9a-f]{64}$/.test(snapshot.outlineSha256 || '')) {
    return { ok: false, data: null, error: '冻结快照缺少有效的细纲 sha256' }
  }
  const archiveValidation = validateChapterKnowledgeArchive(snapshot.知识选择)
  if (!archiveValidation.ok) {
    return {
      ok: false,
      data: null,
      error: `冻结快照知识选择格式不正确：${archiveValidation.errors.join('；')}`,
    }
  }
  if (snapshot.outlineSha256 !== sha256(String(outline ?? ''))) {
    return { ok: false, data: null, error: '细纲内容与冻结快照不一致，须重新确认细纲' }
  }
  return {
    ok: true,
    data: {
      schemaVersion: snapshot.schemaVersion,
      outlineSha256: snapshot.outlineSha256,
      知识选择: [...snapshot.知识选择],
    },
    error: '',
  }
}

export function parseChapterKnowledgeSnapshot(content, outline) {
  let snapshot
  try {
    snapshot = JSON.parse(String(content || ''))
  } catch (err) {
    return { ok: false, data: null, error: `冻结快照不是有效 JSON：${err.message}` }
  }
  return validateChapterKnowledgeSnapshot(snapshot, outline)
}

/** 解析单章档案；每项最终选择必须带来源，整体变体不复制到任一选择。 */
export function parseChapterKnowledgeArchive(value, { chapterNum } = {}) {
  const selections = []
  const variants = []
  for (const raw of Array.isArray(value) ? value : []) {
    const parsed = parseChapterKnowledgeArchiveItem(raw)
    if (!parsed.ok) continue
    if (parsed.variant) {
      pushUnique(variants, parsed.variant)
      continue
    }
    const selection = parsed.selection
    if (!selections.some((item) =>
      item.维度 === selection.维度 &&
      item.名称 === selection.名称 &&
      (item.来源 || '') === (selection.来源 || '')
    )) {
      selections.push(selection)
    }
  }
  return {
    ...(Number.isInteger(chapterNum) ? { 章号: chapterNum } : {}),
    选择: selections,
    本章整体变体: variants,
  }
}

/** 写盘前严格校验章档案；读取端可跳过坏项，写入端禁止制造不可读的新数据。 */
export function validateChapterKnowledgeArchive(value) {
  if (value === undefined) return { ok: true, errors: [] }
  if (!Array.isArray(value)) {
    return { ok: false, errors: ['「知识选择」必须是列表'] }
  }
  const errors = []
  for (let index = 0; index < value.length; index++) {
    const parsed = parseChapterKnowledgeArchiveItem(value[index])
    if (!parsed.ok) errors.push(`知识选择[${index}]${parsed.error}`)
  }
  return { ok: errors.length === 0, errors }
}

/** 按章历史转成机械同名降权所需的扁平选择；整体变体不进入逐项数据。 */
export function flattenRecentChapterKnowledge(history) {
  const flattened = []
  for (const chapter of Array.isArray(history) ? history : []) {
    if (Array.isArray(chapter?.选择)) {
      for (const selection of chapter.选择) {
        if (!selection?.维度 || !selection?.名称) continue
        flattened.push({
          ...(Number.isInteger(chapter.章号) ? { 章号: chapter.章号 } : {}),
          维度: selection.维度,
          名称: selection.名称,
          来源: selection.来源,
        })
      }
    }
  }
  return flattened
}

/** 最近若干章的选择历史；stagedChapters 覆盖同章定稿视图并参与统一倒序截断。
 * degradation：P1-F6 降级事件收集器（可选）——单章读失败静默跳章时上报。 */
export async function readRecentChapterKnowledge(
  repoPath,
  { before = Number.POSITIVE_INFINITY, limit = RECENT_KNOWLEDGE_CHAPTER_LIMIT, stagedChapters = [] } = {},
  degradation = null
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
        if (!parsed.ok) {
          // P1-F6 有损：章文件存在但解析失败，该章知识历史消失
          degradation?.report('readRecentChapterKnowledge.单章解析', `第${chapterNum}章：${parsed.error}`)
          continue
        }
        frontMatter = parsed.data
      } catch (err) {
        // P1-F6 有损：章文件存在但读失败，该章知识历史消失
        degradation?.report('readRecentChapterKnowledge.单章读', `第${chapterNum}章：${err.message}`)
        continue
      }
    }
    const chapter = parseChapterKnowledgeArchive(frontMatter?.知识选择, { chapterNum })
    if (chapter.选择.length || chapter.本章整体变体.length) history.push(chapter)
  }
  return history
}

/** 有确认细纲时以其覆盖 payload 里的知识选择；批量定稿无细纲时保留暂存值。 */
export async function archiveChapterKnowledgeFromOutline(ctx, payload) {
  const [outlineFile, snapshotFile] = await Promise.all([
    readOptionalWorkspaceFile(ctx.repoPath, CHAPTER_OUTLINE_PATH),
    readOptionalWorkspaceFile(ctx.repoPath, CHAPTER_KNOWLEDGE_SNAPSHOT_PATH),
  ])
  if (!outlineFile.ok) {
    return { ok: false, payload, found: false, error: `确认细纲读取失败：${outlineFile.error}` }
  }
  if (!snapshotFile.ok) {
    return { ok: false, payload, found: outlineFile.exists, error: `冻结快照读取失败：${snapshotFile.error}` }
  }
  if (!outlineFile.exists && !snapshotFile.exists) {
    const validation = validateChapterKnowledgeArchive(payload?.frontMatter?.知识选择)
    if (!validation.ok) {
      return {
        ok: false,
        payload,
        found: false,
        error: `章档案知识选择格式不正确：${validation.errors.join('；')}`,
      }
    }
    return { ok: true, payload, found: false, error: '' }
  }
  if (!outlineFile.exists) {
    return {
      ok: false,
      payload,
      found: false,
      error: '存在细纲知识冻结快照但确认细纲缺失，须重新确认细纲',
    }
  }
  if (!snapshotFile.exists) {
    return {
      ok: false,
      payload,
      found: true,
      error: '确认细纲缺少知识冻结快照，须重新确认细纲',
    }
  }

  const snapshot = parseChapterKnowledgeSnapshot(snapshotFile.content, outlineFile.content)
  if (!snapshot.ok) {
    return { ok: false, payload, found: true, error: snapshot.error }
  }

  try {
    const frontMatter = { ...(payload?.frontMatter || {}) }
    const archive = snapshot.data.知识选择
    if (archive.length) frontMatter.知识选择 = [...archive]
    else delete frontMatter.知识选择
    return {
      ok: true,
      payload: { ...payload, frontMatter },
      found: true,
      error: '',
    }
  } catch (err) {
    return { ok: false, payload, found: true, error: `冻结细纲知识归档失败：${err.message}` }
  }
}

/** 定稿 commit 后由系统清理已消费的细纲与快照，不经 payload.workspaceFiles。 */
export async function cleanConfirmedOutlineArtifacts(repoPath) {
  const warnings = []
  for (const name of [CHAPTER_OUTLINE_NAME, CHAPTER_KNOWLEDGE_SNAPSHOT_NAME]) {
    try {
      await fs.rm(path.join(repoPath, '工作区', name), { force: true })
    } catch (err) {
      warnings.push(`工作区/${name} 清理失败（${err.message}）——本章已入档，稍后手动删除即可。`)
    }
  }
  return warnings
}

async function readOptionalWorkspaceFile(repoPath, relPath) {
  try {
    return {
      ok: true,
      exists: true,
      content: await fs.readFile(path.join(repoPath, relPath), 'utf8'),
      error: '',
    }
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: true, exists: false, content: '', error: '' }
    return { ok: false, exists: false, content: '', error: err.message }
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

function parseChapterKnowledgeArchiveItem(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return { ok: false, error: '必须是非空字符串' }
  const parts = text.split('｜').map((part) => part.trim())
  if (parts[0] === '变体') {
    if (parts.length !== 2 || !parts[1]) {
      return { ok: false, error: '必须使用「变体｜说明」格式，且说明不能为空' }
    }
    return { ok: true, variant: parts[1] }
  }
  if (parts.length !== 3) {
    return { ok: false, error: '必须使用「维度｜名称｜来源」格式' }
  }
  const [dimension, name, source] = parts
  if (!CHAPTER_KNOWLEDGE_DIMENSIONS.includes(dimension)) {
    return { ok: false, error: `维度必须是${CHAPTER_KNOWLEDGE_DIMENSIONS.join('、')}之一` }
  }
  if (!name) return { ok: false, error: '名称不能为空' }
  if (!CUSTOM_CHAPTER_SOURCES.has(source)) {
    const match = source.match(CHAPTER_SOURCE_RE)
    if (!match || match[2].includes('..')) {
      return {
        ok: false,
        error: '正式来源必须是直接 canonical 路径并带 64 位小写 sha256',
      }
    }
    if (match[1] !== dimension) {
      return { ok: false, error: `来源维度「${match[1]}」与选择维度「${dimension}」不一致` }
    }
  }
  return {
    ok: true,
    selection: { 维度: dimension, 名称: name, 来源: source },
  }
}

function compareCodePoints(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}
