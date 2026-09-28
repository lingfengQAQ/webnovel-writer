/**
 * M1 改稿全链验收（08-25-m1-revision-full-chain，2026-09-05 解冻实施）。
 *
 * 覆盖 prd Acceptance：待处理+补丁拒绝／真源呈报／已解决补丁必须命中／ingestAuthorRevision
 * 原样落盘＋处置不动／后续范围报告＋硬约束回查失败不阻断／作者意见无记录拒、重跑保留／diff 重放。
 * 轮次上限按 B1 不进代码（不测 atCap/bottleneck）。
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { seedMinDesign, serializeDocument, writeCandidate, confirmOutline } from '../src/index'
import { applyRevision, ingestAuthorRevision, replayLines } from '../src/revise'
import { parseDocument } from '../src/repo/frontmatter'
import { registerDefaultChecks, resetChecks, runReview, recordAuthorFinding, computeReview, ingestFindings } from '@webnovel/review'

const roots: string[] = []
function mkBook(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-m1-'))
  roots.push(dir)
  seedMinDesign(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放 */ } } })
beforeEach(() => { resetChecks(); registerDefaultChecks() })

const key = { 卷: 1, 章: 1, 章名: '开篇任务' } as const
const HARD = '开场必须点名主角现身'

function readyBook(root: string, 正文: string): void {
  const refs = ['作品契约/契约.md@1', '世界书/人物档案/主角.md@1']
  const body = [
    '# 章细纲', '',
    '## 定位段', '',
    '### 来源窗口项及拆并关系', '开篇任务，单章承接', '',
    '### 章节功能', '',
    `- 〔硬〕${HARD}`, '',
    '### 视角与焦点', '主角视角', '',
    '### 时空锚定', '城门口，清晨', '',
    '### 起止边界', '从抵达城门到发现异状', '',
    '### 故事线与承诺分配', '推进主线承诺', '',
    '### 信息边界', '只披露主角所见', '',
    '### 情绪与节奏目标', '紧张后留钩子', '',
    '### 前置条件核对结果', '已核对来源与窗口，前置设定均非留白', '',
    '## 细纲段', '', '### 单元 1', '',
    '- 目标: 找到异常', '- 人物: 主角', '- 时空: 城门口',
    '- 行动/冲突: 盘问与发现', '- 信息披露: 异常线索', '- 状态变化: 从平静到警觉', '',
  ].join('\n')
  writeCandidate(root, { 卷: 1, 章: 1, 章名: key.章名, 来源引用: refs, body })
  const r = confirmOutline(root, key)
  if (!r.ok) throw new Error(`confirm failed:${r.gaps.join(';')}`)
  fs.mkdirSync(path.join(root, '草稿区/草稿/卷01-开篇任务'), { recursive: true })
  fs.writeFileSync(path.join(root, '草稿区/草稿/卷01-开篇任务/稿1.md'), serializeDocument({ 角色: '待审稿', 选定: true }, 正文), 'utf-8')
}

const BASE = `沈青梧走进城门，开场必须点名主角现身的规矩她记得清楚。

守门的兵卒抬了抬下巴。`

function withRecord(root: string): void {
  readyBook(root, BASE)
  const r = runReview(root, key)
  if (!r.ok) throw new Error(`runReview failed:${r.reason ?? ''}`)
  // 干净正文零确定性发现项;补一条语义发现项作为可处置对象(处置编号由回写生成)
  const w = ingestFindings(root, key, '章节结构审读', [{
    证据位置: '草稿区/草稿/卷01-开篇任务/稿1.md:1',
    问题说明: '开场节奏偏快,接印一段可再压半句',
    严重程度: '建议',
    是否建议阻断: false,
    影响范围: '本章草稿',
    修改建议: '补一句交接仪式的过渡',
  }], r.record!.审读指纹)
  if (!w.ok) throw new Error(`ingestFindings failed:${w.reason ?? ''}`)
}

const FINDING = '审-01-0001-章节结构审读-1'

