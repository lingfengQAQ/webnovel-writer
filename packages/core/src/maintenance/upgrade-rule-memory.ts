import { parseLegacyMemoryIndexLinks as parseMemoryIndexLinks } from '../repo/legacy-memory-index-links'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { stringify as yamlStringify } from 'yaml'
import { parseDocument } from '../repo/frontmatter'
import { classifyBookMemoryDocument } from '../repo/book-memory-contract'
import { MEMORY_KINDS, paths, validateSegment } from '../repo/paths'
import { memoryIndexLink, memoryIndexText, parseMemoryIndexLinks as parseCurrentMemoryIndexLinks } from '../repo/memory-index-links'
import type { UpgradeChange } from './upgrade-types'
import { UpgradeRuleError, applyRawEdits, indexDestinationStart, rawLines, documentBodyOffset, proseBoundary, rangeEvidence, rawSections, uniqueFields } from './upgrade-rule-text'

const OLD_MEMORY_HEADER = ['类', '状态', '来源', '裁决记录'] as const
const OPTIONAL_HEADER = ['名称', '描述', '版本', '父版本', '生成模块'] as const
// Mirrors the existing query identity; no semantic deduplication is allowed.
const queryIdentity = (name: string): string => name.trim().replace(/[\s「」『』【】（）()：:，,。！？!?]/g, '').toLowerCase()
const filenameIdentity = (relative: string): string => relative.toLowerCase()

