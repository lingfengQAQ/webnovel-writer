import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { previewBookUpgrade } from '../src/maintenance/upgrade-plan'
import { applyBookUpgrade } from '../src/maintenance/upgrade'
import { queryDueLedger, queryLedger, queryMemory, renderTimelineContent } from '../src/ledger'
import { computeMaterials, assembleMaterials, loadMaterialPackage } from '../src/assembly'
import { 材料预算 } from '../src/assembly/budget'
import { rebuildResume } from '../src/recovery'
import { parseDocument } from '../src/repo/frontmatter'
import { paths } from '../src/repo/paths'
import { removeSync } from '../src/repo/remove'
import {
  consumerBookId, consumerKey, laterConsumerKey, createConsumerBook,
  consumerGit, consumerSnapshot, readConsumerFile,
} from './fixtures/maintenance-upgrade/consumer-book'

const temp = fs.realpathSync.native(os.tmpdir())
let workspace: string, root: string
beforeEach(() => { workspace = fs.mkdtempSync(path.join(temp, 'upgrade-consumers-')); root = createConsumerBook(workspace) })
afterEach(() => {
  if (path.dirname(workspace) !== temp || !path.basename(workspace).startsWith('upgrade-consumers-')) throw new Error('Unsafe fixture cleanup')
  removeSync(workspace)
})

function upgrade() {
  const before = consumerSnapshot(root), plan = previewBookUpgrade(root)
  expect(plan.state, JSON.stringify(plan.issues)).toBe('ready')
  expect(consumerSnapshot(root)).toEqual(before)
  const result = applyBookUpgrade(root, { bookId: consumerBookId, fingerprint: plan.fingerprint! })
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true, state: 'committed' })
  for (const change of plan.changes) expect(readConsumerFile(root, change.relPath)).toBe(change.after)
  return plan
}

