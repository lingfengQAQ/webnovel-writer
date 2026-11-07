import { parseLegacyMemoryIndexLinks as parseMemoryIndexLinks } from '../repo/legacy-memory-index-links'
import path from 'node:path'
import { ledgerContentShape } from '../ledger/clue'
import { isDeepStrictEqual } from 'node:util'
import { isScalar, parseDocument as parseYaml } from 'yaml'
import { parseDocument } from '../repo/frontmatter'
import { CLUE_FIELDS, CLUE_STATES } from '../repo/ledger-field-contract'
import { WORLDBOOK_STATES } from '../repo/document-fields'
import { memoryIndexLink } from '../repo/memory-index-links'
import { parseWorldbookHistory } from '../design/worldbook-history'
import type { UpgradeChange, UpgradeRulesResult } from './upgrade-types'
import type { MaintenanceIssue } from './types'
import { planMemorySplits } from './upgrade-rule-memory'
import { planDraftIdentity, isUpgradeDraft } from './upgrade-rule-draft'
import {
  UpgradeRuleError, applyRawEdits, documentBodyOffset, proseBoundary, rangeEvidence,
  rawField, rawLines, rawSections, uniqueFields, indexDestinationStart, type RawField,
} from './upgrade-rule-text'

// Frozen historical producer headers, independent of evolving current schemas.
const OLD_CLUE_HEADER = ['名称', '类型', '状态', '计划来源', '实际落点', '来源', '裁决记录'] as const
const OLD_TIMELINE_HEADER = ['章号', '来源', '裁决记录'] as const
const TIMELINE_CONTENT = ['事件', '时点'] as const
const singleLine = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '' && !/[\r\n]/.test(value)
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

