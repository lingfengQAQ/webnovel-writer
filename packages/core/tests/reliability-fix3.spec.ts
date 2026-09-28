import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  classifyHardConstraint, computeMaterials, confirmOutline, draftHashOf,
  loadReviewRecord, paths, scanChapter, seedMinDesign, serializeDocument,
  writeCandidate, writeReviewRecord,
} from '../src/index'
import { ingestFindings, registerDefaultChecks, resetChecks, runCanonCheck, runReview } from '@webnovel/review'
import { checkFidelity } from '@webnovel/polish'

const roots: string[] = []
const key = { 卷: 1, 章: 51, 章名: '审计章' } as const

function put(root: string, rel: string, text: string): void {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, 'utf8')
}

function makeBook(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-rel3-'))
  roots.push(root)
  seedMinDesign(root)
  const outline = [
    '# 章细纲', '', '## 定位段', '',
    '### 来源窗口项及拆并关系', '审计章，单章承接', '',
    '### 章节功能', '', '- 〔硬〕本章必须出现铜符', '',
    '### 视角与焦点', '主角视角', '',
    '### 时空锚定', '城门口', '',
    '### 起止边界', '本章全程', '',
    '### 故事线与承诺分配', '推进主线', '',
    '### 信息边界', '只披露主角所见', '',
    '### 情绪与节奏目标', '平缓', '',
    '### 前置条件核对结果', '已核对', '',
    '## 细纲段', '', '### 单元 1', '',
    '- 目标: 推进', '- 人物: 主角', '- 时空: 城门',
    '- 行动/冲突: 观察', '- 信息披露: 无', '- 状态变化: 警觉', '',
  ].join('\n')
  writeCandidate(root, { 卷: key.卷, 章: key.章, 章名: key.章名, 来源引用: ['作品契约/契约.md@1'], body: outline })
  put(root, '大纲/卷规划/卷01/近期窗口.md', '# 近期窗口\n\n- 审计章 〔已确认〕\n')
  const confirmed = confirmOutline(root, key)
  if (!confirmed.ok) throw new Error(confirmed.gaps.join(';'))
  put(root, `${paths.草稿目录(key.卷, key.章名)}/稿1.md`, serializeDocument({ 角色: '待审稿', 选定: true }, '主角握住铜符，走进城门。'))
  return root
}

function finishSemanticModules(root: string): void {
  const result = runReview(root, key)
  if (!result.ok || result.record === null) throw new Error(result.reason ?? 'review failed')
  for (const name of Object.keys(result.record.模块)) {
    if (result.record.模块[name]?.待回写 === true) {
      const written = ingestFindings(root, key, name, [], result.record.审读指纹)
      if (!written.ok) throw new Error(written.reason ?? 'ingest failed')
    }
  }
}