describe('full upgrade into current material and recovery consumers', () => {
  it('preserves ledger time filtering, source expressions, clue history and original versioned design bytes', () => {
    const contractBefore = parseDocument(readConsumerFile(root, paths.契约())), outlineBefore = readConsumerFile(root, paths.确认细纲(1, consumerKey.章, consumerKey.章名))
    const earlyBefore = queryLedger(root, { 分类: '时间线', 章上限: consumerKey.章 })
    expect(earlyBefore).toMatchObject({ ok: false, kind: 'parse-error' })
    expect(earlyBefore.entries).toEqual([])
    const plan = upgrade()
    expect(new Set(plan.changes.flatMap(change => change.rules))).toEqual(new Set(['C1-v1', 'C2-v1', 'C3-v1', 'C4-v1', 'C5-v1', 'C6-v1']))
    expect(plan.effects).toEqual(expect.arrayContaining([expect.objectContaining({ path: paths.确认细纲(1, consumerKey.章, consumerKey.章名), sources: expect.arrayContaining([paths.契约(), '世界书/人物档案/林舟.md']) })]))
    const early = queryLedger(root, { 分类: '时间线', 章上限: consumerKey.章 })
    expect(early.ok).toBe(true)
    expect(early.entries.some(entry => entry.名称 === '渡口会面' && renderTimelineContent(entry).includes('时点：次日清晨'))).toBe(true)
    expect(early.entries.some(entry => entry.名称 === '再次会面')).toBe(false)
    expect(queryLedger(root, { 分类: '时间线', 章上限: laterConsumerKey.章 }).entries.some(entry => entry.名称 === '再次会面')).toBe(true)
    expect(queryLedger(root, { 分类: '线索', 章上限: consumerKey.章 }).entries[0]?.字段['状态']).toBe('已埋')
    expect(queryLedger(root, { 分类: '线索', 章上限: laterConsumerKey.章 }).entries[0]?.字段['状态']).toBe('已收')
    const due = queryDueLedger(root, consumerKey)
    expect(due.ok).toBe(true)
    expect(JSON.stringify(due)).toContain('渡口印记')
    const contractAfter = parseDocument(readConsumerFile(root, paths.契约()))
    expect(contractBefore.ok && contractBefore.data.fields).toMatchObject({ 版本: 7, 父版本: 6 })
    expect(contractAfter.ok && contractAfter.data.fields).toMatchObject({ 版本: 7, 父版本: 6, 书仓格式版本: 1 })
    expect(readConsumerFile(root, paths.确认细纲(1, consumerKey.章, consumerKey.章名))).toBe(outlineBefore)
    expect(parseDocument(readConsumerFile(root, '世界书/人物档案/林舟.md'))).toMatchObject({ ok: true, data: { fields: { 版本: 4, 父版本: 3, 性质: '事实' } } })
    expect(consumerGit(root, 'status', '--porcelain')).toBe('')
  }, 120_000)

  it('finds an older structured event beyond the recent-item budget and keeps future facts out of early materials', () => {
    upgrade()
    const before = consumerSnapshot(root), computed = computeMaterials(root, { ...consumerKey, 仅预览: true })
    expect(computed.ok).toBe(true)
    const continuity = computed.文件!.find(file => file.relPath.includes('当前事实与连续性'))!.content
    const entryCount = queryLedger(root, { 分类: '时间线', 章上限: consumerKey.章 }).entries.length
    expect(entryCount).toBeGreaterThan(材料预算.时间线最近条数)
    expect(continuity).toContain('## 渡口会面\n')
    expect(continuity).toContain('事件：[[林舟]] 在渡口遇见摆渡人')
    expect(continuity).toContain('时点：次日清晨')
    expect(continuity).not.toContain('未来渡口收到第二封信')
    expect(continuity).not.toContain('## 档案记录0\n')
    const late = computeMaterials(root, { ...laterConsumerKey, 仅预览: true })
    expect(late.ok).toBe(true)
    expect(late.文件!.find(file => file.relPath.includes('当前事实与连续性'))!.content).toContain('未来渡口收到第二封信')
    expect(computed.文件!.find(file => file.relPath.includes('文风'))!.content).toContain('以克制的叙述保留潮声')
    expect(consumerSnapshot(root)).toEqual(before)
  }, 120_000)

  it('rebuilds status from current entries and reuses actual saved material snapshots without rewriting migrated sources', () => {
    upgrade()
    const memory = queryMemory(root)
    expect(memory.ok).toBe(true)
    expect(memory.entries).toHaveLength(3)
    expect(memory.entries.every(entry => entry.格式 !== '旧')).toBe(true)
    const before = consumerSnapshot(root), fresh = rebuildResume(root, consumerKey)
    expect(fresh.memory.entries.map(entry => entry.名称).sort()).toEqual(['%41', '保留渡口视角', '渡口叙述'].sort())
    expect(fresh.statusCard).toContain('本书记忆：3 条')
    expect(fresh.reconciliation.ok).toBe(true)
    expect(fresh.injection.细纲).toContain('### 时空锚定\n渡口，清晨')
    expect(consumerSnapshot(root)).toEqual(before)
    const sources = new Map([paths.账本('时间线'), paths.账本('线索'), paths.契约(), '本书记忆/渡口叙述.md'].map(relative => [relative, readConsumerFile(root, relative)]))
    const stored = assembleMaterials(root, consumerKey)
    expect(stored.ok).toBe(true)
    const saved = loadMaterialPackage(root, consumerKey), snapshotAfterMaterial = consumerSnapshot(root), resumed = rebuildResume(root, consumerKey)
    expect(resumed.injection.材料段).toEqual(saved.段)
    expect(resumed.injection.材料段['当前事实与连续性']).toContain('事件：[[林舟]] 在渡口遇见摆渡人')
    expect(resumed.injection.材料段['当前事实与连续性']).not.toContain('未来渡口收到第二封信')
    expect(resumed.injection.材料段['文风〔条目切片〕']).toContain('以克制的叙述保留潮声')
    for (const [relative, text] of sources) expect(readConsumerFile(root, relative)).toBe(text)
    expect(consumerSnapshot(root)).toEqual(snapshotAfterMaterial)
  }, 120_000)
})
