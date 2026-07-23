import path from 'node:path'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'
import { sanitizeFileName } from '../util/filename.js'

export const DESIGN_CLASSES = Object.freeze(['设定', '人物'])
export const DESIGN_ROOT = '大纲/创作设计'

export const DESIGN_OBJECT_TYPES = Object.freeze({
  设定: Object.freeze(['世界', '规则', '机制', '能力', '物品', '组织', '制度', '地点']),
  人物: Object.freeze(['角色', '关系']),
})

const OBJECT_TYPES = Object.freeze({
  设定: new Set(DESIGN_OBJECT_TYPES.设定),
  人物: new Set(DESIGN_OBJECT_TYPES.人物),
})
const REQUIRED_SECTIONS = ['本书设计', '一致性边界', '知识依据']
const CUSTOM_KNOWLEDGE_SOURCES = new Set(['作者自定义', '对谈共创'])
const SOURCE_DIMENSIONS = Object.freeze({
  设定: new Set(['设定', '命名']),
  人物: new Set(['人物', '命名']),
})
const SOURCE_LINE_PREFIX = '来源：'
const ADAPTATION_LINE_PREFIX = '本书适配：'
const SOURCE_HASH_MARKER = '@sha256:'
const REFERENCE_FILE_RE = /^[^<>:"/\\|?*\u0000-\u001f@]+\.md$/u
const SHA256_RE = /^[0-9a-f]{64}$/
const ID_RE = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)+$/u

export function validateDesignPayload(payload) {
  const errors = []
  if (payload?.作者已确认 !== true) errors.push('故事对象设计尚未得到作者确认，不能落盘')
  const rawObjects = payload?.对象 == null ? [] : payload.对象
  const rawAbandons = payload?.放弃 == null ? [] : payload.放弃
  if (!Array.isArray(rawObjects)) errors.push('「对象」必须是数组')
  if (!Array.isArray(rawAbandons)) errors.push('「放弃」必须是 ID 数组')

  const objects = []
  const seenIds = new Set()
  for (let index = 0; index < (Array.isArray(rawObjects) ? rawObjects.length : 0); index++) {
    const item = rawObjects[index]
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`对象[${index}] 必须是对象`)
      continue
    }
    const classification = stringValue(item.分类)
    if (!DESIGN_CLASSES.includes(classification)) {
      errors.push(`对象[${index}].分类 只能是设定或人物`)
      continue
    }
    if (typeof item.内容 !== 'string' || !item.内容.trim()) {
      errors.push(`对象[${index}] 缺非空「内容」`)
      continue
    }
    const parsed = validateDesignContent(item.内容, { classification })
    errors.push(...parsed.errors.map((error) => `对象[${index}]：${error}`))
    if (!parsed.data) continue
    if (seenIds.has(parsed.data.ID)) errors.push(`对象批次中重复 ID「${parsed.data.ID}」`)
    seenIds.add(parsed.data.ID)
    objects.push(parsed.data)
  }

  const abandons = []
  const seenAbandons = new Set()
  for (let index = 0; index < (Array.isArray(rawAbandons) ? rawAbandons.length : 0); index++) {
    const id = stringValue(rawAbandons[index])
    if (!validId(id)) errors.push(`放弃[${index}] 不是合法对象 ID`)
    else if (!seenAbandons.has(id)) abandons.push(id)
    seenAbandons.add(id)
  }
  for (const object of objects) {
    if (seenAbandons.has(object.ID)) errors.push(`对象「${object.ID}」不能在同一批次既保存又放弃`)
  }
  if (!objects.length && !abandons.length) errors.push('本次没有要保存或放弃的故事对象')
  return { ok: errors.length === 0, errors, objects, abandons }
}

