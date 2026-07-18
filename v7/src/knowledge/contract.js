import { parseFrontMatter } from '../storage/parsers/front-matter.js'

export const WORK_CONTRACT_PATH = '作品契约/作品契约.md'
export const KNOWLEDGE_SELECTION_PATH = '作品契约/知识选择记录.md'

export const CONTRACT_SECTIONS = Object.freeze([
  '核心读者承诺',
  '骨架约定',
  '题材融合协议',
  '创意约束落地',
  '差异化点',
  '冲突与关系结算原则',
  '本书专属毒点',
  '节奏与兑现参数',
])

export const CONTRACT_WRITING_SECTIONS = Object.freeze([
  '核心读者承诺',
  '创意约束落地',
  '冲突与关系结算原则',
  '本书专属毒点',
  '节奏与兑现参数',
])

export const CONTRACT_REVIEW_SECTIONS = Object.freeze([
  '核心读者承诺',
  '题材融合协议',
  '创意约束落地',
  '冲突与关系结算原则',
  '本书专属毒点',
])

const CONTRACT_LIST_FIELDS = ['副题材', '流派', '创意约束', '来源版本']
const SETTLEMENT_ITEMS = ['主角底线', '伤害后果', '和解条件', '救赎条件', '允许余地']
const BOOK_DIMENSIONS = new Set(['题材', '流派', '创意约束'])
const CUSTOM_SOURCES = new Set(['对谈共创', '作者自定义'])
const SOURCE_RE = /^(题材|流派|创意约束)\/[^/@]+\.md@sha256:[0-9a-f]{64}$/

export function validateCreateBookPayload(payload) {
  const errors = []
  const book = payload?.book
  if (!book || typeof book !== 'object' || Array.isArray(book)) {
    return { ok: false, errors: ['JSON 需含对象字段「book」'] }
  }
  if (!stringValue(book.书名)) errors.push('book 至少要有非空「书名」')
  if (!stringValue(book.类型)) errors.push('book 需含归一后的「类型」')
  validateStringList(book.副题材, 'book.副题材', errors, { optional: true })
  validateStringList(book.流派, 'book.流派', errors, { optional: true })
  if (!stringValue(payload.总纲)) errors.push('JSON 需含非空字符串字段「总纲」')
  if (!stringValue(payload.卷纲)) errors.push('JSON 需含非空字符串字段「卷纲」')
  if (payload.作者已确认 !== true) errors.push('作品契约尚未得到作者确认，不能完成建书')

  const selections = validateKnowledgeSelections(payload.知识选择)
  errors.push(...selections.errors)
  const decisions = validateActualDecisions(payload.实际裁决)
  errors.push(...decisions.errors)

  if (typeof payload.作品契约 !== 'string' || !payload.作品契约.trim()) {
    errors.push('JSON 需含非空字符串字段「作品契约」')
    return { ok: false, errors, selections: selections.data, decisions: decisions.data }
  }

  const contract = validateWorkContract(payload.作品契约, {
    book,
    selections: selections.data,
    mode: 'create',
  })
  errors.push(...contract.errors)
  return {
    ok: errors.length === 0,
    errors,
    contract: contract.data,
    selections: selections.data,
    decisions: decisions.data,
  }
}

