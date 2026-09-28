/**
 * 可靠性修复批 2(F1/F4/F5)验收。
 *
 * F1 语义硬约束契约:出现/禁止两类确定性规则+需审读降级;约束原句不当正文证据。
 * F4 目标章边界:材料不泄漏目标章之后的事实;未定归属标注不确定性。
 * F5 审稿哈希绑定:同稿有效、换稿失效、恢复视图准确;不加硬闸门。
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import * as os from 'node:os'
import {
  computeMaterials,
  classifyHardConstraint,
  confirmOutline,
  draftHashOf,
  seedMinDesign,
  serializeDocument,
  writeCandidate,
  paths,
  writeContract,
  type Finding,
} from '../src/index'
import { ingestFindings, registerDefaultChecks, resetChecks, runReview } from '@webnovel/review'

const roots: string[] = []
function mkBook(withGit = true): string {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'webnovel-rel2-'))
  roots.push(dir)
  seedMinDesign(dir)
  if (withGit) {
    const git = (args: readonly string[]): void => { spawnSync('git', args, { cwd: dir, windowsHide: true }) }
    git(['init'])
    git(['config', 'user.email', 'test@example.com'])
    git(['config', 'user.name', 'test'])
    git(['config', 'commit.gpgsign', 'false'])
  }
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放 */ } } })
beforeEach(() => { resetChecks(); registerDefaultChecks() })

const key = { 卷: 1, 章: 1, 章名: '开篇任务' } as const

// ── F1 ──

