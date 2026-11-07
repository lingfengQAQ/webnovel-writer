import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { contentHash } from '../src/commit/receipt'
import { serializeDocument } from '../src/repo/frontmatter'
import { serializeMachineJson } from '../src/repo/schema'
import { 材料包十段, sectionFileName, type SupplementRecord } from '../src/assembly/sections'
import { scaffoldBookFiles } from '../src/book/scaffold'
import { removeSync } from '../src/repo/remove'
import { inspectBookDocumentSnapshot } from '../src/maintenance/inspection'
import { UpgradeReader, readUpgradeInventory } from '../src/maintenance/upgrade-reader'
import { upgradeEffects, expectedUpgradeStaleness } from '../src/maintenance/upgrade-effects'
import type { UpgradeChange } from '../src/maintenance/upgrade-types'
import type { BookInspection, MaintenanceIssue } from '../src/maintenance/types'

const source = '世界书/人物档案/林舟.md'
const original = serializeDocument({ 类型: '人物', 性质: '计划', 状态: '已确认', 来源: '对谈共创' }, '# 林舟\n渡口来客。')
const change: UpgradeChange = { relPath: source, before: original, after: original + '\n', rules: ['fixture-format'], evidence: ['只改格式'] }
const chapter = '卷01-渡口'
const directory = `草稿区/材料包/${chapter}`
const manifest = `${directory}/材料清单.json`
const attachment = `${directory}/补充/portrait.md`
const review = `草稿区/审核/${chapter}.json`
const prepared = `草稿区/定稿准备/${chapter}/清单.json`
const excerpt = '渡口来客。\r\n'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) removeSync(root) })

function fixture(options: { domain?: '本书' | '书房'; registered?: boolean; baseSource?: boolean; extended?: boolean } = {}): Map<string, string> {
  const supplement: SupplementRecord = {
    类型: '补充', 段: '人物原文', 编号: 'portrait', 文件: '补充/portrait.md', 内容哈希: contentHash(excerpt),
    性质: '原文', 适用章上限: 1, 来源快照: { 域: options.domain ?? '本书', 路径: source, 起行: 2, 终行: 4, 读取哈希: contentHash(original) },
    来源: [source], 版本: contentHash(original), 选用原因: '作者选定人物原文', 完整性: '完整', 字数: Array.from(excerpt).length,
  }
  const base = 材料包十段.map((name, index) => ({ 段: name, 来源: options.baseSource && index === 3 ? [source] : [], 版本: '1', 选用原因: '夹具', 完整性: '完整', 字数: 3 }))
  return new Map([
    [source, original],
    ...材料包十段.map((name, index) => [`${directory}/${sectionFileName(index, name)}`, '# 段\n原文。'] as [string, string]),
    [manifest, serializeMachineJson({ ...(options.extended === false ? {} : { 补充协议: 1 }), 状态: '段齐备', 合计字数: 30 + supplement.字数,
      段: [...base, ...(options.registered === false || options.extended === false ? [] : [supplement])] }, 1)],
    [attachment, excerpt],
    [review, serializeMachineJson({ 完成: true, 问题: [], 模块: {}, 审读指纹: 'b'.repeat(64) }, 1)],
    [prepared, serializeMachineJson({ 文件: [], 工件: [], 裁决: '已批准' }, 1)],
    [`草稿区/定稿准备/${chapter}/正文.md`, '# 保留的准备正文\n'],
  ])
}

function inspection(issues: readonly MaintenanceIssue[] = []): BookInspection {
  return {
    状态: '已检查', 结论: issues.length ? '需处理' : '未发现已知问题', 书仓格式: { ok: true, version: 1 }, 规则版本: 1,
    受检范围: [manifest, attachment].map(file => ({ 路径: file, 文档类型: ['I24'], 检查: ['材料协议及来源'], 结果: '已检查' })),
    未检范围: [], 类型覆盖: [], 问题: issues,
    快照: { 开始时间: '', 结束时间: '', 指纹: '0'.repeat(64), 稳定: true, 文件数: 2, 目录数: 1, 变更: [] },
  }
}
const stale: MaintenanceIssue = { 代码: 'EVIDENCE_STALE', 路径: attachment, 说明: '补充材料来源已变化或不可读，保留旧证据' }