export function validateContractUpdatePayload(payload, { previous, nextChapter }) {
  const errors = []
  if (payload?.作者已确认 !== true) errors.push('作品契约修订尚未得到作者确认，不能落盘')
  const selections = validateKnowledgeSelections(payload?.知识选择)
  errors.push(...selections.errors)
  const decisions = validateActualDecisions(payload?.实际裁决)
  errors.push(...decisions.errors)
  if (typeof payload?.作品契约 !== 'string' || !payload.作品契约.trim()) {
    errors.push('JSON 需含非空字符串字段「作品契约」')
    return { ok: false, errors, selections: selections.data, decisions: decisions.data }
  }

  const contract = validateWorkContract(payload.作品契约, {
    selections: selections.data,
    mode: 'update',
    previous,
    nextChapter,
  })
  errors.push(...contract.errors)
  if (contract.data && previous && coreClassificationChanged(previous, contract.data)) {
    if (payload.影响分析已确认 !== true) {
      errors.push('本次修订改变核心分类或创意约束，须先确认影响分析')
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    contract: contract.data,
    selections: selections.data,
    decisions: decisions.data,
  }
}

export function validateWorkContract(
  content,
  { book = null, selections = null, mode = 'read', previous = null, nextChapter = null } = {}
) {
  const errors = []
  const parsed = parseFrontMatter(content)
  if (!parsed.ok) return { ok: false, errors: [parsed.error], data: null }
  const fm = parsed.data
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) {
    return { ok: false, errors: ['作品契约 front matter 必须是平铺对象'], data: null }
  }
  for (const [key, value] of Object.entries(fm)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      errors.push('作品契约 front matter 字段「' + key + '」不能是嵌套对象')
    }
  }

  if (!stringValue(fm.类型)) errors.push('作品契约 front matter 缺非空「类型」')
  for (const field of CONTRACT_LIST_FIELDS) {
    validateStringList(fm[field], '作品契约.' + field, errors, {
      allowNullAsEmpty: field !== '来源版本',
    })
  }
  if (!Number.isInteger(fm.契约版本) || fm.契约版本 < 1) {
    errors.push('作品契约「契约版本」必须是正整数')
  }
  if (!Number.isInteger(fm.生效起章) || fm.生效起章 < 1) {
    errors.push('作品契约「生效起章」必须是正整数')
  }
  if (!stringValue(fm.更新原因)) errors.push('作品契约缺非空「更新原因」')
  if (!stringValue(fm.变更类型)) errors.push('作品契约缺非空「变更类型」')

  const sections = splitLevelTwoSections(parsed.body)
  for (const section of CONTRACT_SECTIONS) {
    if (!stringValue(sections.get(section))) errors.push('作品契约缺「## ' + section + '」')
  }
  const differences = sections.get('差异化点') || ''
  if (countListItems(differences) < 3) errors.push('作品契约「差异化点」至少需要 3 条')
  const settlement = sections.get('冲突与关系结算原则') || ''
  for (const item of SETTLEMENT_ITEMS) {
    if (!settlement.includes(item)) errors.push('冲突与关系结算原则缺「' + item + '」')
  }

  if (mode === 'create') {
    if (fm.契约版本 !== 1) errors.push('建书时「契约版本」必须为 1')
    if (fm.生效起章 !== 1) errors.push('建书时「生效起章」必须为 1')
    if (fm.变更类型 !== '建书') errors.push('建书时「变更类型」必须为「建书」')
  }
  if (mode === 'update' && previous) {
    const previousVersion = previous.frontMatter?.契约版本
    if (!Number.isInteger(previousVersion) || fm.契约版本 !== previousVersion + 1) {
      errors.push('新契约版本必须从 ' + (previousVersion ?? '当前版本') + ' 严格递增 1')
    }
    if (Number.isInteger(nextChapter) && fm.生效起章 < nextChapter) {
      errors.push('新契约默认只能从未定稿的第 ' + nextChapter + ' 章或之后生效')
    }
  }

  if (book) compareBookFields(book, fm, errors)
  if (Array.isArray(selections)) compareSelections(selections, fm, errors)

  return {
    ok: errors.length === 0,
    errors,
    data: {
      frontMatter: fm,
      body: parsed.body,
      sections,
      content,
    },
  }
}

export function validateKnowledgeSelections(value) {
  const errors = []
  if (!Array.isArray(value) || !value.length) {
    return { ok: false, errors: ['「知识选择」必须是非空数组，至少记录主题材来源'], data: [] }
  }
  const data = []
  const seen = new Set()
  for (let i = 0; i < value.length; i++) {
    const item = value[i]
    const where = '知识选择[' + i + ']'
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(where + ' 必须是对象')
      continue
    }
    const dimension = stringValue(item.维度)
    const name = stringValue(item.名称)
    const source = stringValue(item.来源)
    if (!BOOK_DIMENSIONS.has(dimension)) errors.push(where + '.维度 只能是题材、流派或创意约束')
    if (!name) errors.push(where + ' 缺非空「名称」')
    if (!source || (!CUSTOM_SOURCES.has(source) && !SOURCE_RE.test(source))) {
      errors.push(where + '.来源 需为正式条目路径@sha256、对谈共创或作者自定义')
    }
    const key = dimension + '\0' + name
    if (dimension && name && seen.has(key)) errors.push(where + ' 与前项重复：' + dimension + '/' + name)
    seen.add(key)
    const variant = item.本书变体 == null ? '' : stringValue(item.本书变体)
    if (item.本书变体 != null && !variant) errors.push(where + '.本书变体 必须是非空字符串')
    data.push({
      维度: dimension,
      名称: name,
      来源: source,
      ...(variant ? { 本书变体: variant } : {}),
    })
  }
  return { ok: errors.length === 0, errors, data }
}

export function validateActualDecisions(value) {
  if (value == null) return { ok: true, errors: [], data: [] }
  const errors = []
  if (!Array.isArray(value)) return { ok: false, errors: ['「实际裁决」需为数组'], data: [] }
  const data = []
  for (let i = 0; i < value.length; i++) {
    const item = value[i]
    const where = '实际裁决[' + i + ']'
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(where + ' 必须是对象')
      continue
    }
    const object = stringValue(item.对象)
    const result = stringValue(item.结果)
    const reason = stringValue(item.原因)
    if (!object) errors.push(where + ' 缺非空「对象」')
    if (!['拒绝', '修改'].includes(result)) errors.push(where + '.结果 只能是拒绝或修改')
    if (!reason) errors.push(where + ' 缺非空「原因」')
    data.push({
      对象: object,
      结果: result,
      原因: reason,
      ...(stringValue(item.证据) ? { 证据: stringValue(item.证据) } : {}),
    })
  }
  return { ok: errors.length === 0, errors, data }
}