describe('F1:硬约束判定契约', () => {
  it('分类器:禁止出现类、必须出现类、语义类需审读', () => {
    expect(classifyHardConstraint('- 〔硬〕本章不得出现「靛蓝色旗幟」')).toEqual({ kind: '禁止', term: '靛蓝色旗幟', 出处: '禁止规则(不得出现):本章不得出现「靛蓝色旗幟」' })
    expect(classifyHardConstraint('- 〔硬〕本章必须出现郑姓旗官').kind).toBe('出现')
    const 语义 = classifyHardConstraint('- 〔硬〕主角本章不得杀人')
    expect(语义.kind).toBe('需审读')
    expect(语义.出处).toContain('主角本章不得杀人')
  })

  it('误报消除:救人叙事不再被「不得杀人」禁令误报(需审读,非违反非通过)', () => {
    const root = mkBook(false)
    const body = [
      '# 章细纲', '', '## 定位段', '',
      '### 来源窗口项及拆并关系', '开篇任务，单章承接', '',
      '### 章节功能', '', '- 〔硬〕主角本章不得杀人', '',
      '### 视角与焦点', '主角视角', '',
      '### 时空锚定', '城门口，清晨', '',
      '### 起止边界', '从抵达城门到发现异状', '',
      '### 故事线与承诺分配', '推进主线承诺', '',
      '### 信息边界', '只披露主角所见', '',
      '### 情绪与节奏目标', '紧张后留钩子', '',
      '### 前置条件核对结果', '已核对来源与窗口，前置设定均非留白', '',
      '## 细纲段', '', '### 单元 1', '',
      '- 目标: 救下遇险孩童', '- 人物: 主角', '- 时空: 城门口',
      '- 行动/冲突: 冲入人群护住孩童', '- 信息披露: 无', '- 状态变化: 警觉', '',
    ].join('\n')
    writeCandidate(root, { 卷: 1, 章: 1, 章名: key.章名, 来源引用: ['作品契约/契约.md@1', '世界书/人物档案/主角.md@1'], body })
    expect(confirmOutline(root, key).ok).toBe(true)
    const draftDir = nodePath.join(root, '草稿区/草稿/卷01-开篇任务')
    fs.mkdirSync(draftDir, { recursive: true })
    fs.writeFileSync(nodePath.join(draftDir, '稿1.md'), serializeDocument({ 角色: '待审稿', 选定: true }, '沈青梧冲进人群护住孩童，把他带到城墙上。'), 'utf-8')
    const r = runReview(root, key)
    // 不得杀人 这条没有产「违反」发现项(合规叙事),而是 需审读
    const 违反 = (r.record?.问题 ?? []).filter((f) => f.问题说明.includes('禁止规则'))
    expect(违反).toEqual([])
    const 需审读 = (r.record?.问题 ?? []).filter((f) => f.问题说明.startsWith('需审读') && f.问题说明.includes('不得杀人'))
    expect(需审读.length).toBe(1)
  })

  it('漏报堵住:正文含约束原句不再等于满足(需审读,不伪装通过)', () => {
    const root = mkBook(false)
    const body = [
      '# 章细纲', '', '## 定位段', '',
      '### 来源窗口项及拆并关系', '开篇任务，单章承接', '',
      '### 章节功能', '', '- 〔硬〕主角本章不得杀人', '',
      '### 视角与焦点', '主角视角', '',
      '### 时空锚定', '城门口，清晨', '',
      '### 起止边界', '从抵达城门到发现异状', '',
      '### 故事线与承诺分配', '推进主线承诺', '',
      '### 信息边界', '只披露主角所见', '',
      '### 情绪与节奏目标', '紧张后留钩子', '',
      '### 前置条件核对结果', '已核对来源与窗口，前置设定均非留白', '',
      '## 细纲段', '', '### 单元 1', '',
      '- 目标: 押送死囚', '- 人物: 主角', '- 时空: 城门口',
      '- 行动/冲突: 死囚念叨「主角本章不得杀人」这句话', '- 信息披露: 无', '- 状态变化: 厌恶', '',
    ].join('\n')
    writeCandidate(root, { 卷: 1, 章: 1, 章名: key.章名, 来源引用: ['作品契约/契约.md@1', '世界书/人物档案/主角.md@1'], body })
    expect(confirmOutline(root, key).ok).toBe(true)
    const draftDir = nodePath.join(root, '草稿区/草稿/卷01-开篇任务')
    fs.mkdirSync(draftDir, { recursive: true })
    fs.writeFileSync(nodePath.join(draftDir, '稿1.md'), serializeDocument({ 角色: '待审稿', 选定: true }, '死囚在囚车里反复念着「主角本章不得杀人」这句话,像在挑衅。'), 'utf-8')
    const r = runReview(root, key)
    // 旧实现:正文包含约束原句→零发现(假通过)。F1:语义类→需审读,不伪装通过
    const 需审读 = (r.record?.问题 ?? []).filter((f) => f.问题说明.startsWith('需审读'))
    expect(需审读.length).toBe(1)
    // 证据位置不得是约束原文(它是规则出处,不是正文证据)
    expect(需审读[0]!.证据位置).not.toContain('死囚在囚车里')
  })

  it('禁止类确定性规则:禁词在正文 → 违反发现项,带规则出处;不在 → 零发现', () => {
    const root = mkBook(false)
    const body = [
      '# 章细纲', '', '## 定位段', '',
      '### 来源窗口项及拆并关系', '开篇任务，单章承接', '',
      '### 章节功能', '', '- 〔硬〕本章不得出现「靛蓝色旗幟」', '',
      '### 视角与焦点', '主角视角', '',
      '### 时空锚定', '城门口，清晨', '',
      '### 起止边界', '从抵达城门到发现异状', '',
      '### 故事线与承诺分配', '推进主线承诺', '',
      '### 信息边界', '只披露主角所见', '',
      '### 情绪与节奏目标', '紧张后留钩子', '',
      '### 前置条件核对结果', '已核对来源与窗口，前置设定均非留白', '',
      '## 细纲段', '', '### 单元 1', '',
      '- 目标: 巡旗', '- 人物: 主角', '- 时空: 城门口',
      '- 行动/冲突: 发现旗色不对', '- 信息披露: 无', '- 状态变化: 疑心', '',
    ].join('\n')
    writeCandidate(root, { 卷: 1, 章: 1, 章名: key.章名, 来源引用: ['作品契约/契约.md@1', '世界书/人物档案/主角.md@1'], body })
    expect(confirmOutline(root, key).ok).toBe(true)
    const draftDir = nodePath.join(root, '草稿区/草稿/卷01-开篇任务')
    fs.mkdirSync(draftDir, { recursive: true })
    // 合规正文(无禁词)→ 零发现
    fs.writeFileSync(nodePath.join(draftDir, '稿1.md'), serializeDocument({ 角色: '待审稿', 选定: true }, '沈青梧巡看旗幟,全是玄色。'), 'utf-8')
    expect(runReview(root, key).record?.问题.filter((f) => f.模块名 === '设定与时序核对')).toEqual([])
    // 违规正文(出现禁词)→ 违反发现项,出处带规则名
    fs.writeFileSync(nodePath.join(draftDir, '稿1.md'), serializeDocument({ 角色: '待审稿', 选定: true }, '城头一面粉色的靛蓝色旗幟格外扎眼。'), 'utf-8')
    const r2 = runReview(root, key)
    const 违反 = (r2.record?.问题 ?? []).filter((f) => f.问题说明.includes('禁止规则'))
    expect(违反.length).toBe(1)
    expect(违反[0]!.问题说明).toContain('本章不得出现「靛蓝色旗幟」')
  })
})

// ── F4 ──