describe('precise upgrade dependency effects', () => {
  it('maps a registered source snapshot to its attachment, manifest and same-chapter review/preparation without writes', () => {
    const files = fixture(), before = [...files]
    files.set('草稿区/审核/卷02-渡口.json', '{}')
    const effects = upgradeEffects(files, [change])
    expect(effects.map(effect => effect.path)).toEqual(expect.arrayContaining([attachment, manifest, review, prepared, `草稿区/定稿准备/${chapter}/正文.md`]))
    expect(effects.some(effect => effect.path === '草稿区/审核/卷02-渡口.json')).toBe(false)
    expect(effects.find(effect => effect.path === attachment)).toMatchObject({ sources: [source], reason: expect.stringContaining(`${source}:2-4`) })
    expect([...files].slice(0, before.length)).toEqual(before)
    expect(files.get(review)).toContain('"完成":true')
    expect(files.get(prepared)).toContain('已批准')
  })

  it.each([{ domain: '书房' as const }, { registered: false }])('does not infer local dependency from external or unregistered attachment %j', options => {
    const files = fixture(options)
    files.set(attachment, serializeDocument({ 来源引用: `${source}@1` }, `路径样例：${source}`))
    expect(upgradeEffects(files, [change])).toEqual([])
  })

  it('uses registered base material sources on the legacy protocol and leaves unrelated sections alone', () => {
    const files = fixture({ baseSource: true, extended: false })
    const effects = upgradeEffects(files, [change])
    expect(effects.some(effect => effect.path === `${directory}/${sectionFileName(3, 材料包十段[3])}`)).toBe(true)
    expect(effects.some(effect => effect.path === `${directory}/${sectionFileName(0, 材料包十段[0])}`)).toBe(false)
    expect(effects.some(effect => effect.path === attachment)).toBe(false)
    expect(effects.some(effect => effect.path === review)).toBe(true)
  })

  it('uses declared source references and producer snapshot keys, not prose or arbitrary JSON values', () => {
    const files = new Map<string, string>([
      [source, original],
      ['大纲/故事骨架.md', serializeDocument({ 来源引用: [`来源:${source}@3`] }, '原文。')],
      ['大纲/分卷布局.md', serializeDocument({ 来源快照: { 来源细纲: `${source}@3`, 备注: '作者说明' } }, '原文。')],
      ['大纲/卷规划/卷01/卷纲.md', serializeDocument({ 来源快照: { 备注: `${source}@3` } }, `来源:${source}@3`)],
      ['大纲/卷规划/卷01/计划时间线.md', serializeDocument({ 来源引用: source }, '缺版本的来源引用不推断成合法依赖。')],
      ['草稿区/审核/卷01-其他.json', serializeMachineJson({ 问题: [{ 问题说明: source }] }, 1)],
      [`草稿区/.archive-receipts/${'a'.repeat(64)}.json`, JSON.stringify({ outputs: [{ relPath: source }] })],
      ['.webnovel/finalized-scenes.json', JSON.stringify({ source })],
    ])
    expect(upgradeEffects(files, [change]).map(effect => effect.path)).toEqual(['大纲/分卷布局.md', '大纲/故事骨架.md'])
  })

  it('maps prepared memory update baselines by valid entry name, not finding prose', () => {
    const memory = '本书记忆/习惯.md'
    const files = new Map([[memory, '旧记忆'], [prepared, serializeMachineJson({ 记忆更新基线: { 习惯: 'c'.repeat(64), '../逃逸': 'c'.repeat(64) } }, 1)]])
    const effects = upgradeEffects(files, [{ ...change, relPath: memory, before: '旧记忆', after: '格式化旧记忆' }])
    expect(effects).toEqual([expect.objectContaining({ path: prepared, sources: [memory] })])
  })

  it('ignores no-op changes and invalid manifest protocols without inventing dependencies', () => {
    const files = fixture()
    expect(upgradeEffects(files, [{ ...change, after: original }])).toEqual([])
    files.set(manifest, files.get(manifest)!.replace('"补充协议":1', '"补充协议":99'))
    expect(upgradeEffects(files, [change])).toEqual([])
  })
})

describe('expected new supplement staleness classification', () => {
  it('returns only a newly stale known supplement and keeps the truthful inspection intact', () => {
    const before = inspection(), after = inspection([stale]), effects = upgradeEffects(fixture(), [change])
    const selected = expectedUpgradeStaleness(before, after, effects)
    expect(selected).toEqual([stale])
    expect(selected[0]).toBe(stale)
    expect(after.结论).toBe('需处理')
    expect(after.问题).toEqual([stale])
  })

  it.each(['preexisting', 'unrelated', 'attachment-error', 'base-section', 'unknown-before', 'unstable'])('does not excuse %s findings', kind => {
    let before = inspection(), after = inspection([stale])
    let effects = upgradeEffects(fixture(), [change])
    if (kind === 'preexisting') before = inspection([stale])
    if (kind === 'unrelated') effects = []
    if (kind === 'attachment-error') after = inspection([{ ...stale, 代码: 'DOCUMENT_INVALID' }])
    if (kind === 'base-section') after = inspection([{ ...stale, 路径: `${directory}/${sectionFileName(0, 材料包十段[0])}` }])
    if (kind === 'unknown-before') before = { ...before, 未检范围: [{ 路径: manifest, 文档类型: ['I24'], 原因: '无法核实' }] }
    if (kind === 'unstable') after = { ...after, 快照: { ...after.快照, 稳定: false } }
    expect(expectedUpgradeStaleness(before, after, effects)).toEqual([])
  })

  it('uses real before/overlay inspections while leaving source, excerpts and hashes unchanged', () => {
    const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'upgrade-effects-')); roots.push(root)
    scaffoldBookFiles(root, { 状态: '已确认', 核心创意: '渡口来客。', 题材与目标读者: '面向成年人的幻想。' }, { bookId: 'effects-book' })
    const files = fixture()
    files.delete(prepared); files.delete(`草稿区/定稿准备/${chapter}/正文.md`)
    for (const [relative, text] of files) {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
      fs.writeFileSync(path.join(root, relative), text)
    }
    const baselineFiles = readUpgradeInventory(new UpgradeReader(root)).files
    const before = inspectBookDocumentSnapshot(new UpgradeReader(root))
    expect(before.问题, JSON.stringify(before.问题)).toEqual([])
    const after = inspectBookDocumentSnapshot(new UpgradeReader(root, new Map([[source, change.after]])))
    expect(after.问题).toEqual([expect.objectContaining({ 代码: 'EVIDENCE_STALE', 路径: attachment })])
    expect(expectedUpgradeStaleness(before, after, upgradeEffects(baselineFiles, [change]))).toEqual(after.问题)
    expect([...readUpgradeInventory(new UpgradeReader(root)).files]).toEqual([...baselineFiles])
  })
})
