import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'
import { extractSection } from '../util/markdown.js'
import { sha256 } from '../util/hash.js'

const REF = 'references'
export const MAX_KNOWLEDGE_CANDIDATES = 3

export const KNOWLEDGE_GROUPS = Object.freeze({
  作品契约: Object.freeze(['题材', '流派', '创意约束']),
  故事对象: Object.freeze(['设定', '人物', '命名']),
  篇章执行: Object.freeze(['节拍', '场景', '技法', '追读']),
})

export const KNOWLEDGE_DIMENSIONS = Object.freeze(
  Object.values(KNOWLEDGE_GROUPS).flat()
)

const DEFINITIONS = Object.freeze({
  题材: Object.freeze({ 阶段: '作品契约', 索引字段: Object.freeze(['名称']) }),
  流派: Object.freeze({ 阶段: '作品契约', 索引字段: Object.freeze(['名称']) }),
  创意约束: Object.freeze({
    阶段: '作品契约',
    索引字段: Object.freeze(['名称', '一句话']),
  }),
  设定: Object.freeze({
    阶段: '故事对象',
    索引字段: Object.freeze(['名称', '对象类型', '一句话']),
  }),
  人物: Object.freeze({
    阶段: '故事对象',
    索引字段: Object.freeze(['名称', '人物类别', '关系类别', '一句话']),
  }),
  命名: Object.freeze({
    阶段: '故事对象',
    索引字段: Object.freeze(['名称', '命名对象', '一句话']),
  }),
  节拍: Object.freeze({
    阶段: '篇章执行',
    索引字段: Object.freeze(['编号', '名称', '一句话', '关键词']),
  }),
  场景: Object.freeze({
    阶段: '篇章执行',
    索引字段: Object.freeze(['名称', '一句话', '关键词']),
  }),
  技法: Object.freeze({
    阶段: '篇章执行',
    索引字段: Object.freeze(['名称', '类别', '作用层级', '触发问题', '一句话']),
  }),
  追读: Object.freeze({
    阶段: '篇章执行',
    索引字段: Object.freeze(['名称', '一句话', '关键词']),
  }),
})

export function getDimensionDefinition(dimension) {
  return DEFINITIONS[dimension] || null
}