export function validateDesignContent(content, { classification = '' } = {}) {
  const errors = []
  if (classification && !DESIGN_CLASSES.includes(classification)) {
    return { ok: false, errors: ['分类只能是设定或人物'], data: null }
  }
  const parsed = parseFrontMatter(content)
  if (!parsed.ok) return { ok: false, errors: [parsed.error], data: null }
  const fm = parsed.data
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) {
    return { ok: false, errors: ['front matter 必须是平铺对象'], data: null }
  }
  for (const [key, value] of Object.entries(fm)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      errors.push(`front matter 字段「${key}」不能是嵌套对象`)
    }
  }

  const id = stringValue(fm.ID)
  const name = stringValue(fm.名称)
  const objectType = stringValue(fm.对象类型)
  const canonicalName = stringValue(fm.正名)
  const aliases = normalizeStringList(fm.别名, '别名', errors)
  if (!validId(id)) errors.push('「ID」需为分段稳定编号，例如 CHAR-001 或 物品-001')
  if (/[a-z]/.test(id)) errors.push('「ID」中的英文字母必须大写，避免跨平台路径碰撞')
  if (!name) errors.push('缺非空「名称」')
  if (fm.对象类型 != null && !objectType) errors.push('「对象类型」必须是非空字符串')
  if (fm.正名 != null && !canonicalName) errors.push('「正名」必须是非空字符串')
  if (classification && objectType && !OBJECT_TYPES[classification].has(objectType)) {
    errors.push(
      `「${classification}」对象类型「${objectType}」不在允许范围：${[...OBJECT_TYPES[classification]].join('、')}`
    )
  }

  const sections = splitLevelTwoSections(parsed.body)
  for (const section of REQUIRED_SECTIONS) {
    if (!stringValue(sections.get(section))) errors.push(`缺「## ${section}」`)
  }
  const knowledgeBasis = stringValue(sections.get('知识依据'))
  if (knowledgeBasis) errors.push(...validateKnowledgeBasis(knowledgeBasis, classification))

  const names = uniqueStrings([name, canonicalName, ...aliases])
  if (names.length !== [name, canonicalName, ...aliases].filter(Boolean).length) {
    errors.push('名称、正名与别名不能互相重复')
  }
  const data = id && name
    ? {
        分类: classification,
        ID: id,
        名称: name,
        对象类型: objectType,
        正名: canonicalName,
        别名: aliases,
        frontMatter: fm,
        body: parsed.body,
        content,
        sections,
        path: classification ? designPathFor(classification, id, canonicalName || name) : '',
      }
    : null
  return { ok: errors.length === 0, errors, data }
}

export function buildDesignChangePlan(existing, objects, abandons, reservedNames = []) {
  const errors = []
  const existingIds = new Set()
  for (const object of existing) {
    if (existingIds.has(object.ID)) errors.push(`现有计划对象重复 ID「${object.ID}」`)
    existingIds.add(object.ID)
  }
  const byId = new Map(existing.map((object) => [object.ID, object]))
  const abandonSet = new Set(abandons)
  for (const id of abandons) {
    if (!byId.has(id)) errors.push(`找不到要放弃的计划对象「${id}」`)
  }

  const finalObjects = new Map()
  for (const object of existing) {
    if (!abandonSet.has(object.ID)) finalObjects.set(object.ID, object)
  }
  for (const object of objects) finalObjects.set(object.ID, object)

  errors.push(...validateDesignRegistry([...finalObjects.values()], reservedNames))

  const writes = []
  const deletes = []
  for (const object of objects) {
    const previous = byId.get(object.ID)
    if (!previous || previous.content !== object.content || previous.path !== object.path) {
      writes.push({ path: object.path, content: object.content, object })
    }
    if (previous && previous.path !== object.path) deletes.push(previous.path)
  }
  for (const id of abandons) {
    const previous = byId.get(id)
    if (previous) deletes.push(previous.path)
  }
  return {
    ok: errors.length === 0,
    errors,
    writes,
    deletes: uniqueStrings(deletes).filter((file) => !writes.some((write) => write.path === file)),
    savedIds: objects.map((object) => object.ID),
    abandonedIds: abandons,
  }
}

export function validateDesignRegistry(objects, reservedNames = []) {
  const errors = []
  const ids = new Map()
  const nameOwners = new Map()
  const claim = (name, owner, source) => {
    if (!name) return
    const previous = nameOwners.get(name)
    if (previous && previous.owner !== owner) {
      errors.push(`名称「${name}」同时属于${previous.source}与${source}`)
      return
    }
    nameOwners.set(name, { owner, source })
  }
  for (const object of objects) {
    const previousPath = ids.get(object.ID)
    if (previousPath && previousPath !== object.path) {
      errors.push(`计划对象 ID「${object.ID}」同时出现在 ${previousPath} 与 ${object.path}`)
    }
    ids.set(object.ID, object.path)
    claim(object.名称, object.ID, `计划对象「${object.ID}」`)
    claim(object.正名, object.ID, `计划对象「${object.ID}」`)
    for (const alias of object.别名) claim(alias, object.ID, `计划对象「${object.ID}」的别名`)
  }
  for (const item of reservedNames) {
    claim(item.名称, `事实:${item.归属}`, `定稿名册「${item.归属}」`)
  }
  return errors
}

