import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  applyRevision,
  assembleMaterials,
  confirmOutline,
  deriveChapterFacts,
  isNoFindingReview,
  isReviewIncomplete,
  loadReviewRecord,
  scanChapter,
  seedMinDesign,
  serializeDocument,
  writeCandidate,
} from '@webnovel/core'
import {
  ingestFindings,
  planReview,
  registerCheck,
  registerDefaultChecks,
  resetChecks,
  runReview,
} from '../src/index'

const roots: string[] = []
function mkBook(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-review-'))
  roots.push(dir)
  seedMinDesign(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })
beforeEach(() => {
  resetChecks()
  registerDefaultChecks()
})

const key = { 卷: 1, 章: 1, 章名: '开篇任务' } as const
const refs = ['作品契约/契约.md@1', '世界书/人物档案/主角.md@1'] as const
const HARD = '本章必须出现「主角现身」'

function confirmWithHard(root: string): void {
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
  const r = confirmOutline(root, key)
  if (!r.ok) throw new Error(`confirm failed:${r.gaps.join(';')}`)
}

function putPending(root: string, body: string, file = '稿1.md'): void {
  const rel = `草稿区/草稿/卷01-开篇任务/${file}`
  fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), serializeDocument({ 角色: '待审稿', 选定: true }, body), 'utf-8')
}


/** 空审 fail-closed 的测试侧通道:把全部待回写模块回写(空发现项)。 */
function ingestAll(root: string, key: { 卷: number; 章: number; 章名: string }): void {
  const record = loadReviewRecord(root, key)
  for (const [name, st] of Object.entries(record?.模块 ?? {})) {
    if (st.待回写 === true) {
      const r = ingestFindings(root, key, name, [], record!.审读指纹)
      if (!r.ok) throw new Error(r.reason)
    }
  }
}

