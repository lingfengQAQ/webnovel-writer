import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { previewBookUpgrade, applyBookUpgrade } from '@webnovel/core'
import { StudyService } from '../src/study/service'
import { projectStoryGraph, storyGraphHistory } from '../src/study/graph-types'
import { removeSync } from '../../core/src/repo/remove'
import {
  consumerBookId, consumerKey, laterConsumerKey, createConsumerBook,
  consumerSnapshot, readConsumerFile,
} from '../../core/tests/fixtures/maintenance-upgrade/consumer-book'

const temp = fs.realpathSync.native(os.tmpdir())
let workspace: string, root: string
beforeEach(() => { workspace = fs.mkdtempSync(path.join(temp, 'upgrade-graph-')); root = createConsumerBook(workspace) })
afterEach(() => {
  if (path.dirname(workspace) !== temp || !path.basename(workspace).startsWith('upgrade-graph-')) throw new Error('Unsafe fixture cleanup')
  removeSync(workspace)
})
const readGraph = () => new StudyService(workspace).graph(`book:${consumerBookId}`)
const filter = (chapter: number) => ({ chapter, reader: false, unknown: true, plans: false })
function upgrade() {
  const preview = previewBookUpgrade(root)
  expect(preview.state, JSON.stringify(preview.issues)).toBe('ready')
  expect(applyBookUpgrade(root, { bookId: consumerBookId, fingerprint: preview.fingerprint! })).toMatchObject({ ok: true, state: 'committed' })
}

describe('whole-book upgrade through the actual study graph reader', () => {
  it('preserves event previews, explicit reference edges, source locations and temporal clue history', () => {
    const before = readGraph()
    upgrade()
    const snapshot = consumerSnapshot(root), graph = readGraph()
    expect(graph.warnings).toEqual([])
    expect(before.events).toEqual([])
    expect(before.warnings.some(item => item.message.includes('预览升级'))).toBe(true)
    const first = graph.events.find(event => event.label === '渡口会面')!
    expect(first).toMatchObject({ chapter: 3, source: { space: `book:${consumerBookId}`, path: '账本/时间线.md' } })
    expect(first.preview).toContain('事件：[[林舟]] 在渡口遇见摆渡人')
    expect(first.preview).toContain('时点：次日清晨')
    expect(readConsumerFile(root, first.source.path).split('\n')[first.line - 1]).toBe('## 渡口会面')
    expect(before.edges.some(edge => edge.from === first.id)).toBe(false)
    expect(graph.edges.find(edge => edge.from === first.id && edge.to === 'world:世界书/人物档案/林舟.md')).toMatchObject({ relation: false })
    const early = projectStoryGraph(graph, filter(consumerKey.章)), late = projectStoryGraph(graph, filter(laterConsumerKey.章))
    expect(early.events.some(event => event.label === '再次会面')).toBe(false)
    expect(late.events.some(event => event.label === '再次会面')).toBe(true)
    expect(early.nodes.find(record => record.label === '渡口印记')?.status).toBe('已埋')
    expect(late.nodes.find(record => record.label === '渡口印记')?.status).toBe('已收')
    expect(storyGraphHistory(graph, 'ledger:线索:渡口印记', filter(consumerKey.章)).map(record => record.status)).toEqual(['已埋'])
    expect(storyGraphHistory(graph, 'ledger:线索:渡口印记', filter(laterConsumerKey.章)).map(record => record.status)).toEqual(['已埋', '已收'])
    expect(graph.edges.every(edge => !edge.relation)).toBe(true)
    expect(consumerSnapshot(root)).toEqual(snapshot)
  }, 120_000)

  it('repairs retcon nature while keeping its undated current snapshot out of earlier chapters and reader view', () => {
    const before = readGraph(), headBefore = before.records.find(record => record.id === 'world:世界书/人物档案/林舟.md')!
    expect(headBefore.plan).toBe(true)
    upgrade()
    const snapshot = consumerSnapshot(root), after = readGraph(), headAfter = after.records.find(record => record.id === headBefore.id)!
    expect(headAfter).toEqual({ ...headBefore, plan: false })
    // Repairing 计划→事实 proves nature, not the chapter when the replacement text became valid.
    expect(headAfter.historyBasis).toBe('current-only')
    expect(projectStoryGraph(after, filter(consumerKey.章)).nodes.some(record => record.id === headAfter.id)).toBe(false)
    expect(projectStoryGraph(after, filter(after.maxChapter)).nodes.some(record => record.id === headAfter.id)).toBe(true)
    expect(projectStoryGraph(after, { ...filter(consumerKey.章), reader: true }).nodes.some(record => record.id === headAfter.id)).toBe(false)
    expect(after.records.find(record => record.id === 'world:世界书/人物档案/主角.md')?.plan).toBe(true)
    expect(previewBookUpgrade(root).state).toBe('unchanged')
    expect(consumerSnapshot(root)).toEqual(snapshot)
  }, 120_000)
})
