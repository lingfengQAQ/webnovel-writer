import { parseDocument } from '../repo/frontmatter'
import { parseSourceRef } from '../repo/sourceRef'
import { relPathProblem } from '../repo/rel-path'
import { classifyDocumentPath } from '../repo/document-types'
import { paths, validateSegment } from '../repo/paths'
import { parseMachineJson, MACHINE_SCHEMA_VERSION } from '../repo/schema'
import { extractSourceRefLines } from '../outline/parse'
import { isSupplement, parseMaterialManifest } from '../assembly/read'
import { 材料包十段, sectionFileName } from '../assembly/sections'
import type { UpgradeChange, UpgradeEffect } from './upgrade-types'
import type { BookInspection, MaintenanceIssue } from './types'

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
const hash = /^[a-f0-9]{64}$/

function sourceIdentity(value: string): string | undefined {
  if (relPathProblem(value, { strict: true }) !== null || value.includes('\\')
    || value.split('/').some(part => !part || part.startsWith('.') || /[\x00-\x1f:]/.test(part))) return undefined
  return process.platform === 'win32' ? value.toLowerCase() : value
}

/** Exact declared source paths/ref syntax only; never searches prose for a filename. */
export function upgradeEffects(files: ReadonlyMap<string, string>, changes: readonly UpgradeChange[]): UpgradeEffect[] {
  const changed = new Map<string, string>()
  for (const change of changes) {
    const identity = sourceIdentity(change.relPath)
    if (identity !== undefined && change.before !== change.after) changed.set(identity, change.relPath)
  }
  const effects = new Map<string, { sources: Set<string>; reasons: Set<string> }>()
  const chapterSources = new Map<string, Set<string>>()
  const add = (file: string, sources: readonly string[], reason: string): void => {
    if (!sources.length || !files.has(file) || changed.has(sourceIdentity(file) ?? '')) return
    const entry = effects.get(file) ?? { sources: new Set<string>(), reasons: new Set<string>() }
    sources.forEach(source => entry.sources.add(source))
    entry.reasons.add(reason)
    effects.set(file, entry)
  }
  const resolve = (value: unknown, allowBare = false): string | undefined => {
    if (typeof value !== 'string') return undefined
    const ref = parseSourceRef(/^(?:来源|來源)[:：]/.test(value) ? value : `来源:${value}`)
    const source = ref?.kind === '仓内' ? ref.path : allowBare && ref === null ? value : undefined
    return source === undefined ? undefined : changed.get(sourceIdentity(source) ?? '')
  }
  const chapter = (name: string, sources: readonly string[]): void => {
    const found = chapterSources.get(name) ?? new Set<string>()
    sources.forEach(source => found.add(source))
    if (found.size) chapterSources.set(name, found)
  }

  for (const [file, content] of files) {
    if (changed.has(sourceIdentity(file) ?? '')) continue
    const units = classifyDocumentPath(file)?.units
    const material = /^草稿区\/材料包\/(卷\d+-[^/]+)\/材料清单\.json$/.exec(file)
    if (material && units?.includes('I24')) {
      let parsed: ReturnType<typeof parseMaterialManifest>
      try { parsed = parseMaterialManifest(content) } catch { continue }
      const directory = file.slice(0, -'/材料清单.json'.length)
      const rows: readonly unknown[] = parsed.extended ? parsed.sections : Array.isArray(parsed.raw['段']) ? parsed.raw['段'] : []
      for (const row of rows) {
        if (!object(row) || typeof row['段'] !== 'string' || !Array.isArray(row['来源']) || !row['来源'].every(value => typeof value === 'string')) continue
        if (row['类型'] === '补充') {
          // Only the validated extended protocol can declare a supplement and
          // its scope; a stray retained attachment is never rediscovered.
          const supplement = parsed.sections.find(item => isSupplement(item) && item.编号 === row['编号'])
          if (!supplement || !isSupplement(supplement) || supplement.来源快照.域 !== '本书') continue
          const source = resolve(supplement.来源快照.路径, true)
          if (source === undefined) continue
          const target = `${directory}/${supplement.文件}`
          const location = `${source}:${supplement.来源快照.起行}-${supplement.来源快照.终行}`
          add(target, [source], `已登记补充引用 ${location}；来源文件字节将变化，保留摘录与原读取哈希，使用前须重读来源`)
          add(file, [source], `补充 ${supplement.编号} 的来源与行位置须复核；清单和原来源哈希保持原样`)
          chapter(material[1]!, [source])
        } else if (row['类型'] === undefined) {
          const index = (材料包十段 as readonly string[]).indexOf(row['段'])
          if (index < 0) continue
          const sources = row['来源'].flatMap(value => { const source = resolve(value, true); return source === undefined ? [] : [source] })
          add(`${directory}/${sectionFileName(index, 材料包十段[index]!)}`, sources, '本段登记的来源表示将变化；保留历史材料，再次使用前核对来源与切片')
          add(file, sources, '基础材料登记的来源表示将变化；保留清单和原版本，不自动重建材料')
          chapter(material[1]!, sources)
        }
      }
      continue
    }

    if (file.endsWith('.md') && units && !units.some(unit => unit === 'I23' || unit === 'I24')) {
      const parsed = parseDocument(content)
      if (!parsed.ok) continue
      const fields = parsed.data.fields
      const references = extractSourceRefLines(fields).flatMap(value => { const source = resolve(value); return source === undefined ? [] : [source] })
      const candidates: unknown[] = [fields['来源细纲版本']]
      const snapshot = fields['来源快照']
      if (object(snapshot)) {
        // These are actual producer-owned reference keys, not arbitrary values
        // in an author extension or an opaque narrative snapshot.
        candidates.push(snapshot['来源草稿'], snapshot['来源细纲'])
        if (snapshot['域'] === '本书') candidates.push(snapshot['路径'])
      }
      const sources = [...references, ...candidates.flatMap(value => { const source = resolve(value, true); return source === undefined ? [] : [source] })]
      add(file, sources, '已声明的来源字节或行位置将变化；原内容版本与引用保留，再次使用前复核依赖')
    }

    // Prepared memory updates bind exact original memory bytes by entry name.
    // Other arbitrary JSON strings, historical receipts and model caches do
    // not become dependency edges merely by mentioning a source filename.
    if (file.endsWith('/清单.json') && units?.includes('I26')) {
      const parsed = parseMachineJson(content, MACHINE_SCHEMA_VERSION)
      const baselines = parsed.ok ? parsed.data['记忆更新基线'] : undefined
      if (!object(baselines)) continue
      const sources = Object.entries(baselines).flatMap(([name, fingerprint]) => {
        if (validateSegment(name).length || typeof fingerprint !== 'string' || !hash.test(fingerprint)) return []
        const source = resolve(paths.本书记忆条目(name), true)
        return source === undefined ? [] : [source]
      })
      add(file, sources, '待定稿包保存的记忆更新原文基线将过期；保留原清单，重新准备并核对裁决')
    }
  }

  for (const change of changes) {
    const draft = /^草稿区\/草稿\/(卷\d+-[^/]+)\/稿\d+/.exec(change.relPath)
    if (draft) chapter(draft[1]!, [change.relPath])
  }
  for (const [name, sources] of chapterSources) {
    const pathsToRecheck = [`草稿区/审核/${name}.json`, ...[...files.keys()].filter(file => file.startsWith(`草稿区/定稿准备/${name}/`) && classifyDocumentPath(file)?.units.includes('I26'))]
    for (const file of pathsToRecheck) add(file, [...sources], '同章材料的来源表示将变化；保留原审核与准备工件，复用前须重新核对，旧批准不会刷新')
  }
  return [...effects].sort(([a], [b]) => compare(a, b)).map(([file, entry]) => ({ path: file, sources: [...entry.sources].sort(compare), reason: [...entry.reasons].sort(compare).join('；') }))
}