export function planMemorySplits(files: ReadonlyMap<string, string>): readonly UpgradeChange[] {
  const candidates: { relative: string; text: string; kind: (typeof MEMORY_KINDS)[number] }[] = []
  const identities = new Set<string>(), names = new Set([...files.keys()].map(filenameIdentity))
  for (const [relative, text] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!/^本书记忆\/[^/]+\.md$/.test(relative) || relative === paths.本书记忆索引()) continue
    const parsed = parseDocument(text)
    if (!parsed.ok) throw new UpgradeRuleError(relative, parsed.detail)
    const shape = classifyBookMemoryDocument(parsed.data.fields, path.posix.basename(relative, '.md'))
    if (!shape.ok) throw new UpgradeRuleError(relative, shape.reason)
    if (shape.format === 'legacy') {
      if (parsed.data.body.trim() && parsed.data.body.trim() !== `# ${shape.memoryKind}`) candidates.push({ relative, text, kind: shape.memoryKind })
      continue
    }
    const name = typeof parsed.data.fields['名称'] === 'string' ? parsed.data.fields['名称'] : path.posix.basename(relative, '.md')
    const identity = `${shape.memoryKind}:${queryIdentity(name)}`
    if (identities.has(identity)) throw new UpgradeRuleError(relative, '现存记忆的查询身份冲突，不能在迁移时合并或选择历史')
    identities.add(identity)
  }
  if (!candidates.length) return []
  const indexPath = paths.本书记忆索引(), index = files.get(indexPath)
  if (index === undefined) throw new UpgradeRuleError(indexPath, '旧记忆索引缺失，不能在迁移中猜测原目录内容')
  const links = parseMemoryIndexLinks(index)
  if (links.problems.length || new Set(links.filenames).size !== links.filenames.length) throw new UpgradeRuleError(indexPath, '旧记忆索引损坏或重复，不能重建以掩盖原内容')
  const changes: UpgradeChange[] = [], newIndexRows: string[] = [], indexEvidence: string[] = []
  for (const { relative, text, kind } of candidates.sort((a, b) => a.relative < b.relative ? -1 : 1)) {
    if (documentBodyOffset(relative, text) !== 0) throw new UpgradeRuleError(relative, '旧分类有文件级元数据，尚无完整映射规则')
    const sections = rawSections(relative, text)
    if (!sections.length || text.slice(0, sections[0]!.heading.start).trim() !== `# ${kind}`) throw new UpgradeRuleError(relative, '旧分类前言或标题无法唯一归属，保留原文')
    const evidence: string[] = []
    for (const section of sections) {
      const cut = proseBoundary(relative, section)
      const fields = uniqueFields(relative, section.lines.slice(0, cut), [...OLD_MEMORY_HEADER, ...OPTIONAL_HEADER])
      if (fields.length < OLD_MEMORY_HEADER.length || fields.slice(0, OLD_MEMORY_HEADER.length).some((field, index) => field.name !== OLD_MEMORY_HEADER[index] || !field.value)) {
        throw new UpgradeRuleError(relative, '旧记忆缺少完整类、状态、来源与裁决生产头；不补造缺省字段', section.heading.number)
      }
      const old: Record<string, string> = Object.fromEntries(fields.map(field => [field.name, field.value]))
      const name = section.title, target = paths.本书记忆条目(name), identity = `${kind}:${queryIdentity(name)}`
      if (old['类'] !== kind || (old['名称'] !== undefined && old['名称'] !== name)) throw new UpgradeRuleError(relative, '旧记忆标题、名称或类与分类路径冲突', section.heading.number)
      if (validateSegment(name).length || validateSegment(`${name}.md`).length || name === '索引' || !queryIdentity(name)) throw new UpgradeRuleError(relative, '旧记忆名称不能作为唯一当前条目路径', section.heading.number)
      if (names.has(filenameIdentity(target)) || identities.has(identity)) throw new UpgradeRuleError(relative, `记忆名称、历史或目标路径冲突：${name}；不覆盖、改名或去重`, section.heading.number)
      if (links.filenames.some(filename => filenameIdentity(filename) === filenameIdentity(`${name}.md`))) throw new UpgradeRuleError(indexPath, `索引已有拟新增目标 ${name}.md，不能把悬空链接当新增授权`)
      const body = text.slice(section.lines[cut]!.end, section.end)
      if (!body.trim()) throw new UpgradeRuleError(relative, '旧记忆正文为空，不能生成空的新条目', section.heading.number)
      const metadata: Record<string, unknown> = { 名称: name, ...old }
      for (const key of ['版本', '父版本']) {
        if (old[key] === undefined) continue
        if (key === '父版本' && old[key] === 'null') { metadata[key] = null; continue }
        const value = Number(old[key])
        if (!/^[1-9]\d*$/.test(old[key]!) || !Number.isSafeInteger(value)) throw new UpgradeRuleError(relative, `旧记忆${key}无法无歧义映射为内容版本`, section.heading.number, key)
        metadata[key] = value
      }
      if (fields.some(field => !field.value)) throw new UpgradeRuleError(relative, '旧记忆存在无法映射的空字段', section.heading.number)
      const newline = section.heading.raw.endsWith('\r\n') ? '\r\n' : '\n'
      const header = yamlStringify(metadata).trimEnd().replace(/\n/g, newline)
      const after = `---${newline}${header}${newline}---${newline}${body}`
      const parsed = parseDocument(after)
      if (!parsed.ok || !isDeepStrictEqual(parsed.data.fields, metadata)) throw new UpgradeRuleError(relative, '新记忆字段无法逐项往返保全', section.heading.number)
      names.add(filenameIdentity(target)); identities.add(identity)
      const mapping = `${relative} 第 ${section.heading.number} 行，${rangeEvidence(text, section.heading.start, section.end)} → ${target}；正文原字节保全`
      evidence.push(mapping)
      changes.push({ relPath: target, before: null, after, rules: ['C5-v1'], evidence: [mapping] })
      newIndexRows.push(`- ${memoryIndexLink(name, `${name}.md`)} — ${[old['描述'], `类：${kind}`, `来源：${old['来源']}`].filter((value): value is string => value !== undefined).map(memoryIndexText).join('｜')}`)
      indexEvidence.push(`${relative} 的 ${name} 保留原来源 ${old['来源']}，追加独立条目定位`)
    }
    // The original category title/whitespace remains, exactly as a legal empty scaffold.
    changes.push({ relPath: relative, before: text, after: text.slice(0, sections[0]!.heading.start), rules: ['C5-v1'], evidence })
  }
  // Remove only obsolete link syntax. Author labels, descriptions and surrounding bytes survive.
  const emptied = new Set(candidates.map(candidate => path.posix.basename(candidate.relative)))
  const edits: { start: number; end: number; value: string }[] = []
  let fence: { mark: string; length: number } | undefined
  for (const line of rawLines(index)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.text)
    if (fence) {
      if (marker && marker[1]![0] === fence.mark && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = undefined
      continue
    }
    if (marker) { fence = { mark: marker[1]![0]!, length: marker[1]!.length }; continue }
    const parsed = parseMemoryIndexLinks(line.text)
    if (parsed.filenames.length !== 1 || !emptied.has(parsed.filenames[0]!)) continue
    const start = indexDestinationStart(line.text)
    if (start === undefined) throw new UpgradeRuleError(indexPath, '旧分类索引边界无法核实', line.number)
    const destination = line.text.slice(start)
    const end = destination.indexOf(destination.startsWith('<') ? '>)' : ')')
    if (end < 0) throw new UpgradeRuleError(indexPath, '旧分类索引目标边界无法核实', line.number)
    edits.push({ start: line.start + start - 2, end: line.start + start + end + (destination.startsWith('<') ? 2 : 1), value: '' })
    // A nested label must remain plain text after the outer link brackets disappear.
    edits.push({ start: line.start + 2, end: line.start + 3, value: line.text[3] === '[' ? '\\' : '' })
    indexEvidence.push(`原第 ${line.number} 行移除已清空分类的链接，标签可见文字保留（开头方括号转义），说明与换行原字节保留；${rangeEvidence(index, line.start, line.end)}`)
  }
  const retained = applyRawEdits(index, edits)
  const newline = index.includes('\r\n') ? '\r\n' : '\n'
  const afterIndex = retained + (retained.endsWith('\n') ? '' : newline) + newIndexRows.join(newline) + newline
  if (parseCurrentMemoryIndexLinks(afterIndex).problems.length) throw new UpgradeRuleError(indexPath, '索引更新后无法解析，保留原文')
  changes.push({ relPath: indexPath, before: index, after: afterIndex, rules: ['C5-v1'], evidence: indexEvidence })
  return changes
}