beforeEach(() => { resetChecks(); registerDefaultChecks() })
afterAll(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe('R1/R6/R7 review applicability', () => {
  it('rejects late findings after the pending draft changes', () => {
    const root = makeBook()
    finishSemanticModules(root)
    const recordPath = path.join(root, paths.审核记录(key.卷, key.章名))
    const draftPath = path.join(root, `${paths.草稿目录(key.卷, key.章名)}/稿1.md`)
    fs.writeFileSync(draftPath, serializeDocument({ 角色: '待审稿', 选定: true }, '完全不同的新稿。'), 'utf8')
    expect(scanChapter(root, key).审核证据过期).toBe(true)
    const late = ingestFindings(root, key, '章节结构审读', [])
    expect(late.ok).toBe(false)
    expect(scanChapter(root, key).审核证据过期).toBe(true)
    expect(JSON.parse(fs.readFileSync(recordPath, 'utf8')).审稿哈希).not.toBe(draftHashOf('完全不同的新稿。'))
  })

  it('does not wash an unbound legacy record into a completed current review', () => {
    const root = makeBook()
    finishSemanticModules(root)
    const record = loadReviewRecord(root, key)!
    const { 审稿哈希: _body, 审读指纹: _input, ...legacy } = record
    writeReviewRecord(root, key, legacy)
    const rerun = runReview(root, key)
    expect(rerun.ok).toBe(true)
    expect(rerun.record?.完成).toBe(false)
    expect(rerun.record?.模块['章节结构审读']?.待回写).toBe(true)
  })

  it('expires evidence when the consumed outline changes without changing prose', () => {
    const root = makeBook()
    finishSemanticModules(root)
    const outlinePath = path.join(root, paths.确认细纲(key.卷, key.章, key.章名))
    const outline = fs.readFileSync(outlinePath, 'utf8')
    fs.writeFileSync(outlinePath, `${outline}\n- 〔硬〕本章不得出现火枪\n`, 'utf8')
    expect(scanChapter(root, key).审核证据过期).toBe(true)
    expect(scanChapter(root, key).审核完成).toBe(false)
  })
})

describe('R2/R3 bounded material views', () => {
  it('keeps the earlier state when a later same-name ledger entry is out of range', () => {
    const root = makeBook()
    for (const category of ['时间线', '故事线', '人物弧线', '承诺', '线索'] as const) put(root, paths.账本(category), `# ${category}\n`)
    put(root, paths.账本('线索'), [
      '# 线索', '', '## 铜符线索', '状态：已埋', '埋设点：第50章', '预期兑现区间：第51-60章',
      '### 正文', '铜符尚未解开。', '', '## 铜符线索', '状态：已收', '来源：定稿/卷01/0199-解谜.md',
      '### 正文', '铜符谜底在199章揭晓。', '',
    ].join('\n'))
    const result = computeMaterials(root, key)
    expect(result.文件).toBeDefined()
    const section = result.文件!.find((file) => file.relPath.includes('故事线承诺线索'))!.content
    expect(section).toContain('铜符尚未解开')
    expect(section).not.toContain('199章揭晓')
  })

  it('filters future facts from worldbook, volume summary, and clue planting point', () => {
    const root = makeBook()
    for (const category of ['时间线', '故事线', '人物弧线', '承诺', '线索'] as const) put(root, paths.账本(category), `# ${category}\n`)
    put(root, '世界书/人物档案/主角.md', serializeDocument({ 状态: '已确认' }, '当前设定。\n\n### 事实@第0199章\n未来事实。'))
    put(root, paths.确认细纲(key.卷, key.章, key.章名), serializeDocument({ 状态: '已确认', 版本: 1, 来源引用: ['世界书/人物档案/主角.md@1'] }, fs.readFileSync(path.join(root, paths.确认细纲(key.卷, key.章, key.章名)), 'utf8').split('---\n').slice(-1)[0] ?? ''))
    put(root, paths.账本('线索'), '# 线索\n\n## 未来线索\n状态：已埋\n埋设点：第199章\n预期兑现区间：第200章\n### 正文\n未来线索正文。\n')
    put(root, paths.卷摘要(key.卷), '# 卷摘要\n\n第199章主角登基，第200章天下归一。')
    const result = computeMaterials(root, key)
    expect(result.文件).toBeDefined()
    const files = result.文件!
    expect(files.find((file) => file.relPath.includes('人物、关系'))!.content).not.toContain('未来事实')
    expect(files.find((file) => file.relPath.includes('故事线承诺线索'))!.content).not.toContain('未来线索')
    expect(files.find((file) => file.relPath.includes('近期正文衔接'))!.content).not.toContain('第199章')
  })
})

describe('R4/R5/R8 constraint contract', () => {
  it('does not parse semantic predicates or compound rules as a single literal rule', () => {
    expect(classifyHardConstraint('- 〔硬〕本章不得描写主角杀人').kind).toBe('需审读')
    expect(classifyHardConstraint('- 〔硬〕本章必须出现铜符，不得出现火枪').kind).toBe('需审读')
    const findings = runCanonCheck({
      bookRoot: '', key, 待审稿: '他举刀刺向敌人。',
      细纲: '# 章细纲\n\n### 章节功能\n- 〔硬〕本章不得描写主角杀人\n',
      审核编号: '审计', 材料版本: 'v1',
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.证据位置).toContain('无确定性正文位置')
  })

  it('uses the same explicit rule contract for polish fidelity', () => {
    const semantic = checkFidelity({ draft: '他扶起伤者。', polished: '他扶起伤者。', outlineText: '# 章细纲\n\n- 〔硬〕主角本章不得杀人\n' })
    expect(semantic.some((risk) => risk.kind === '硬约束缺失')).toBe(false)
    const explicit = checkFidelity({ draft: '他走过城门。', polished: '他走过城门。', outlineText: '# 章细纲\n\n- 〔硬〕本章必须出现铜符\n' })
    expect(explicit.some((risk) => risk.kind === '硬约束缺失')).toBe(true)
  })
})
