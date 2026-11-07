import { documentHash, entryChapterNo, LEDGER_NAMES, normalizeNodeKey, parseBookFormatVersion, parseLedgerHistory, parseWorldbookHistory, renderTimelineContent, timelineStoryTime } from '@webnovel/core'
import type { TreeEntry } from './types'
import type { StoryGraph, StoryGraphEdge, StoryGraphRecord } from './graph-types'
import { createEvidenceRanges, type GraphEvidence } from './graph-evidence'

export interface GraphSource {
  bookId: string
  bookName: string
  maxChapter: number
  contract?: string
  list(path: string): readonly TreeEntry[]
  read(path: string): string
}
const chapter = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : undefined
  if (typeof value !== 'string') return undefined
  const match = /^(?:第\s*)?(\d+)(?:\s*章)?$/.exec(value.trim())
  return match && Number.isSafeInteger(Number(match[1])) && Number(match[1]) > 0 ? Number(match[1]) : undefined
}
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const terms = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(terms)
  : typeof value === 'string' ? value.split(/[、,，;]/).map(item => item.trim()).filter(Boolean) : []
const wiki = (body: string): string[] => [...body.matchAll(/\[\[([^\]\n]+)\]\]/g)].map(match => match[1]!.split('|')[0]!.trim())
const identity = (name: string) => name.trim().replace(/[\s「」『』【】（）()：:，,。！？!?]/g, '').toLowerCase()
const kindOf = (path: string, declared?: unknown) => typeof declared === 'string' && declared.trim()
  ? ({ 人物档案: '人物', 人物关系: '关系', 组织与阵营: '组织', 地点与空间: '地点' } as Record<string, string>)[declared.trim()] ?? declared.trim()
  : path.includes('/人物档案/') ? '人物' : path.includes('/人物关系/') ? '关系'
  : path.includes('/组织与阵营/') ? '组织' : path.includes('/地点与空间/') ? '地点' : '设定'

