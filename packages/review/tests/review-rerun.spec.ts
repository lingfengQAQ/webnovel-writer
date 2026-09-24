import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  assembleMaterials,
  confirmOutline,
  loadReviewRecord,
  scanChapter,
  seedMinDesign,
  serializeDocument,
  writeCandidate,
  writeReviewRecord,
} from '@webnovel/core'
import {
  computeReview,
  ingestFindings,
  listChecks,
  registerDefaultChecks,
  resetChecks,
  runReview,
} from '../src/index'

/**
 * 真机缺陷回归（20章连写第1章，D-002）：细纲升 v2 后记录指纹陈旧，模型重跑了
 * 确定性＋语义全部模块并带上当轮指纹，ingestFindings 仍一律拒绝——工具面没有任何
 * 重开轮次的通道。修复：带上与当前输入一致的指纹即按 F5 语义重置旧轮次后接收；
 * 无指纹证明仍拒绝迟到回写。
 */

const roots: string[] = []
function mkBook(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-rerun-'))
  roots.push(dir)
  seedMinDesign(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* 残留无害 */ } } })
beforeEach(() => { resetChecks(); registerDefaultChecks() })

const key = { 卷: 1, 章: 1, 章名: '开篇任务' } as const
const refs = ['作品契约/契约.md@1', '世界书/人物档案/主角.md@1'] as const
const HARD = '本章必须出现「主角现身」'