/**
 * Narrowly classify newly caused staleness. This never deletes issues, marks a
 * book healthy, refreshes evidence, or excuses any source/attachment failure.
 */
export function expectedUpgradeStaleness(before: BookInspection, after: BookInspection, effects: readonly UpgradeEffect[]): readonly MaintenanceIssue[] {
  if (!before.快照.稳定 || !after.快照.稳定) return []
  const known = new Map(effects.map(effect => [effect.path, effect]))
  return after.问题.filter(issue => {
    if (issue.代码 !== 'EVIDENCE_STALE' || before.问题.some(existing => existing.路径 === issue.路径 && existing.代码 === 'EVIDENCE_STALE')) return false
    const match = /^(草稿区\/材料包\/卷\d+-[^/]+)\/补充\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.md$/.exec(issue.路径)
    if (!match) return false
    const effect = known.get(issue.路径), manifestPath = `${match[1]}/材料清单.json`, manifest = known.get(manifestPath)
    if (!effect?.sources.length || !manifest?.sources.some(source => effect.sources.includes(source))) return false
    if (before.未检范围.some(item => item.路径 === issue.路径 || item.路径 === manifestPath)
      || after.未检范围.some(item => item.路径 === issue.路径 || item.路径 === manifestPath)) return false
    return [issue.路径, manifestPath].every(file => before.受检范围.some(item => item.路径 === file && item.文档类型.includes('I24') && item.结果 === '已检查'))
      && after.受检范围.some(item => item.路径 === issue.路径 && item.文档类型.includes('I24'))
  })
}