function relocateFields(relative: string, text: string, kind: '线索' | '时间线'): UpgradeChange | undefined {
  const sections = rawSections(relative, text)
  const edits: { start: number; end: number; value: string }[] = []
  const evidence: string[] = []
  const oldHeader = kind === '线索' ? OLD_CLUE_HEADER : OLD_TIMELINE_HEADER
  const targets = kind === '线索' ? CLUE_FIELDS : TIMELINE_CONTENT
  for (const section of sections) {
    const cut = proseBoundary(relative, section)
    const before = section.lines.slice(0, cut)
    const headerFields = before.flatMap(line => { const field = rawField(line); return field ? [field] : [] })
    const duplicate = headerFields.find((field, index) => headerFields.findIndex(other => other.name === field.name) !== index)
    if (duplicate) throw new UpgradeRuleError(relative, `字段重复：${duplicate.name}；不能通过去重选择原值`, duplicate.line.number, duplicate.name)
    const existingTargets = before.flatMap(line => { const field = rawField(line); return field && (targets as readonly string[]).includes(field.name) ? [field] : [] })
    const layout = ledgerContentShape(kind, Object.fromEntries(before.flatMap(line => { const field = rawField(line); return field ? [[field.name, field.value]] : [] })), section.lines.slice(cut + 1).map(line => line.text).join('\n'))
    if (layout?.format === 'invalid') throw new UpgradeRuleError(relative, layout.reason, section.heading.number)
    // A current field never authorizes interpreting a same-named prose line.
    if (existingTargets.length) continue
    const fields = uniqueFields(relative, before, oldHeader)
    if (fields.length !== oldHeader.length || fields.some((field, index) => field.name !== oldHeader[index] || !field.value)) {
      throw new UpgradeRuleError(relative, '旧生产头不完整或顺序不同，无法证明字段搬位规则', section.heading.number)
    }
    const values = Object.fromEntries(fields.map(field => [field.name, field.value]))
    if (kind === '线索' && (values['名称'] !== section.title || values['类型'] !== '线索' || !(CLUE_STATES as readonly string[]).includes(values['状态']!))) {
      throw new UpgradeRuleError(relative, '旧线索名称、类型或状态与条目身份不符', section.heading.number)
    }
    const lead: RawField[] = []
    for (const line of section.lines.slice(cut + 1)) {
      if (!line.text.trim()) continue
      const field = rawField(line)
      if (!field || !(targets as readonly string[]).includes(field.name)) break
      if (lead.some(item => item.name === field.name)) throw new UpgradeRuleError(relative, `旧正文前缀字段重复：${field.name}`, line.number, field.name)
      lead.push(field)
    }
    const required = kind === '线索' ? ['埋设点', '预期兑现区间', ...(values['状态'] === '已弃' ? ['弃因'] : [])] : ['事件']
    if (required.some(name => !lead.some(field => field.name === name && field.value))) {
      throw new UpgradeRuleError(relative, `旧${kind}缺少有唯一来源的前置${required.join('、')}字段`, section.heading.number)
    }
    if (kind === '线索' && lead.some(field => !field.value)) throw new UpgradeRuleError(relative, '旧线索字段为空，不能猜补', section.heading.number)
    const boundary = section.lines[cut]!
    const newline = boundary.raw.endsWith('\r\n') ? '\r\n' : '\n'
    const moved: string[] = []
    for (const field of lead) {
      let raw = field.line.raw
      if (kind === '时间线' && field.name === '时点' && !field.value) raw = field.line.text + '未知' + field.line.raw.slice(field.line.text.length)
      moved.push(raw.endsWith('\n') ? raw : raw + newline)
      edits.push({ start: field.line.start, end: field.line.end, value: '' })
      evidence.push(`${section.title}：${field.name}，原第 ${field.line.number} 行，${rangeEvidence(text, field.line.start, field.line.end)}`)
    }
    if (kind === '时间线' && !lead.some(field => field.name === '时点')) moved.push(`时点：未知${newline}`)
    if (kind === '时间线' && !lead.some(field => field.name === '时点' && field.value)) evidence.push(`${section.title}：原时点缺省或为空，按规则明确写为“未知”，不推算日期`)
    edits.push({ start: boundary.start, end: boundary.start, value: moved.join('') })
  }
  if (edits.length) {
    let fence: { mark: string; length: number } | undefined
    for (const line of rawLines(text).filter(item => item.start >= documentBodyOffset(relative, text))) {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.text)
      if (fence) {
        if (/^[ \t]*##[ \t]+/.test(line.text)) throw new UpgradeRuleError(relative, '围栏中的二级标题超出当前账本消费者的边界能力，保留原文', line.number)
        if (marker && marker[1]![0] === fence.mark && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = undefined
      } else if (marker) fence = { mark: marker[1]![0]!, length: marker[1]!.length }
    }
  }
  return edits.length ? { relPath: relative, before: text, after: applyRawEdits(text, edits), rules: [kind === '线索' ? 'C1-v1' : 'C2-v1'], evidence } : undefined
}

function repairMemoryLinks(files: ReadonlyMap<string, string>): UpgradeChange | undefined {
  const relative = '本书记忆/索引.md', text = files.get(relative)
  if (text === undefined) return undefined
  const edits: { start: number; end: number; value: string }[] = [], evidence: string[] = []
  let fence: { mark: string; length: number } | undefined
  for (const line of rawLines(text)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.text)
    if (fence) {
      if (line.text.startsWith('- [')) throw new UpgradeRuleError(relative, '围栏中的链接行不能作为记忆索引目标修复', line.number)
      if (marker && marker[1]![0] === fence.mark && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = undefined
      continue
    }
    if (marker) { fence = { mark: marker[1]![0]!, length: marker[1]!.length }; continue }
    if (!line.text.startsWith('- [') || (indexDestinationStart(line.text) === undefined && /^- \[\[[^\]\r\n]+\]\](?!\()/.test(line.text))) continue
    const result = parseMemoryIndexLinks(line.text)
    if (result.problems.length || result.filenames.length !== 1) throw new UpgradeRuleError(relative, '索引链接边界无效或不唯一，不能根据现存文件猜测', line.number)
    const filename = result.filenames[0]!, start = indexDestinationStart(line.text)
    if (start === undefined) throw new UpgradeRuleError(relative, '索引标签边界无法核实', line.number)
    if (line.text[start] === '<' || !/[\s()[\]#%&`]/.test(filename)) continue
    if (!files.has(`本书记忆/${filename}`)) throw new UpgradeRuleError(relative, `旧索引字面目标不存在：${filename}；不解码或选择其他文件`, line.number)
    if (line.text.slice(start, start + filename.length + 1) !== filename + ')' || !/^[ \t]*(?:$|—(?:[ \t]|$))/.test(line.text.slice(start + filename.length + 1))) {
      throw new UpgradeRuleError(relative, '旧索引目标与说明的原文边界无法证明', line.number)
    }
    const destination = memoryIndexLink('', filename).slice(3, -1)
    edits.push({ start: line.start + start, end: line.start + start + filename.length, value: destination })
    evidence.push(`原第 ${line.number} 行的字面目标 ${filename}，仅修改链接目标表示；标签和说明原样保留`)
  }
  if (fence) throw new UpgradeRuleError(relative, '索引围栏未闭合，无法证明链接显示边界')
  return edits.length ? { relPath: relative, before: text, after: applyRawEdits(text, edits), rules: ['C3-v1'], evidence } : undefined
}

function repairWorldbookNature(relative: string, text: string): UpgradeChange | undefined {
  const parsed = parseDocument(text)
  if (!parsed.ok) throw new UpgradeRuleError(relative, parsed.detail)
  const fields = parsed.data.fields
  if (fields['生成模块'] !== '吃书补偿' || fields['性质'] === '事实') return undefined
  const history = parseWorldbookHistory(text)
  if (fields['性质'] !== '计划' || !singleLine(fields['类型']) || !singleLine(fields['来源']) || !(WORLDBOOK_STATES as readonly unknown[]).includes(fields['状态'])
    || !positive(fields['版本']) || (fields['父版本'] !== undefined && fields['父版本'] !== null && !positive(fields['父版本']))
    || (fields['名称'] !== undefined && fields['名称'] !== path.posix.basename(relative, '.md')) || !history.ok || history.data.未闭合围栏 || !history.data.首段.trim()) {
    throw new UpgradeRuleError(relative, '旧更正的身份、版本、来源或正文边界无法完整核实，保留原文')
  }
  const lines = rawLines(text), bodyAt = documentBodyOffset(relative, text)
  const opening = lines[0]!, closing = lines.find(line => line.end === bodyAt)
  if (!closing || closing === opening) throw new UpgradeRuleError(relative, '缺少明确的世界书文件头')
  const yamlText = text.slice(opening.end, closing.start), yaml = parseYaml(yamlText)
  const nature = yaml.get('性质', true)
  if (yaml.errors.length || !isScalar(nature) || !nature.range || nature.value !== '计划') throw new UpgradeRuleError(relative, '性质字段不是唯一可定位的文本标量')
  const [start, end] = nature.range
  const original = yamlText.slice(start, end)
  const replacement = original === '计划' ? '事实' : original === '"计划"' ? '"事实"' : original === "'计划'" ? "'事实'" : undefined
  if (replacement === undefined) throw new UpgradeRuleError(relative, '性质使用了未支持的 YAML 表示，不能重写整个文件头')
  const after = applyRawEdits(text, [{ start: opening.end + start, end: opening.end + end, value: replacement }])
  const target = parseDocument(after)
  if (!target.ok || !isDeepStrictEqual(target.data.fields, { ...fields, 性质: '事实' }) || after.slice(bodyAt) !== text.slice(bodyAt)) throw new UpgradeRuleError(relative, '性质修复未能证明其他字段与正文完整保全')
  return { relPath: relative, before: text, after, rules: ['C4-v1'], evidence: ['原生成模块明确为吃书补偿，性质仍为计划；只将性质标量改为事实，来源、内容版本及正文原字节不变'] }
}

/** Pure rule preparation; the caller must still verify the entire target book and authorize execution. */
export function planUpgradeRules(files: ReadonlyMap<string, string>): UpgradeRulesResult {
  const changes = new Map<string, UpgradeChange>(), issues: MaintenanceIssue[] = []
  const attempt = (relative: string, operation: () => UpgradeChange | readonly UpgradeChange[] | undefined) => {
    try {
      const result = operation()
      for (const change of result === undefined ? [] : Array.isArray(result) ? result : [result as UpgradeChange]) {
        const prior = changes.get(change.relPath)
        changes.set(change.relPath, prior === undefined ? change : { ...change, before: prior.before, rules: [...prior.rules, ...change.rules], evidence: [...prior.evidence, ...change.evidence] })
      }
    } catch (error) {
      if (!(error instanceof UpgradeRuleError)) throw error
      issues.push({ 代码: 'UPGRADE_RULE_UNSUPPORTED', 路径: error.relative || relative, 说明: error.message,
        ...(error.line === undefined ? {} : { 行: error.line }), ...(error.field === undefined ? {} : { 字段: error.field }) })
    }
  }
  for (const kind of ['线索', '时间线'] as const) {
    const relative = `账本/${kind}.md`, text = files.get(relative)
    if (text !== undefined) attempt(relative, () => relocateFields(relative, text, kind))
  }
  for (const [relative, text] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (/^世界书\/[^/]+\/[^/]+\.md$/.test(relative)) attempt(relative, () => repairWorldbookNature(relative, text))
    if (isUpgradeDraft(relative)) attempt(relative, () => planDraftIdentity(relative, text, files))
  }
  attempt('本书记忆/索引.md', () => repairMemoryLinks(files))
  const overlay = new Map(files)
  for (const change of changes.values()) overlay.set(change.relPath, change.after)
  attempt('本书记忆', () => planMemorySplits(overlay))
  return { changes: [...changes.values()].sort((a, b) => a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0), issues }
}