function confirmWithHard(root: string): void {
  const body = [
    '# 章细纲', '', '## 定位段', '',
    '### 来源窗口项及拆并关系', '开篇任务，单章承接', '',
    '### 章节功能', '', `- 〔硬〕${HARD}`, '',
    '### 视角与焦点', '主角视角', '',
    '### 时空锚定', '城门口，清晨', '',
    '### 起止边界', '从抵达城门到发现异状', '',
    '### 故事线与承诺分配', '推进主线承诺', '',
    '### 信息边界', '只披露主角所见', '',
    '### 情绪与节奏目标', '紧张后留钩子', '',
    '### 前置条件核对结果', '已核对来源与窗口，前置设定均非留白', '',
    '## 细纲段', '', '### 单元 1', '',
    '- 目标: 开场', '- 人物: 主角', '- 时空: 城门口',
    '- 行动/冲突: 盘问与发现', '- 信息披露: 异常线索', '- 状态变化: 从平静到警觉', '',
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

function ingestAll(root: string): void {
  const record = loadReviewRecord(root, key)
  for (const [name, st] of Object.entries(record?.模块 ?? {})) {
    if (st.待回写 === true) {
      const r = ingestFindings(root, key, name, [])
      if (!r.ok) throw new Error(r.reason)
    }
  }
}

describe('陈旧记录的重跑通道（D-002 回归）', () => {
  it.each(['逐模块', '进程内'])('%s重跑先处理确定性模块，重读记录后其他模块仍继承处置与说明', (mode) => {
    const root = mkBook()
    confirmWithHard(root)
    assembleMaterials(root, key)
    putPending(root, `巷口。${HARD}。`)
    runReview(root, key)
    const finding = { 问题说明: '开场较慢', 证据位置: '首段', 影响范围: '正文' }
    ingestFindings(root, key, '章节结构审读', [{ ...finding, 处置: '作者保留', 处置说明: '作者选择慢开场' }])
    ingestFindings(root, key, '情节与因果审读', [{ 问题说明: '将消失的旧问题', 证据位置: '末段', 处置: '已驳回' }])
    ingestAll(root)
    putPending(root, `巷口。${HARD}。门内响了两声。`)
    if (mode === '进程内') runReview(root, key)
    else ingestFindings(root, key, '文本规范检查', [], computeReview(root, key).record!.审读指纹)
    const persisted = loadReviewRecord(root, key)!
    expect(persisted.问题.some(f => f.模块名 === '章节结构审读')).toBe(false)
    expect(persisted.待继承处置?.some(f => f.模块名 === '章节结构审读')).toBe(true)
    expect(persisted.完成).toBe(false)
    // Registry recreation cannot lose the saved dispositions; subsequent calls reread the file.
    resetChecks(); registerDefaultChecks()
    const next = ingestFindings(root, key, '章节结构审读', [finding]).record!
    const inherited = next.问题.find(f => f.模块名 === '章节结构审读')!
    expect(inherited.处置状态).toBe('作者保留')
    expect(inherited.处置说明).toBe('作者选择慢开场')
    expect(next.待继承处置?.some(f => f.模块名 === '章节结构审读')).toBe(false)
    ingestFindings(root, key, '情节与因果审读', [])
    expect(loadReviewRecord(root, key)!.待继承处置 ?? []).toEqual([])
    expect(loadReviewRecord(root, key)!.问题.some(f => f.问题说明 === '将消失的旧问题')).toBe(false)
  })

  it('带上当轮指纹重置旧轮次并接收；无证明仍拒绝；作者意见与处置认亲保留', () => {
    const root = mkBook()
    confirmWithHard(root)
    assembleMaterials(root, key)
    putPending(root, `巷口风大。${HARD}。他没有回头。`)
    // 首轮：确定性模块回写＋一个语义发现项＋作者意见，处置一条
    const first = runReview(root, key)
    expect(first.ok).toBe(true)
    const semantic = ingestFindings(root, key, '章节结构审读', [
      { 问题说明: '门洞一句不通', 证据位置: '第三段', 影响范围: '正文', 处置: '作者保留', 处置状态: '作者保留' },
    ])
    expect(semantic.ok).toBe(true)
    const opinion = ingestFindings(root, key, '作者意见', [{ 问题说明: '开头再冷一点', 证据位置: '首段' }])
    expect(opinion.ok).toBe(true)
    ingestAll(root)
    const settled = loadReviewRecord(root, key)!
    expect(settled.完成).toBe(true)
    // 换稿＋改细纲 → 指纹陈旧
    const outlinePath = path.join(root, '大纲/卷规划/卷01/章细纲/0001-开篇任务.md')
    fs.writeFileSync(outlinePath, `${fs.readFileSync(outlinePath, 'utf-8')}\n- 〔硬〕本章不得出现火枪\n`, 'utf-8')
    putPending(root, `雨停得早。${HARD}。他回头看了一眼。`)
    expect(scanChapter(root, key).审核证据过期).toBe(true)
    // 无证明：仍拒绝迟到回写（旧行为不变）
    expect(ingestFindings(root, key, '章节结构审读', []).ok).toBe(false)
    // 错指纹：仍拒绝
    const wrong = ingestFindings(root, key, '章节结构审读', [], 'f'.repeat(64))
    expect(wrong.ok).toBe(false)
    // 当轮指纹（重跑确定性模块后拿到）：重置旧轮次后接收
    const current = computeReview(root, key)
    expect(current.ok).toBe(true)
    const fingerprint = current.record!.审读指纹
    const rerun = ingestFindings(root, key, '章节结构审读', [
      { 问题说明: '门洞一句不通', 证据位置: '第三段', 影响范围: '正文' },
    ], fingerprint)
    expect(rerun.ok).toBe(true)
    const record = rerun.record!
    // 旧完成态重置：刚回写一个模块，其余须重跑
    expect(record.完成).toBe(false)
    expect(Object.values(record.模块).filter((st) => st.完成 === true)).toHaveLength(1)
    // 处置认亲：同一三元组的旧处置沿用
    const inherited = record.问题.find((p) => p.模块名 === '章节结构审读')
    expect(inherited?.处置状态).toBe('作者保留')
    // 作者意见跨稿保留
    expect(record.问题.some((p) => p.模块名 === '作者意见' && p.问题说明 === '开头再冷一点')).toBe(true)
    // 指纹已刷新到当前输入
    expect(record.审读指纹).toBe(fingerprint)
    // 第二轮继续回写：不再需要证明（记录已不陈旧）
    expect(ingestFindings(root, key, '文本规范检查', []).ok).toBe(true)
  })

  it('重置后逐模块回写至全部完成，推导可进定稿准备', () => {
    const root = mkBook()
    confirmWithHard(root)
    assembleMaterials(root, key)
    putPending(root, `巷口风大。${HARD}。他没有回头。`)
    expect(runReview(root, key).ok).toBe(true)
    ingestAll(root)
    expect(loadReviewRecord(root, key)!.完成).toBe(true)
    putPending(root, `雨停得早。${HARD}。他回头看了一眼。`)
    const fingerprint = computeReview(root, key).record!.审读指纹
    // 模拟脚本当轮全量重跑：确定性模块按名逐个带回当前发现项
    const deterministic = ['文本规范检查', '设定与时序核对']
    for (const name of deterministic) {
      const r = ingestFindings(root, key, name, [], fingerprint)
      expect(r.ok).toBe(true)
    }
    // 语义模块回写不需要再带指纹（全部注册模块按名逐个回写）
    for (const name of listChecks().filter((c) => c.执行形态 !== '作者').map((c) => c.名称)) {
      const r = ingestFindings(root, key, name, [])
      expect(r.ok, name).toBe(true)
    }
    const record = loadReviewRecord(root, key)!
    expect(record.完成).toBe(true)
    expect(record.问题).toEqual([])
  })
})

describe('待回写模块与完成同源（#162 回归）', () => {
  const allModules = () => listChecks().filter((c) => c.执行形态 !== '作者').map((c) => c.名称)

  it('首轮不预建记录逐模块回写：待回写模块＝注册全集减已回写，为空当且仅当完成', () => {
    const root = mkBook()
    confirmWithHard(root)
    assembleMaterials(root, key)
    putPending(root, `巷口风大。${HARD}。他没有回头。`)
    const names = allModules()
    for (const [i, name] of names.entries()) {
      const r = ingestFindings(root, key, name, [])
      expect(r.ok, name).toBe(true)
      expect(r.待回写模块).toEqual(names.slice(i + 1))
      expect(r.record!.完成).toBe(i === names.length - 1)
    }
  })

  it('带指纹重置后：刚回写的模块之外全部列为待回写', () => {
    const root = mkBook()
    confirmWithHard(root)
    assembleMaterials(root, key)
    putPending(root, `巷口风大。${HARD}。他没有回头。`)
    expect(runReview(root, key).ok).toBe(true)
    ingestAll(root)
    putPending(root, `雨停得早。${HARD}。他回头看了一眼。`)
    const r = ingestFindings(root, key, '文本规范检查', [], computeReview(root, key).record!.审读指纹)
    expect(r.ok).toBe(true)
    expect(r.record!.完成).toBe(false)
    expect(r.待回写模块).toEqual(allModules().filter((name) => name !== '文本规范检查'))
  })
})