describe('F4:目标章边界(世界已发生)', () => {
  function writeLedgers(root: string): void {
    fs.mkdirSync(nodePath.join(root, '账本'), { recursive: true })
    fs.writeFileSync(nodePath.join(root, '账本/时间线.md'), [
      '# 时间线', '',
      '## 第51章事件', '章号：第0051章', '### 正文', '第51章发生换防', '',
      '## 第199章事件', '章号：第0199章', '### 正文', '第199章发生政变', '',
      '## 第200章事件', '章号：第0200章', '### 正文', '第200章围城', '',
      '## 时序不明事件', '### 正文', '有人影一闪而过', '',
    ].join('\n'), 'utf-8')
    fs.writeFileSync(nodePath.join(root, '账本/人物弧线.md'), [
      '# 人物弧线', '',
      '## 配角线', '类型：人物弧线', '状态：已兑现', '计划来源：大纲/故事骨架.md@1',
      '实际落点：定稿/卷01/0199-转折.md', '来源：定稿/卷01/0199-转折.md',
      '### 正文', '配角在第199章兑现', '',
    ].join('\n'), 'utf-8')
  }

  function confirmFor(root: string, 卷: number, 章: number, 章名: string): void {
    const nn = String(卷).padStart(2, '0')
    const refs = ['作品契约/契约.md@1']
    const body = [
      '# 章细纲', '', '## 定位段', '',
      '### 来源窗口项及拆并关系', `${章名}，单章承接`, '',
      '### 章节功能', '', '- 〔软〕推进主线', '',
      '### 视角与焦点', '主角视角', '',
      '### 时空锚定', '城门口', '',
      '### 起止边界', `${章名}全程`, '',
      '### 故事线与承诺分配', '推进主线', '',
      '### 信息边界', '只披露主角所见', '',
      '### 情绪与节奏目标', '平缓', '',
      '### 前置条件核对结果', '已核对', '',
      '## 细纲段', '', '### 单元 1', '',
      '- 目标: 推进', '- 人物: 主角', '- 时空: 城门',
      '- 行动/冲突: 推进', '- 信息披露: 无', '- 状态变化: 推进', '',
    ].join('\n')
    writeCandidate(root, { 卷, 章, 章名, 来源引用: refs, body })
    // 近期窗口须有匹配条目,确认门槛才过
    fs.mkdirSync(nodePath.join(root, '大纲/卷规划', `卷${nn}`), { recursive: true })
    if (!fs.existsSync(nodePath.join(root, '大纲/卷规划', `卷${nn}`, '近期窗口.md'))) {
      fs.writeFileSync(nodePath.join(root, '大纲/卷规划', `卷${nn}`, '近期窗口.md'), `# 近期窗口\n\n- ${章名} 〔已确认〕\n`, 'utf-8')
    }
    const c = confirmOutline(root, { 卷, 章, 章名 })
    if (!c.ok) throw new Error(`confirm failed:${c.gaps.join(';')}`)
  }

  function segOf(root: string, 卷: number, 章: number, 章名: string): string {
    const r = computeMaterials(root, { 卷, 章, 章名 })
    expect(r.ok).toBe(true)
    if (!r.ok) return ''
    return r.文件?.find((f) => f.relPath.includes('03-当前事实与连续性'))?.content ?? ''
  }
  function seg51(root: string): string {
    return segOf(root, 51, 51, '换防')
  }
  function seg200(root: string): string {
    return segOf(root, 200, 200, '围城')
  }

  it('第 51 章材料:不含第 199/200 章事实', () => {
    const root = mkBook(false)
    writeLedgers(root)
    confirmFor(root, 51, 51, '换防')
    const seg = seg51(root)
    expect(seg).toContain('第51章发生换防')
    expect(seg).not.toContain('第199章发生政变')
    expect(seg).not.toContain('第200章围城')
    expect(seg).not.toContain('配角线')
  })

  it('第 200 章材料:历史事实(第51章)仍可见', () => {
    const root = mkBook(false)
    writeLedgers(root)
    confirmFor(root, 200, 200, '围城')
    const seg = seg200(root)
    expect(seg).toContain('第51章发生换防')
  })

  it('时序未定条目 → 正文带来源与不确定性标注;清单选用原因记录条数', () => {
    const root = mkBook(false)
    writeLedgers(root)
    confirmFor(root, 51, 51, '换防')
    const seg = seg51(root)
    expect(seg).toContain('时序未定;来源:账本/时间线.md')
    const r = computeMaterials(root, { 卷: 51, 章: 51, 章名: '换防' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const record = r.段.find((x) => x.段 === '当前事实与连续性')
    expect(record?.选用原因).toContain('时序未定条目')
  })
})

describe('F5:审稿哈希绑定', () => {
  function setup(root: string, 正文: string): void {
    const refs = ['作品契约/契约.md@1']
    const body = [
      '# 章细纲', '', '## 定位段', '',
      '### 来源窗口项及拆并关系', '开篇任务，单章承接', '',
      '### 章节功能', '', '- 〔软〕推进开场', '',
      '### 视角与焦点', '主角视角', '',
      '### 时空锚定', '城门口，清晨', '',
      '### 起止边界', '从抵达城门到发现异状', '',
      '### 故事线与承诺分配', '推进主线承诺', '',
      '### 信息边界', '只披露主角所见', '',
      '### 情绪与节奏目标', '紧张后留钩子', '',
      '### 前置条件核对结果', '已核对来源与窗口，前置设定均非留白', '',
      '## 细纲段', '', '### 单元 1', '',
      '- 目标: 就任', '- 人物: 主角', '- 时空: 城门',
      '- 行动/冲突: 接印', '- 信息披露: 无', '- 状态变化: 到任', '',
    ].join('\n')
    writeCandidate(root, { 卷: 1, 章: 1, 章名: key.章名, 来源引用: refs, body })
    expect(confirmOutline(root, key).ok).toBe(true)
    const draftDir = nodePath.join(root, '草稿区/草稿/卷01-开篇任务')
    fs.mkdirSync(draftDir, { recursive: true })
    fs.writeFileSync(nodePath.join(draftDir, '稿1.md'), serializeDocument({ 角色: '待审稿', 选定: true }, 正文), 'utf-8')
    const r = runReview(root, key)
    if (!r.ok) throw new Error(`runReview failed:${r.reason ?? ''}`)
    // 回写全部隔离子 Agent 模块(空审 fail-closed:回写后才算完成)
    for (const [name, st] of Object.entries(r.record?.模块 ?? {})) {
      if (st.待回写 === true) {
        expect(ingestFindings(root, key, name, [], r.record!.审读指纹).ok).toBe(true)
      }
    }
  }

  it('同稿:审核完成事实保持,记录绑定该稿哈希', () => {
    const root = mkBook()
    setup(root, '沈青梧接印,查看城防。')
    const rec = JSON.parse(fs.readFileSync(nodePath.join(root, '草稿区/审核/卷01-开篇任务.json'), 'utf-8'))
    expect(typeof rec.审稿哈希).toBe('string')
    expect(rec.完成).toBe(true)
  })

  it('正文改变(作者导入不同新稿) → 完成事实翻转 false,叠加过期标记;作者仍可推进', () => {
    const root = mkBook()
    setup(root, '沈青梧接印,查看城防。')
    const before = JSON.parse(fs.readFileSync(nodePath.join(root, '草稿区/审核/卷01-开篇任务.json'), 'utf-8'))
    expect(before.完成).toBe(true)
    // 作者导入完全不同的新稿
    const draftDir = nodePath.join(root, '草稿区/草稿/卷01-开篇任务')
    fs.writeFileSync(nodePath.join(draftDir, '稿2.md'), serializeDocument({ 角色: '待审稿', 选定: true, 生成模块: '作者手改' }, '完全重写的另一版正文,内容天差地别。'), 'utf-8')
    fs.rmSync(nodePath.join(draftDir, '稿1.md'), { force: true })
    const scan = scanChapter(root, key)
    // 审核完成事实因哈希失配不再成立;叠加标记提示过期
    expect(scan.审核完成).toBe(false)
    expect(scan.审核证据过期).toBe(true)
    expect(scan.需复核标记.some((m) => m.includes('过期'))).toBe(true)
  })

  it('恢复视图:旧记录完成后导入新稿,derive 停在审核(须重审),不冒充定稿准备', () => {
    const root = mkBook()
    setup(root, '沈青梧接印,查看城防。')
    const draftDir = nodePath.join(root, '草稿区/草稿/卷01-开篇任务')
    fs.writeFileSync(nodePath.join(draftDir, '稿2.md'), serializeDocument({ 角色: '待审稿', 选定: true }, '重写稿。'), 'utf-8')
    fs.rmSync(nodePath.join(draftDir, '稿1.md'), { force: true })
    const facts = deriveFacts(root)
    expect(facts.建议.环节).toBe('审核')
  })
})

// 辅助:不经 derive 的轻量事实调用(从 core 导出 scanChapter/deriveChapterFacts)
import { scanChapter, deriveChapterFacts } from '../src/index'
function deriveFacts(root: string): ReturnType<typeof deriveChapterFacts> {
  return deriveChapterFacts(scanChapter(root, key))
}