export function designPathFor(classification, id, name) {
  return path.posix.join(DESIGN_ROOT, classification, `${id}-${sanitizeFileName(name)}.md`)
}

export function isDesignPath(value) {
  const rel = normalizePosixRelative(value)
  if (!rel) return false
  const parts = rel.split('/')
  return parts.length === 4 &&
    parts[0] === '大纲' &&
    parts[1] === '创作设计' &&
    DESIGN_CLASSES.includes(parts[2]) &&
    parts[3].endsWith('.md')
}

export function normalizePosixRelative(value) {
  const rel = stringValue(value)
  if (!rel || rel.includes('\\') || path.posix.isAbsolute(rel)) return ''
  const normalized = path.posix.normalize(rel)
  if (normalized !== rel || normalized.startsWith('../') || normalized.includes('/../')) return ''
  return normalized
}

function validateKnowledgeBasis(value, classification) {
  const errors = []
  let sourceCount = 0
  let adaptationCount = 0
  for (const rawLine of String(value || '').split(/\r?\n/)) {
    if (!rawLine.trim()) continue
    if (rawLine !== rawLine.trim()) {
      errors.push('「## 知识依据」的来源与本书适配必须各占完整独立行，不能有首尾空白')
      continue
    }
    if (rawLine.startsWith(SOURCE_LINE_PREFIX)) {
      sourceCount++
      const source = rawLine.slice(SOURCE_LINE_PREFIX.length)
      if (CUSTOM_KNOWLEDGE_SOURCES.has(source)) continue
      errors.push(...validateVersionedKnowledgeSource(source, classification))
      continue
    }
    if (rawLine.startsWith(ADAPTATION_LINE_PREFIX)) {
      adaptationCount++
      if (!rawLine.slice(ADAPTATION_LINE_PREFIX.length).trim()) {
        errors.push('「## 知识依据」的「本书适配」必须是非空说明')
      }
      continue
    }
    errors.push('「## 知识依据」只允许「来源：…」与「本书适配：…」独立行')
  }
  if (!sourceCount) errors.push('「## 知识依据」至少需要一行「来源：…」')
  if (adaptationCount !== 1) errors.push('「## 知识依据」必须且只能有一行非空「本书适配：…」')
  return errors
}

function validateVersionedKnowledgeSource(source, classification) {
  const parts = source.split(SOURCE_HASH_MARKER)
  if (parts.length !== 2 || !parts[0] || !SHA256_RE.test(parts[1])) {
    return ['知识来源须为安全 canonical 路径@sha256:64位小写十六进制']
  }
  const rel = normalizePosixRelative(parts[0])
  const pathParts = rel ? rel.split('/') : []
  if (!rel || rel !== parts[0] || parts[0].includes('..') ||
      pathParts.length !== 2 || !REFERENCE_FILE_RE.test(pathParts[1])) {
    return ['知识来源路径须为维度目录下的直接 canonical Markdown 文件，禁止路径逃逸']
  }
  const allowedDimensions = classification
    ? SOURCE_DIMENSIONS[classification]
    : new Set(['设定', '人物', '命名'])
  if (!allowedDimensions?.has(pathParts[0])) {
    return [`「${classification}」计划对象的知识来源只能来自${[...(allowedDimensions || [])].join('或')}`]
  }
  return []
}

function normalizeStringList(value, label, errors) {
  if (value == null) return []
  if (!Array.isArray(value)) {
    errors.push(`「${label}」必须是列表`)
    return []
  }
  const out = []
  for (const item of value) {
    const text = stringValue(item)
    if (!text) errors.push(`「${label}」只能包含非空字符串`)
    else out.push(text)
  }
  return uniqueStrings(out)
}

function splitLevelTwoSections(body) {
  const sections = new Map()
  let current = ''
  let lines = []
  const flush = () => {
    if (current) sections.set(current, lines.join('\n').trim())
    lines = []
  }
  for (const line of String(body || '').split(/\r?\n/)) {
    const match = line.match(/^##\s+(.+?)\s*$/)
    if (match) {
      flush()
      current = match[1]
    } else if (current) {
      lines.push(line)
    }
  }
  flush()
  return sections
}

function validId(value) {
  return value.length <= 80 && ID_RE.test(value)
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))]
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}