/** Read settled sources without creating state, calling a model or inferring co-occurrence. */
export function readStoryGraph(source: GraphSource): StoryGraph {
  const records: StoryGraphRecord[] = [], edges: StoryGraphEdge[] = [], events: StoryGraphRecord[] = []
  const warnings: { path: string; message: string }[] = []
  const evidence: GraphEvidence[] = []
  const entities: NonNullable<StoryGraph['entities']>[number][] = []
  const sourceHashes: Record<string, string> = {}
  const format = source.contract === undefined ? undefined : parseBookFormatVersion(source.contract)
  if (source.contract !== undefined) sourceHashes['作品契约/契约.md'] = documentHash(source.contract)
  if (format && !format.ok && format.kind !== 'unversioned') return { bookId: source.bookId, bookName: source.bookName,
    maxChapter: Math.max(1, source.maxChapter), records, edges, events, warnings: [{ path: '作品契约/契约.md', message: format.reason }], evidence, entities, sourceHashes,
    fingerprint: documentHash(JSON.stringify(sourceHashes)), format }
  const aliases = new Map<string, Set<string>>()
  const links: { record: StoryGraphRecord; targets: string[]; relation?: string; pair: boolean }[] = []
  const alias = (name: string, id: string) => { if (!name) return; const values = aliases.get(name) ?? new Set<string>(); values.add(id); aliases.set(name, values) }
  const strings = (fields: Readonly<Record<string, unknown>>) => Object.fromEntries(Object.entries(fields).filter((pair): pair is [string, string] => typeof pair[1] === 'string'))
  const fromFields = (id: string, label: string, kind: string, path: string, line: number, fields: Readonly<Record<string, unknown>>, body: string): StoryGraphRecord => ({
    id, label, kind, status: text(fields['状态']), plan: fields['性质'] === '计划',
    chapter: chapter(fields['起始章']) ?? chapter(fields['生效章']) ?? chapter(fields['章号']) ?? entryChapterNo({ 字段: strings(fields) }) ?? undefined,
    endChapter: chapter(fields['失效章']), revealChapter: chapter(fields['披露章']) ?? chapter(fields['揭示章']),
    source: { space: 'book:' + source.bookId, path }, line, preview: body.trim().slice(0, 600),
    // Expose authored scalar/list field names as grouping choices without
    // guessing whether 宗门/血脉/师承 means faction, family or another identity.
    affiliations: (id.startsWith('world:') ? Object.entries(fields) : []).filter(([field, value]) => !['名称', '类型', '性质', '状态', '来源', '来源引用', '版本', '父版本', '生成模块', '章号', '起始章', '生效章', '失效章', '披露章', '揭示章', '别名', '关系', '关系类型', '关系双方', '主体', '客体'].includes(field)
      && (typeof value === 'string' && !/[\r\n]/.test(value) && value.length <= 128 || Array.isArray(value) && value.length <= 24 && value.every(item => typeof item === 'string' && item.length <= 128 && !/[\r\n]/.test(item))))
      .flatMap(([field, value]) => terms(value).map(label => ({ field, label }))),
  })
  const scan = (path: string, depth = 0) => {
    if (depth > 12) { warnings.push({ path, message: '目录层级过深，未继续读取' }); return }
    let entries: readonly TreeEntry[]
    try { entries = source.list(path) } catch (error) {
      if ((error as { code?: unknown }).code !== 'not-found') warnings.push({ path, message: '该目录无法读取' })
      return
    }
    for (const entry of entries) {
      if (entry.error) { warnings.push({ path: entry.ref.path, message: entry.error }); continue }
      if (entry.directory) { scan(entry.ref.path, depth + 1); continue }
      if (!entry.name.endsWith('.md') || entry.name === '模块声明.md') continue
      try {
        const raw = source.read(entry.ref.path)
        const ranges = createEvidenceRanges(raw)
        sourceHashes[entry.ref.path] = ranges.hash
        const parsed = parseWorldbookHistory(raw)
        if (!parsed.ok) { warnings.push({ path: entry.ref.path, message: '文档字段无法解析' }); continue }
        const { 字段: fields, 首段: body, 追加: appends } = parsed.data
        const label = text(fields['名称']) || entry.name.replace(/\.md$/, '')
        const base = fromFields('world:' + entry.ref.path, label, kindOf(entry.ref.path, fields['类型']), entry.ref.path, 1, fields, body)
        const recordChapter = chapter(fields['章号']) ?? entryChapterNo({ 字段: strings(fields) }) ?? undefined
        const corrected = fields['生成模块'] === '吃书补偿' || fields['性质'] === '事实' && Number(fields['版本']) > 1
        const historyBasis = corrected ? 'current-only' : recordChapter || base.chapter ? 'recorded' : 'unknown'
        const headId = base.id + ':head'
        const record = { ...base, recordChapter, historyBasis, ...(corrected ? { currentOnlyAt: Math.max(1, source.maxChapter) } : {}), evidenceId: headId } satisfies StoryGraphRecord
        entities.push({ id: record.id, label, aliases: terms(fields['别名']), kind: record.kind })
        for (const name of [label, entry.name, entry.ref.path, entry.ref.path.replace(/\.md$/, ''), ...terms(fields['别名'])]) alias(name, record.id)
        const pair = terms(fields['关系双方']).length ? terms(fields['关系双方']) : [text(fields['主体']), text(fields['客体'])].filter(Boolean)
        // A file holding only appended facts, without fields or opening text, has no head record.
        if (body || Object.keys(fields).length || !appends.length) {
          evidence.push({ id: headId, ownerId: record.id, source: record.source, sourceKind: 'world-head', fields,
            ...ranges.range(body ? ranges.bodyStartLine : 1, appends[0]?.行号 ?? ranges.endLine), recordChapter,
            historyBasis, eligible: fields['性质'] === '事实' && !!body.trim() })
          records.push(record)
          links.push({ record, targets: pair.length ? pair : [...terms(fields['关联人物']), ...wiki(body)], pair: pair.length === 2,
            relation: text(fields['关系']) || text(fields['关系类型']) || (record.kind === '关系' ? label : undefined) })
        }
        // Appended facts keep the file identity and explicit end, never its plan nature, relation pair or reveal chapter.
        for (const [index, fact] of appends.entries()) {
          const evidenceId = record.id + ':append:' + fact.行号
          const settled = { ...record, status: '已成事实', plan: false, chapter: chapter(fact.章), recordChapter: chapter(fact.章),
            revealChapter: undefined, currentOnlyAt: undefined, affiliations: undefined, historyBasis: 'recorded' as const, evidenceId, line: fact.行号, preview: fact.正文.slice(0, 600) }
          evidence.push({ id: evidenceId, ownerId: record.id, source: record.source, sourceKind: 'world-append',
            fields: { 状态: '已成事实', 章号: fact.章, ...(fact.来源 ? { 来源: fact.来源 } : {}) },
            ...ranges.range(fact.行号 + (fact.来源 !== undefined ? 2 : 1), appends[index + 1]?.行号 ?? ranges.endLine),
            recordChapter: fact.章, historyBasis: 'recorded', eligible: !!fact.正文.trim() })
          records.push(settled)
          links.push({ record: settled, targets: wiki(fact.正文), pair: false })
        }
        if (record.kind === '关系' && !pair.length && ![body, ...appends.map(fact => fact.正文)].some(part => wiki(part).length)) warnings.push({ path: entry.ref.path, message: '关系条目未记录明确两端；保留记录，不猜连线' })
      } catch { warnings.push({ path: entry.ref.path, message: '该条目无法安全读取' }) }
    }
  }
  scan('世界书')
  for (const category of LEDGER_NAMES) {
    const path = '账本/' + category + '.md'
    let raw: string
    try { raw = source.read(path) } catch (error) {
      if ((error as { code?: unknown }).code !== 'not-found') warnings.push({ path, message: '该账本无法读取' })
      continue
    }
    const ranges = createEvidenceRanges(raw)
    sourceHashes[path] = ranges.hash
    const parsed = parseLedgerHistory(raw, category, path)
    if (!parsed.ok) { warnings.push({ path, message: parsed.reason }); continue }
    for (const [index, entry] of parsed.entries.entries()) {
      const id = category === '时间线' ? 'event:' + path + ':' + entry.行号 : 'ledger:' + category + ':' + identity(entry.名称)
      const content = category === '时间线' ? renderTimelineContent(entry) : entry.正文
      const evidenceId = id + ':' + entry.行号
      const base = fromFields(id, entry.名称, category === '时间线' ? '事件' : category, path, entry.行号, entry.字段, content)
      const recordChapter = entryChapterNo(entry) ?? undefined
      const storyTime = category === '时间线' ? timelineStoryTime(entry) : undefined
      const record = { ...base, recordChapter, storyTime, historyBasis: recordChapter ? 'recorded' as const : 'unknown' as const, evidenceId }
      evidence.push({ id: evidenceId, ownerId: id, source: record.source, sourceKind: category === '时间线' ? 'timeline' : 'ledger', fields: entry.字段,
        ...ranges.range(entry.行号, parsed.entries[index + 1]?.行号 ?? ranges.endLine), recordChapter,
        storyTime, historyBasis: record.historyBasis, eligible: !record.plan && recordChapter !== undefined })
      records.push(record)
      if (category === '时间线') events.push(record)
      links.push({ record, targets: wiki(content), pair: false })
    }
  }
  const resolve = (target: string, path: string) => {
    const name = target.replace(/^\[\[|\]\]$/g, '').replace(/@\d+$/, '').replace(/\\/g, '/')
    const found = aliases.get(name)
    if (found?.size === 1) return [...found][0]
    warnings.push({ path, message: found?.size ? '同名或别名不唯一，未合并：' + name : '引用未找到对应实体：' + name })
    return undefined
  }
  for (const item of links) {
    const targets = [...new Set(item.targets.map(target => resolve(target, item.record.source.path)).filter((id): id is string => !!id))]
    if (item.pair && targets.length === 2) {
      edges.push({ ...item.record, id: 'relation:' + item.record.id, from: targets[0]!, to: targets[1]!, label: item.relation || item.record.label, relation: true, evidenceKind: 'explicit' })
    } else {
      for (const target of targets) if (target !== item.record.id) edges.push({ ...item.record, id: 'ref:' + item.record.id + ':' + target,
        from: item.record.id, to: target, label: item.record.kind === '事件' ? '参与记录' : '关联引用', relation: false, evidenceKind: 'reference' })
    }
  }
  const maxChapter = records.reduce((latest, item) => Math.max(latest, item.chapter ?? 0, item.recordChapter ?? 0, item.revealChapter ?? 0), Math.max(source.maxChapter, 1))
  const fingerprint = documentHash(JSON.stringify([source.bookId, Object.entries(sourceHashes).sort(([a], [b]) => a.localeCompare(b)), warnings]))
  const currentBound = <T extends StoryGraphRecord>(items: readonly T[]) => items.map(item => item.currentOnlyAt === undefined ? item : { ...item, currentOnlyAt: maxChapter })
  const withChapters = evidence.map(item => {
    const references = terms(item.fields['来源']).map(value => normalizeNodeKey(value.replace(/^\[\[|\]\]$/g, '').split('|')[0]!.replace(/@[^/@]+$/, '')))
      .filter((value): value is NonNullable<typeof value> => !!value && /^定稿\/卷\d+\/\d{4}-[^/]+\.md$/.test(value))
    return { ...item, relatedChapters: [...new Set(references)].map(path => ({ space: item.source.space, path })) }
  })
  return { bookId: source.bookId, bookName: source.bookName, maxChapter, records: currentBound(records), edges: currentBound(edges), events, warnings, evidence: withChapters, entities, sourceHashes, fingerprint, format }
}