export function renderKnowledgeSelectionRecord({ contract, selections, decisions = [] }) {
  const fm = contract.frontMatter
  const lines = [
    '## 契约版本 ' + fm.契约版本 + '（第 ' + fm.生效起章 + ' 章起）',
    '',
    '- 更新原因：' + singleLine(fm.更新原因),
    '- 变更类型：' + singleLine(fm.变更类型),
    '',
    '### 最终采用与来源',
    '',
  ]
  for (const item of selections) {
    lines.push('- ' + item.维度 + '：' + singleLine(item.名称))
    lines.push('  - 来源：' + singleLine(item.来源))
    if (item.本书变体) lines.push('  - 本书变体：' + singleLine(item.本书变体))
  }
  if (decisions.length) {
    lines.push('', '### 实际裁决', '')
    for (const item of decisions) {
      lines.push('- ' + singleLine(item.结果) + '「' + singleLine(item.对象) + '」：' + singleLine(item.原因))
      if (item.证据) lines.push('  - 证据：' + singleLine(item.证据))
    }
  }
  return lines.join('\n') + '\n'
}

export function createKnowledgeSelectionRecord(args) {
  return ['# 知识选择记录', '', renderKnowledgeSelectionRecord(args)].join('\n')
}

export function appendKnowledgeSelectionRecord(existing, args) {
  const base = stringValue(existing) ? existing.trimEnd() : '# 知识选择记录'
  return base + '\n\n' + renderKnowledgeSelectionRecord(args)
}

export function renderContractSections(contract, sectionNames) {
  const sections = contract?.sections
  if (!(sections instanceof Map)) return ''
  const parts = []
  for (const name of sectionNames) {
    const body = sections.get(name)
    if (stringValue(body)) parts.push('## ' + name + '\n' + body)
  }
  return parts.join('\n\n')
}

function compareBookFields(book, fm, errors) {
  if (stringValue(book.类型) !== stringValue(fm.类型)) {
    errors.push('book.类型 与作品契约.类型不一致')
  }
  compareLists('副题材', normalizeList(book.副题材), normalizeList(fm.副题材), errors)
  compareLists('流派', normalizeList(book.流派), normalizeList(fm.流派), errors)
}

function coreClassificationChanged(previous, next) {
  const left = previous.frontMatter || {}
  const right = next.frontMatter || {}
  if (stringValue(left.类型) !== stringValue(right.类型)) return true
  for (const field of ['副题材', '流派', '创意约束']) {
    const a = normalizeList(left[field]).sort()
    const b = normalizeList(right[field]).sort()
    if (a.length !== b.length || a.some((value, index) => value !== b[index])) return true
  }
  return false
}

function compareSelections(selections, fm, errors) {
  const topicNames = selections.filter((item) => item.维度 === '题材').map((item) => item.名称)
  const expectedTopics = [stringValue(fm.类型), ...normalizeList(fm.副题材)].filter(Boolean)
  compareLists('题材知识选择', topicNames, expectedTopics, errors)
  compareLists(
    '流派知识选择',
    selections.filter((item) => item.维度 === '流派').map((item) => item.名称),
    normalizeList(fm.流派),
    errors
  )
  compareLists(
    '创意约束知识选择',
    selections.filter((item) => item.维度 === '创意约束').map((item) => item.名称),
    normalizeList(fm.创意约束),
    errors
  )
  compareLists(
    '来源版本',
    selections.map((item) => item.来源),
    normalizeList(fm.来源版本),
    errors
  )
}

function compareLists(label, left, right, errors) {
  const a = [...left].sort()
  const b = [...right].sort()
  if (a.length !== b.length || a.some((value, index) => value !== b[index])) {
    errors.push(label + '不一致：一处为「' + left.join('、') + '」，另一处为「' + right.join('、') + '」')
  }
}

function splitLevelTwoSections(body) {
  const sections = new Map()
  let current = ''
  const lines = []
  const flush = () => {
    if (current) sections.set(current, lines.splice(0).join('\n').trim())
  }
  for (const line of String(body || '').split(/\r?\n/)) {
    const match = line.match(/^##\s+(.+?)\s*$/)
    if (match) {
      flush()
      current = match[1]
      continue
    }
    if (current) lines.push(line)
  }
  flush()
  return sections
}

function countListItems(section) {
  return String(section || '')
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:[-*+]|\d+[.)、])\s+\S/.test(line)).length
}

function validateStringList(value, label, errors, { optional = false, allowNullAsEmpty = false } = {}) {
  if ((value === undefined && optional) || (value == null && allowNullAsEmpty)) return
  if (!Array.isArray(value)) {
    errors.push(label + ' 必须是列表')
    return
  }
  if (value.some((item) => !stringValue(item))) errors.push(label + ' 只能包含非空字符串')
}

function normalizeList(value) {
  if (value == null) return []
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : []
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function singleLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}