/** 路由.csv 只做题材/流派 canonical 归一；文件缺失返回空表。 */
export async function loadRoutes(packageRoot) {
  let raw
  try {
    raw = await fs.readFile(path.join(packageRoot, REF, '路由.csv'), 'utf8')
  } catch {
    return []
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const rows = []
  for (const line of lines.slice(1)) {
    const cols = line.split(',')
    if (cols.length < 5) continue
    const dimension = cols[1].trim()
    if (dimension !== '题材' && dimension !== '流派') continue
    rows.push({
      名称: cols[0].trim(),
      维度: dimension,
      题材: cols[2].trim(),
      条目: cols[3].trim(),
      别名: cols[4].split(';').map((alias) => alias.trim()).filter(Boolean),
    })
  }
  return rows
}

/** 名称/别名归一；可用 dimension 限定题材或流派。 */
export function resolveLabel(rows, input, dimension = '') {
  const label = String(input || '').trim()
  if (!label) return null
  for (const row of rows) {
    if (dimension && row.维度 !== dimension) continue
    if (row.名称 === label || row.别名.includes(label)) return row
  }
  return null
}

/**
 * 书级 canonical 归一。路由只改名称并给兼容提醒，不选择创意约束或作品方案。
 */
export async function resolveBookKnowledge(
  packageRoot,
  { 类型, 副题材 = [], 流派 = [] }
) {
  const rows = await loadRoutes(packageRoot)
  const 未命中 = []

  const mainRow = resolveLabel(rows, 类型, '题材')
  const 题材命中 = mainRow ? await withRouteContent(packageRoot, mainRow) : null
  if (!题材命中 && String(类型 || '').trim()) {
    未命中.push({ 维度: '题材', 输入: String(类型).trim() })
  }

  const 副题材命中 = []
  const seenTopics = new Set(题材命中 ? [题材命中.名称] : [])
  for (const input of normalizeList(副题材)) {
    const row = resolveLabel(rows, input, '题材')
    if (!row) {
      未命中.push({ 维度: '副题材', 输入: input })
      continue
    }
    if (seenTopics.has(row.名称)) continue
    seenTopics.add(row.名称)
    副题材命中.push(await withRouteContent(packageRoot, row))
  }

  const 流派命中 = []
  const seenGenres = new Set()
  for (const input of normalizeList(流派)) {
    const row = resolveLabel(rows, input, '流派')
    if (!row) {
      未命中.push({ 维度: '流派', 输入: input })
      continue
    }
    if (seenGenres.has(row.名称)) continue
    seenGenres.add(row.名称)
    流派命中.push(await withRouteContent(packageRoot, row))
  }

  const selectedTopics = new Set(
    [题材命中, ...副题材命中].filter(Boolean).map((entry) => entry.名称)
  )
  const 兼容提醒 = []
  if (selectedTopics.size) {
    for (const genre of 流派命中) {
      const allowed = String(genre.题材 || '').split('|').map((name) => name.trim()).filter(Boolean)
      if (allowed.includes('全部') || allowed.some((name) => selectedTopics.has(name))) continue
      兼容提醒.push(
        '流派“' + genre.名称 + '”的已知兼容题材为 ' + allowed.join('、') +
          '；保留作者选择，但需在融合协议中解释。'
      )
    }
  }

  return { 题材命中, 副题材命中, 流派命中, 未命中, 兼容提醒 }
}

/** 旧调用面在一次性切换期间的内部桥接；最终调用者改完后删除。 */
export async function resolveBookTags(packageRoot, { 类型, 流派 = [] }) {
  const result = await resolveBookKnowledge(packageRoot, { 类型, 流派 })
  return {
    题材命中: result.题材命中,
    流派命中: result.流派命中,
    未命中: result.未命中.map((item) => item.输入),
  }
}

async function withRouteContent(packageRoot, row) {
  const out = {
    名称: row.名称,
    维度: row.维度,
    题材: row.题材,
    条目: row.条目,
    content: '',
    来源版本: '',
  }
  const rel = normalizeReferencePath(row.条目)
  if (!rel) return out
  try {
    out.content = await fs.readFile(path.join(packageRoot, REF, ...rel.split('/')), 'utf8')
    out.来源版本 = versionedPath(rel, out.content)
  } catch {
    // 路由可先于条目存在：归一仍有效，内容按空降级。
  }
  return out
}

/** 读单条正式知识，返回分阶段切片与来源 hash；失败返回 null。 */
export async function readEntry(packageRoot, relPath) {
  const rel = normalizeReferencePath(relPath)
  if (!rel) return null

  let raw
  try {
    raw = await fs.readFile(path.join(packageRoot, REF, ...rel.split('/')), 'utf8')
  } catch {
    return null
  }
  const fm = parseFrontMatter(raw)
  if (!fm.ok || !fm.data || !fm.data.名称) return null

  return {
    维度: rel.split('/')[0],
    文件: rel,
    来源版本: versionedPath(rel, raw),
    fm: fm.data,
    body: fm.body,
    规划: extractSection(fm.body, '规划这一章时') || extractSection(fm.body, '规划时'),
    落笔时: extractSection(fm.body, '落笔时'),
    审稿时: extractSection(fm.body, '审稿时'),
  }
}

/** 按维度列出直接目录中的正式条目；不递归扫描。 */
export async function listKnowledgeEntries(packageRoot, dimension) {
  if (!getDimensionDefinition(dimension)) return []
  const abs = path.join(packageRoot, REF, dimension)
  let names
  try {
    names = (await fs.readdir(abs, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort(compareCodePoints)
  } catch {
    return []
  }

  const entries = []
  for (const name of names) {
    const entry = await readEntry(packageRoot, dimension + '/' + name)
    if (!entry) continue
    entries.push({
      ...adaptIndexFields(dimension, entry.fm),
      维度: dimension,
      文件: entry.文件,
      来源版本: entry.来源版本,
      规划: entry.规划,
      落笔时: entry.落笔时,
      审稿时: entry.审稿时,
    })
  }
  return entries
}

/**
 * 按当前问题和精确筛选返回少量候选。无机械信号时返回空集，交由对谈自定义。
 */
export async function queryKnowledge(
  packageRoot,
  dimension,
  { 问题 = '', 筛选 = {}, 近期 = [], limit = MAX_KNOWLEDGE_CANDIDATES } = {}
) {
  const definition = getDimensionDefinition(dimension)
  if (!definition) return []

  const query = String(问题 || '').trim()
  const filters = normalizeFilters(筛选, definition.索引字段)
  if (!query && !Object.keys(filters).length) return []

  const entries = await listKnowledgeEntries(packageRoot, dimension)
  const ranked = []
  for (const entry of entries) {
    if (!matchesFilters(entry, filters)) continue
    let score = query ? queryScore(entry, query, definition.索引字段) : 20
    if (query && score <= 0) continue

    const recentUses = normalizeRecentUses(近期, dimension, entry.名称)
    for (let i = 0; i < recentUses.length; i++) {
      score -= Math.max(1, 4 - i)
    }
    ranked.push({ entry, score, recentUses })
  }

  const max = Math.min(
    MAX_KNOWLEDGE_CANDIDATES,
    Math.max(1, Number.isInteger(limit) ? limit : MAX_KNOWLEDGE_CANDIDATES)
  )
  ranked.sort(
    (a, b) => b.score - a.score || compareCodePoints(a.entry.文件, b.entry.文件)
  )
  return ranked.slice(0, max).map(({ entry, recentUses }) => ({
    ...entry,
    ...(recentUses.length
      ? {
          近期使用: recentUses,
          重复提醒:
            '近期使用过同名知识，仅作软降权；请结合剧情功能、落地方式和递进关系判断是否机械重复。',
        }
      : {}),
  }))
}

/** 章级旧索引调用面；由十维正式读取器提供数据。 */
export async function listChapterIndex(packageRoot, dimension) {
  if (!KNOWLEDGE_GROUPS.篇章执行.includes(dimension)) return []
  const entries = await listKnowledgeEntries(packageRoot, dimension)
  return entries.map((entry) => ({
    名称: entry.名称,
    编号: entry.编号 || '',
    关键词: entry.关键词 || [],
    一句话: entry.一句话 || '',
    文件: entry.文件,
  }))
}

/** 按编号或名称精确读取已声明知识；自定义声明返回 null。 */
export async function findDeclared(packageRoot, dimension, declaration) {
  const decl = String(declaration || '').trim()
  if (!decl) return null
  const entries = await listKnowledgeEntries(packageRoot, dimension)
  const hit = entries.find(
    (entry) =>
      (entry.编号 && decl.startsWith(entry.编号)) ||
      decl === entry.名称 ||
      decl.includes(entry.名称)
  )
  return hit ? readEntry(packageRoot, hit.文件) : null
}

/** 场景候选保留为薄封装，实际走同一个有限候选查询器。 */
export async function sceneCandidates(packageRoot, texts) {
  const corpus = (Array.isArray(texts) ? texts : [texts]).filter(Boolean).join('\n')
  if (!corpus) return []
  const hits = await queryKnowledge(packageRoot, '场景', { 问题: corpus })
  return hits.map((entry) => ({ 名称: entry.名称, 一句话: entry.一句话 || '' }))
}

/**
 * 旧细纲声明解析器在章级调用切换前保留；下一阶段一次性改为十维目标标签。
 */
export function parseOutlineDeclarations(outline) {
  const out = { 节拍: '', 钩子: '', 场景: [], 对象: [] }
  for (const line of String(outline || '').split('\n')) {
    const text = line.trim()
    const match = text.match(/^(本章节拍|章尾钩子|本章场景|本章对象)[：:]\s*(.*)$/)
    if (!match || !match[2]) continue
    const value = match[2].trim()
    if (match[1] === '本章节拍') out.节拍 = value
    else if (match[1] === '章尾钩子') out.钩子 = value
    else if (match[1] === '本章场景') out.场景 = normalizeList(value)
    else out.对象 = normalizeList(value)
  }
  return out
}

function adaptIndexFields(dimension, fm) {
  const base = {
    名称: String(fm.名称),
    一句话: fm.一句话 ? String(fm.一句话) : '',
  }

  if (dimension === '节拍') {
    return {
      ...base,
      编号: fm.编号 ? String(fm.编号) : '',
      关键词: normalizeList(fm.关键词),
    }
  }
  if (dimension === '场景' || dimension === '追读') {
    return { ...base, 关键词: normalizeList(fm.关键词) }
  }
  if (dimension === '设定') {
    return { ...base, 对象类型: fm.对象类型 ? String(fm.对象类型) : '' }
  }
  if (dimension === '人物') {
    return {
      ...base,
      人物类别: fm.人物类别 ? String(fm.人物类别) : '',
      关系类别: fm.关系类别 ? String(fm.关系类别) : '',
    }
  }
  if (dimension === '命名') {
    return { ...base, 命名对象: normalizeList(fm.命名对象) }
  }
  if (dimension === '技法') {
    return {
      ...base,
      类别: fm.类别 ? String(fm.类别) : '',
      作用层级: fm.作用层级 ? String(fm.作用层级) : '',
      触发问题: normalizeList(fm.触发问题),
    }
  }
  return base
}

function normalizeReferencePath(relPath) {
  const raw = String(relPath || '').trim()
  if (!raw || raw.includes('\\') || path.posix.isAbsolute(raw)) return ''
  const parts = raw.split('/')
  if (parts.length !== 2 || parts.some((part) => !part || part === '.' || part === '..')) return ''
  if (!getDimensionDefinition(parts[0]) || !parts[1].endsWith('.md')) return ''
  return parts.join('/')
}

function versionedPath(relPath, content) {
  return relPath + '@sha256:' + sha256(content)
}

function compareCodePoints(a, b) {
  const left = String(a)
  const right = String(b)
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeList(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || '').split(/[、,，]/)
  const out = []
  const seen = new Set()
  for (const item of values) {
    const text = String(item || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

function normalizeFilters(filters, allowedFields) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return {}
  const out = {}
  for (const field of allowedFields) {
    if (field === '名称' || field === '编号' || field === '一句话' || field === '关键词') continue
    const values = normalizeList(filters[field])
    if (values.length) out[field] = values
  }
  return out
}

function matchesFilters(entry, filters) {
  for (const [field, wanted] of Object.entries(filters)) {
    const actual = normalizeList(entry[field])
    if (!wanted.some((value) => actual.includes(value))) return false
  }
  return true
}

function queryScore(entry, query, allowedFields) {
  let score = 0
  const exact = [entry.名称, entry.编号].filter(Boolean)
  if (exact.includes(query)) score += 100
  for (const value of exact) {
    if (query.includes(value)) score += 30
  }

  const terms = []
  for (const field of allowedFields) {
    if (field === '名称' || field === '编号') continue
    terms.push(...normalizeList(entry[field]))
  }
  for (const term of terms) {
    if (term && query.includes(term)) score += Math.min(20, 5 + term.length)
  }
  return score
}

function normalizeRecentUses(history, dimension, name) {
  if (!Array.isArray(history)) return []
  return history
    .filter(
      (item) =>
        item &&
        (!item.维度 || item.维度 === dimension) &&
        String(item.名称 || '').trim() === name
    )
    .map((item) => ({
      ...(Number.isInteger(item.章号) ? { 章号: item.章号 } : {}),
      ...(item.变体 ? { 变体: String(item.变体) } : {}),
    }))
}