describe('审核检查项库', () => {
  it('no 待审稿 → refuse', () => {
    const root = mkBook()
    confirmWithHard(root)
    assembleMaterials(root, key)
    const r = runReview(root, key)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/待审稿/)
  })

  it('multiple 待审稿 → fail closed instead of selecting the first file', () => {
    const root = mkBook()
    confirmWithHard(root)
    assembleMaterials(root, key)
    putPending(root, `${HARD}。第一稿。`)
    putPending(root, `${HARD}。第二稿。`, '稿2.md')
    const r = runReview(root, key)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/不唯一/)
    expect(r.record).toBeNull()
  })

  it('leftover AI phrase → finding, 完成 true but 待处理 → derive 改稿', () => {
    const root = mkBook()
    confirmWithHard(root)
    assembleMaterials(root, key)
    putPending(root, `综上所述，${HARD}。雨停了。`)
    const r = runReview(root, key)
    expect(r.ok).toBe(true)
    // 空审 fail-closed:隔离子 Agent 模块未回写时不判完成
    expect(r.record?.完成).toBe(false)
    ingestAll(root, key)
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('改稿')
    const loaded = loadReviewRecord(root, key)!
    expect(loaded.完成).toBe(true)
    expect(loaded.问题.some((p) => p.问题说明.includes('综上所述') && p.处置 === '待处理')).toBe(true)
  })

  it('clean text + 硬约束 present → 完成 true, 问题 empty → derive 定稿准备与沉淀', () => {
    const root = mkBook()
    confirmWithHard(root)
    assembleMaterials(root, key)
    putPending(root, `巷口风大。${HARD}。他没有回头。`)
    const r = runReview(root, key)
    expect(r.ok).toBe(true)
    expect(r.record?.完成).toBe(false)
    ingestAll(root, key)
    const loaded = loadReviewRecord(root, key)!
    expect(loaded.完成).toBe(true)
    expect(loaded.问题).toEqual([])
    expect(isNoFindingReview(loaded)).toBe(true)
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('定稿准备与沉淀')
  })

  it('确定性检查重跑不丢失先前回写的语义发现项', () => {
    const root = mkBook()
    confirmWithHard(root)
    assembleMaterials(root, key)
    putPending(root, `巷口风大。${HARD}。他没有回头。`)
    const first = runReview(root, key)
    expect(first.ok).toBe(true)

    const finding = {
      严重程度: '中',
      证据位置: '开头',
      问题说明: '主角动机铺垫不足',
      所依据材料及版本: '稿1@1',
      影响范围: '正文',
      修改建议: '补一句动机',
      建议返回节点: '改稿',
      建议复审模块: '章节结构审读',
      不确定性说明: '',
      材料完整性: '完整',
    }
    const ingested = ingestFindings(root, key, '章节结构审读', [finding], first.record!.审读指纹)
    expect(ingested.ok).toBe(true)
    expect(runReview(root, key).ok).toBe(true)
    const loaded = loadReviewRecord(root, key)!
    expect(loaded.问题.some((item) => item.模块名 === '章节结构审读' && item.问题说明 === finding.问题说明)).toBe(true)
  })

  it('方案 with skip 理由 is recorded; skip without 理由 still runs', () => {
    const root = mkBook()
    confirmWithHard(root)
    assembleMaterials(root, key)
    putPending(root, `综上所述，${HARD}。`)
    planReview(root, key, {
      动作: '有理由跳过',
      理由: '本轮只核设定',
      跳过: [{ 模块: '文本规范检查', 理由: '作者指定本轮不跑套话' }],
    })
    const skipped = runReview(root, key)
    expect(skipped.record?.方案?.跳过?.[0]?.模块).toBe('文本规范检查')
    expect(skipped.record?.模块['文本规范检查']?.跳过).toBe(true)
    expect(skipped.record?.问题.some((p) => p.问题说明.includes('综上所述'))).toBe(false)

    const root2 = mkBook()
    confirmWithHard(root2)
    assembleMaterials(root2, key)
    putPending(root2, `综上所述，${HARD}。`)
    planReview(root2, key, {
      动作: '跳过',
      理由: '试跳过',
      跳过: [{ 模块: '文本规范检查', 理由: '' }],
    })
    const still = runReview(root2, key)
    expect(still.record?.问题.some((p) => p.问题说明.includes('综上所述'))).toBe(true)
    expect(still.record?.模块['文本规范检查']?.跳过).not.toBe(true)
  })

  it('无问题 (完成 true, 问题 []) distinguishable from 未完成 (完成 false)', () => {
    const root = mkBook()
    confirmWithHard(root)
    putPending(root, `${HARD}。`)
    const clean = runReview(root, key)
    ingestAll(root, key)
    expect(isNoFindingReview(loadReviewRecord(root, key)!)).toBe(true)
    expect(isReviewIncomplete(loadReviewRecord(root, key)!)).toBe(false)

    fs.writeFileSync(
      path.join(root, '草稿区/审核/卷01-开篇任务.json'),
      JSON.stringify({ schemaVersion: 1, 完成: false, 问题: [] }),
      'utf-8',
    )
    const loaded = loadReviewRecord(root, key)
    expect(loaded).not.toBeNull()
    expect(isNoFindingReview(loaded!)).toBe(false)
    expect(isReviewIncomplete(loaded!)).toBe(true)
    // F5:该手写记录无审稿哈希=证据过期;恢复视图停在审核(须重审)
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('审核')
  })

  it('重跑审核保留作者已给的处置，不把章节推回改稿', () => {
    const root = mkBook()
    confirmWithHard(root)
    assembleMaterials(root, key)
    putPending(root, `综上所述，${HARD}。`)
    const first = runReview(root, key)
    ingestAll(root, key)
    const finding = first.record!.问题.find((p) => p.问题说明.includes('综上所述'))!
    expect(finding.处置).toBe('待处理')

    const kept = applyRevision(root, key, {
      发现项编号: finding.发现项编号,
      处置: '作者保留',
      范围: '草稿区/草稿',
    })
    expect(kept.ok).toBe(true)
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('定稿准备与沉淀')

    const again = runReview(root, key)
    expect(again.ok).toBe(true)
    ingestAll(root, key)
    const same = again.record!.问题.find((p) => p.问题说明.includes('综上所述'))
    expect(same?.处置).toBe('作者保留')
    expect(same?.处置状态).toBe('作者保留')
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('定稿准备与沉淀')
  })

  it('正文改掉后重跑，消失的发现项不再出现，新发现项仍是待处理', () => {
    const root = mkBook()
    confirmWithHard(root)
    assembleMaterials(root, key)
    putPending(root, `综上所述，${HARD}。`)
    const first = runReview(root, key)
    const finding = first.record!.问题.find((p) => p.问题说明.includes('综上所述'))!
    expect(applyRevision(root, key, {
      发现项编号: finding.发现项编号,
      处置: '已解决',
      范围: '草稿区/草稿',
      补丁: { old: '综上所述，', new: '值得注意的是，' },
    }).ok).toBe(true)

    const again = runReview(root, key)
    expect(again.record!.问题.some((p) => p.问题说明.includes('综上所述'))).toBe(false)
    const fresh = again.record!.问题.find((p) => p.问题说明.includes('值得注意的是'))
    expect(fresh?.处置).toBe('待处理')
  })

  it('已不注册的历史模块不再永久压住 完成，但仍留在记录里留痕', () => {
    const root = mkBook()
    confirmWithHard(root)
    assembleMaterials(root, key)
    putPending(root, `巷口风大。${HARD}。他没有回头。`)
    // 上一轮注册过、本轮已摘掉的模块，当时跑失败了
    fs.mkdirSync(path.join(root, '草稿区/审核'), { recursive: true })
    fs.writeFileSync(
      path.join(root, '草稿区/审核/卷01-开篇任务.json'),
      JSON.stringify({
        schemaVersion: 1,
        完成: false,
        问题: [],
        模块: { 节奏检查: { 完成: false, 失败: true, 理由: '模块抛异常' } },
      }),
      'utf-8',
    )
    const r = runReview(root, key)
    expect(r.ok).toBe(true)
    ingestAll(root, key)
    expect(loadReviewRecord(root, key)?.完成).toBe(true)
    // 留痕保留，但不参与判定
    expect(r.record?.模块['节奏检查']).toMatchObject({ 完成: false, 失败: true })
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('定稿准备与沉淀')
  })

  it('本轮模块失败仍然压住 完成', () => {
    const root = mkBook()
    confirmWithHard(root)
    assembleMaterials(root, key)
    putPending(root, `巷口风大。${HARD}。他没有回头。`)
    registerCheck({
      名称: '会抛的检查',
      审什么: '测试用',
      依赖材料: ['待审稿'],
      执行形态: '确定性代码',
      适用范围: '章',
      run: () => { throw new Error('故意失败') },
    })
    const r = runReview(root, key)
    expect(r.ok).toBe(true)
    expect(r.record?.完成).toBe(false)
    expect(r.record?.模块['会抛的检查']).toMatchObject({ 完成: false, 失败: true })
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('改稿')
  })
})
