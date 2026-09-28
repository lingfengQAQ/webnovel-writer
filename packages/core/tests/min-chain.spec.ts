import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  applyRevision,
  assembleMaterials,
  confirmOutline,
  deriveChapterFacts,
  preparePack,
  scanChapter,
  seedMinDesign,
  writeCandidate,
} from '../src/index'
import { writeDraft } from '@webnovel/drafting'
import { polishDraft } from '@webnovel/polish'
import { ingestFindings, registerDefaultChecks, resetChecks, runReview } from '@webnovel/review'

const roots: string[] = []
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

const key = { 卷: 1, 章: 1, 章名: '开篇任务' } as const
const refs = ['作品契约/契约.md@1', '世界书/人物档案/主角.md@1'] as const
const HARD = '开场必须点名主角现身'

describe('最小链 e2e', () => {
  it('seedMinDesign → confirm → assemble → writeDraft → polish → review → preparePack → 作者定稿裁决', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-minchain-'))
    roots.push(root)
    seedMinDesign(root)

    const body = [
      '# 章细纲',
      '',
      '## 定位段',
      '',
      '### 来源窗口项及拆并关系',
      '开篇任务，单章承接',
      '',
      '### 章节功能',
      '',
      `- 〔硬〕${HARD}`,
      '',
      '### 视角与焦点',
      '主角视角',
      '',
      '### 时空锚定',
      '城门口，清晨',
      '',
      '### 起止边界',
      '从抵达城门到发现异状',
      '',
      '### 故事线与承诺分配',
      '推进主线承诺',
      '',
      '### 信息边界',
      '只披露主角所见',
      '',
      '### 情绪与节奏目标',
      '紧张后留钩子',
      '',
      '### 前置条件核对结果',
      '已核对来源与窗口，前置设定均非留白',
      '',
      '## 细纲段',
      '',
      '### 单元 1',
      '',
      '- 目标: 开场',
      '- 人物: 主角',
      '- 时空: 城门口',
      '- 行动/冲突: 盘问与发现',
      '- 信息披露: 异常线索',
      '- 状态变化: 从平静到警觉',
      '',
    ].join('\n')
    writeCandidate(root, { 卷: 1, 章: 1, 章名: '开篇任务', 来源引用: refs, body })
    expect(confirmOutline(root, key)).toEqual({ ok: true })
    expect(assembleMaterials(root, key).ok).toBe(true)
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('写稿')

    const drafted = writeDraft(root, {
      ...key,
      body: `巷口风大。${HARD}。他没有回头。`,
      选定: true,
    })
    expect(drafted.ok).toBe(true)
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('润色')

    const polished = polishDraft(root, key)
    expect(polished.ok).toBe(true)
    expect(polished.角色).toBe('待审稿')
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('审核')

    resetChecks()
    registerDefaultChecks()
    const reviewed = runReview(root, key)
    expect(reviewed.ok).toBe(true)
    // 空审 fail-closed:隔离子 Agent 模块未回写,审核不判完成
    expect(reviewed.record?.完成).toBe(false)
    const pendingModules = Object.entries(reviewed.record?.模块 ?? {}).filter(([, st]) => st.待回写 === true)
    expect(pendingModules.length).toBeGreaterThan(0)
    let ingested = reviewed.record
    for (const [name] of pendingModules) {
      const ing = ingestFindings(root, key, name, [], reviewed.record!.审读指纹)
      expect(ing.ok).toBe(true)
      ingested = ing.record
    }
    expect(ingested?.完成).toBe(true)
    // F1:语义类硬约束产出「需审读」发现项——按真实流程给处置(作者保留)后再推进
    for (const finding of ingested?.问题 ?? []) {
      const d = finding.处置 ?? finding.处置状态 ?? ''
      if (d === '' || d === '待处理') {
        const applied = applyRevision(root, key, { 发现项编号: finding.发现项编号, 处置: '作者保留' })
        expect(applied.ok).toBe(true)
      }
    }
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('定稿准备与沉淀')
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('定稿准备与沉淀')

    expect(preparePack(root, key).ok).toBe(true)
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('作者定稿裁决')
  })
})