describe('M1:applyRevision 契约加固', () => {
  it('待处理 带补丁 → 拒绝，零写入', () => {
    const root = mkBook()
    withRecord(root)
    const before = fs.readFileSync(path.join(root, '草稿区/草稿/卷01-开篇任务/稿1.md'), 'utf-8')
    const r = applyRevision(root, key, {
      发现项编号: FINDING, 处置: '待处理',
      补丁: { old: '沈青梧', new: '别人' },
    })
    expect(r.ok).toBe(false)
    expect(fs.readFileSync(path.join(root, '草稿区/草稿/卷01-开篇任务/稿1.md'), 'utf-8')).toBe(before)
  })

  it('已解决 带未命中补丁 → 失败；带命中补丁 → 产新稿+diff+followup，原稿降级', () => {
    const root = mkBook()
    withRecord(root)
    const 编号 = FINDING
    const bad = applyRevision(root, key, {
      发现项编号: 编号, 处置: '已解决',
      补丁: { old: '这句话不存在于待审稿', new: 'x' },
    })
    expect(bad.ok).toBe(false)

    const r = applyRevision(root, key, {
      发现项编号: 编号, 处置: '已解决',
      补丁: { old: '守门的兵卒抬了抬下巴。', new: '守门的兵卒抬了抬下巴，多看了一眼她的旗牌。' },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.relPath).toBe('草稿区/草稿/卷01-开篇任务/稿2.md')
    expect(r.diff?.some((d) => d.kind === '增' && d.text.includes('多看了一眼她的旗牌'))).toBe(true)
    expect(r.followup).toBeDefined()
    // 原稿降级留档
    const old = parseDocument(fs.readFileSync(path.join(root, '草稿区/草稿/卷01-开篇任务/稿1.md'), 'utf-8'))
    expect(old.ok && old.data.fields['角色']).not.toBe('待审稿')
  })

  it('真源范围 → 须呈报上游,不写草稿', () => {
    const root = mkBook()
    withRecord(root)
    const r = applyRevision(root, key, {
      发现项编号: FINDING, 处置: '已接受修改',
      补丁: { old: 'a', new: 'b' }, 范围: '世界书/人物档案/主角.md',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('须呈报上游')
  })

  it('不带补丁只改处置 → 不产新稿,返回含 followup', () => {
    const root = mkBook()
    withRecord(root)
    const r = applyRevision(root, key, { 发现项编号: FINDING, 处置: '作者保留' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.relPath).toBeUndefined()
    expect(r.followup).toBeDefined()
  })
})

describe('M1:ingestAuthorRevision 原样落盘', () => {
  it('整章正文原样写入(含换行与标点),生成模块=作者手改,发现项处置不动', () => {
    const root = mkBook()
    withRecord(root)
    const before = JSON.parse(fs.readFileSync(path.join(root, '草稿区/审核/卷01-开篇任务.json'), 'utf-8'))
    const 正文 = BASE.replace('守门的兵卒抬了抬下巴。', '守门的兵卒没抬下巴——他在看别处。\n\n这一眼很長。')
    const r = ingestAuthorRevision(root, key, 正文)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const doc = parseDocument(fs.readFileSync(path.join(root, r.relPath), 'utf-8'))
    expect(doc.ok).toBe(true)
    if (!doc.ok) return
    expect(doc.data.body.replace(/\n+$/, '')).toBe(正文.replace(/\r\n/g, '\n').replace(/\n+$/, ''))
    expect(doc.data.fields['生成模块']).toBe('作者手改')
    expect(doc.data.fields['角色']).toBe('待审稿')
    const after = JSON.parse(fs.readFileSync(path.join(root, '草稿区/审核/卷01-开篇任务.json'), 'utf-8'))
    expect(after.问题.map((q: { 处置状态: string }) => q.处置状态)).toEqual(before.问题.map((q: { 处置状态: string }) => q.处置状态))
  })

  it('语义类硬约束 → followup.需语义审读 非空(F1:确定性代码不判定语义);ok:true', () => {
    const root = mkBook()
    withRecord(root)
    const r = ingestAuthorRevision(root, key, '一段完全不含硬约束内容的正文。')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.followup.需语义审读.length).toBeGreaterThan(0)
  })

  it('出现类硬约束(必须出现X) → 正文缺 X 时回查失败', () => {
    const root = mkBook()
    withRecord(root)
    // 细纲硬约束另加一条出现类:必须出现「郑姓旗官」
    const 细纲相对 = '大纲/卷规划/卷01/章细纲/0001-开篇任务.md'
    const 原文 = fs.readFileSync(path.join(root, 细纲相对), 'utf-8')
    fs.writeFileSync(path.join(root, 细纲相对), 原文.replace('- 〔硬〕开场必须点名主角现身', '- 〔硬〕本章必须出现「郑姓旗官」'), 'utf-8')
    const r = ingestAuthorRevision(root, key, '一段平淡的过场正文。')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.followup.硬约束回查失败.some((l) => l.includes('郑姓旗官'))).toBe(true)
    const r2 = ingestAuthorRevision(root, key, '郑姓旗官在城门口等着她。')
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.followup.硬约束回查失败).toEqual([])
  })

  it('diff 可重放:父版本正文 + diff 得到新正文', () => {
    const root = mkBook()
    withRecord(root)
    const r = ingestAuthorRevision(root, key, BASE + '\n\n结尾多了一段。')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const doc = parseDocument(fs.readFileSync(path.join(root, r.relPath), 'utf-8'))
    if (!doc.ok) throw new Error('parse failed')
    expect(replayLines(BASE, r.diff)).toBe(doc.data.body.replace(/\n+$/, ''))
  })

  it('无待审稿 → 拒绝', () => {
    const root = mkBook()
    readyBook(root, BASE)
    fs.rmSync(path.join(root, '草稿区/草稿/卷01-开篇任务'), { recursive: true, force: true })
    const r = ingestAuthorRevision(root, key, BASE)
    expect(r.ok).toBe(false)
  })
})

describe('M1:recordAuthorFinding 作者意见', () => {
  it('无审核记录 → 拒绝,不凭空建记录', () => {
    const root = mkBook()
    readyBook(root, BASE)
    const r = recordAuthorFinding(root, key, { 问题说明: '节奏太赶' })
    expect(r.ok).toBe(false)
    expect(fs.existsSync(path.join(root, '草稿区/审核/卷01-开篇任务.json'))).toBe(false)
  })

  it('有记录 → 意见入账(模块名=作者意见),草稿字节不变;重跑审核不丢、不计完成判定', () => {
    const root = mkBook()
    withRecord(root)
    const draftBefore = fs.readFileSync(path.join(root, '草稿区/草稿/卷01-开篇任务/稿1.md'), 'utf-8')
    const r = recordAuthorFinding(root, key, { 问题说明: '第二章前先把旗令制度交代清楚', 修改建议: '在单元2补一句制度来源' })
    expect(r.ok).toBe(true)
    expect(fs.readFileSync(path.join(root, '草稿区/草稿/卷01-开篇任务/稿1.md'), 'utf-8')).toBe(draftBefore)

    // 重跑审核(确定性重算),作者意见条目保留且处置不丢
    const re = recordAuthorFinding(root, key, { 问题说明: '第二章前先把旗令制度交代清楚' })
    expect(re.ok).toBe(true)
    runReview(root, key)
    const loaded = JSON.parse(fs.readFileSync(path.join(root, '草稿区/审核/卷01-开篇任务.json'), 'utf-8'))
    const opinions = loaded.问题.filter((q: { 模块名: string }) => q.模块名 === '作者意见')
    expect(opinions.length).toBe(1)
    expect(opinions[0]!.问题说明).toContain('旗令制度')

    // computeReview 同样保留(脚本只算路径)
    const c = computeReview(root, key)
    expect(c.ok && c.record?.问题.some((q) => q.模块名 === '作者意见')).toBe(true)
  })
})
