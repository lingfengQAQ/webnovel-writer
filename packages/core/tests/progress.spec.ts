import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { activeChapterLine, listConfirmedEmpty, parseVolumeAllocations, renderBookProgress, scanDesign, scanDesignDetail, selectCurrentVolume, seedMinDesign, writePending, serializeDocument } from '../src/index'
import type { LastCommitResult } from '../src/commit/history'

const roots: string[] = []
function mkBook(seed = false): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-progress-'))
  roots.push(dir)
  if (seed) seedMinDesign(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放 */ } } })

describe('scanDesignDetail(现算明细)', () => {
  it('seed 后:契约六部全量、骨架九部、世界书计数、窗口余量', () => {
    const root = mkBook(true)
    const d = scanDesignDetail(root)
    expect(d.契约.分部).toHaveLength(6)
    expect(d.契约.分部.every((p) => p.状态 === '已确认')).toBe(true)
    expect(d.骨架.分部).toHaveLength(9)
    expect(d.世界书.各模块).toEqual(expect.arrayContaining([
      expect.objectContaining({ 名称: '人物档案', 条目数: 1, 已确认数: 1 }),
    ]))
    const v1 = d.卷规划.find((v) => v.卷号 === 1)
    expect(v1?.近期窗口.条目).toEqual([{ 名称: '开篇任务', 状态: '已确认' }])
    expect(v1?.近期窗口.余量).toBe(1)
    expect(d.章进度.活跃章).toEqual({ 卷: 1, 章: 0, 章名: '开篇任务' })
  })

  it('新建空书仓:各段为空、世界书未声明模块可见', () => {
    const root = mkBook(false)
    fs.mkdirSync(path.join(root, '世界书/未声明模块'), { recursive: true })
    const d = scanDesignDetail(root)
    expect(d.契约.分部).toEqual([])
    expect(d.卷规划).toEqual([])
    expect(d.世界书.未声明模块).toContain('未声明模块')
    expect(d.章进度.已定稿).toEqual([])
  })
})

describe('待补便签(算不出来的才落盘)', () => {
  it('写入、明细读出、清除;不存在的节报明确错误', () => {
    const root = mkBook(true)
    const rel = '大纲/故事骨架.md'
    const r = writePending(root, rel, '线索悬念伏笔', '第二卷前需补暗线落点')
    expect(r.ok).toBe(true)
    expect(fs.readFileSync(path.join(root, rel), 'utf-8')).toContain('待补：第二卷前需补暗线落点')
    const d = scanDesignDetail(root)
    const part = d.骨架.分部.find((p) => p.名称 === '线索悬念伏笔')
    expect(part?.待补).toEqual(['第二卷前需补暗线落点'])

    // 清除
    expect(writePending(root, rel, '线索悬念伏笔', null).ok).toBe(true)
    expect(fs.readFileSync(path.join(root, rel), 'utf-8')).not.toContain('待补：')
    expect(scanDesignDetail(root).骨架.分部.find((p) => p.名称 === '线索悬念伏笔')?.待补).toEqual([])

    // 不存在的节
    const bad = writePending(root, rel, '不存在的节', 'x')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toContain('没有分节')
  })
})

describe('已确认但无内容(#165,只提示不参与推导)', () => {
  it('未标注的同级标题也截断正文范围,空子标题与注释不冒充设计内容', () => {
    const root = mkBook()
    fs.mkdirSync(path.join(root, '大纲'), { recursive: true })
    fs.writeFileSync(path.join(root, '大纲/故事骨架.md'), [
      '# 故事骨架', '',
      '## 主角目标与成长轨迹 〔已确认〕', '',
      '## 讨论备忘', '这段备注不属于前一部。', '',
      '## 核心冲突与对抗力量 〔已确认〕', '### 对手', '',
      '## 信息披露 〔已确认〕', '<!--', '之后补充这部分', '-->', '',
      '## 读者承诺与兑现 〔已确认〕', '### 卷末兑现', '主角找回遗失的信。', '',
    ].join('\n'), 'utf-8')
    expect(listConfirmedEmpty(scanDesignDetail(root))).toEqual([
      '故事骨架·主角目标与成长轨迹', '故事骨架·核心冲突与对抗力量', '故事骨架·信息披露',
    ])
  })

  it('只有标注的已确认分部才标;标题分部下级卷行、列表行内说明、后续正文都算内容;待补便签不算', () => {
    const root = mkBook()
    fs.mkdirSync(path.join(root, '大纲'), { recursive: true })
    fs.writeFileSync(path.join(root, '大纲/故事骨架.md'), [
      '# 故事骨架', '',
      '## 主角目标与成长轨迹 〔已确认〕', '', '从杂役到宗主。', '',
      '## 核心冲突与对抗力量 〔已确认〕', '', '待补：对手动机', '',
      '## 故事阶段与关键转折 〔留白〕', '',
      '- 主线与支线：复仇为主，师门为辅 〔已确认〕',
      '- 线索悬念伏笔 〔已确认〕',
      '  身世之谜贯穿全书',
      '- 信息披露 〔已确认〕',
      '',
    ].join('\n'), 'utf-8')
    fs.writeFileSync(path.join(root, '大纲/分卷布局.md'), ['# 分卷布局', '', '## 故事阶段分配 〔已确认〕', '', '- 卷01：入门立足 〔已确认〕', ''].join('\n'), 'utf-8')
    const d = scanDesignDetail(root)
    const empty = (parts: readonly { 名称: string; 无内容?: true }[]) => parts.filter((p) => p.无内容 === true).map((p) => p.名称)
    expect(empty(d.骨架.分部)).toEqual(['核心冲突与对抗力量', '信息披露'])
    expect(empty(d.分卷.分部)).toEqual([])
    expect(listConfirmedEmpty(d)).toEqual(['故事骨架·核心冲突与对抗力量', '故事骨架·信息披露'])
  })

  it('seed 占位设计:契约、骨架、空卷行与无正文世界书条目全部列出;推导仍判开写就绪', () => {
    const root = mkBook(true)
    const empty = listConfirmedEmpty(scanDesignDetail(root))
    expect(empty).toHaveLength(18)
    expect(empty).toEqual(expect.arrayContaining(['契约·叙事方式与文风基调', '分卷布局·卷01', '世界书·世界规则/基础规则']))
    // 卷纲「叙事结构」下有一行说明,不算空
    expect(empty.some((e) => e.startsWith('卷01卷纲'))).toBe(false)
    expect(scanDesign(root).骨架当前阶段已确认).toBe(true)
  })
})

describe('书级进度卡渲染(纯函数,固定输入固定输出)', () => {
  const never: LastCommitResult = { ok: false, kind: 'never', detail: 'x' }
  const scoped: LastCommitResult = { ok: true, prefix: 'design(ch0007)', summary: '确认细纲', hash: 'abc', chapter: { 卷: null, 章: 7 } }

  it('按固定输入产出固定输出;余量≤2 标见底;从未提交显示未提交', () => {
    const root = mkBook(true)
    const detail = scanDesignDetail(root)
    const out = renderBookProgress(detail, { '大纲/故事骨架.md': never, '作品契约/契约.md': scoped }, ['卷末锚点未兑现'])
    expect(out).toContain('【书级进度卡】')
    // seed 只写占位确认态:只有标注没有正文的分部逐行标「无内容」,卡首汇总条数
    expect(out).toContain('已确认但无内容：18 处')
    expect(out).toContain('题材与读者定位〔已确认〕（无内容）｜第0007章')
    expect(out).toContain('主角目标与成长轨迹〔已确认〕（无内容）｜未提交')
    expect(out).toContain('人物档案：1条（已确认 1；无正文：主角）')
    expect(out).toContain('近期窗口余量 1（见底，需滚动补充）')
    expect(out).toContain('本卷未决偏离：1 条（卷末锚点未兑现）')
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    // 固定输入固定输出
    const again = renderBookProgress(detail, { '大纲/故事骨架.md': never, '作品契约/契约.md': scoped }, ['卷末锚点未兑现'])
    expect(again).toBe(out)
  })
})

describe('activeChapterLine(每轮 context 瘦身)', () => {
  it('一行固定形状;连续两次求值完全相同', () => {
    const root = mkBook(true)
    const first = activeChapterLine(root)
    expect(first.ok).toBe(true)
    if (!('行' in first)) return
    expect(first.行).toBe('卷01 第0000章 开篇任务 · 章细纲(待定位)')
    const second = activeChapterLine(root)
    expect(second).toEqual(first)
  })

  it('有多卷动静时当前卷取最近有定稿的卷', () => {
    const root = mkBook(true)
    fs.mkdirSync(path.join(root, '定稿/卷02'), { recursive: true })
    fs.writeFileSync(path.join(root, '定稿/卷02/0009-风波.md'), serializeDocument({ 状态: '已定稿' }, '正文\n'), 'utf-8')
    fs.mkdirSync(path.join(root, '大纲/卷规划/卷02'), { recursive: true })
    fs.writeFileSync(path.join(root, '大纲/卷规划/卷02/近期窗口.md'), '# 近期窗口\n\n- 第十章 〔已确认〕\n\n', 'utf-8')
    const r = activeChapterLine(root)
    if (!('ok' in r) || !r.ok || !('行' in r)) return
    expect(r.行).toContain('卷02')
  })
})

describe('activeChapterLine 窗口见底(任务19, F-002)', () => {
  /** 建「窗口全部已消费＋本卷定稿 N 章」的见底现场;卷纲体量行按需声明本卷章数。 */
  function mkBottomedBook(input: { 卷?: number; 体量行: string | null; 定稿章号: number[]; 时间线?: string }): string {
    const 卷 = input.卷 ?? 1
    const root = mkBook(true)
    const 卷NN = String(卷).padStart(2, '0')
    const 卷目录 = path.join(root, `大纲/卷规划/卷${卷NN}`)
    fs.mkdirSync(卷目录, { recursive: true })
    const outline = ['# 卷纲', '']
    if (input.体量行 !== null) outline.push(input.体量行, '')
    outline.push('## 叙事结构 〔已确认〕', '', '占位', '')
    fs.writeFileSync(path.join(卷目录, '卷纲.md'), outline.join('\n'), 'utf-8')
    fs.writeFileSync(path.join(卷目录, '近期窗口.md'), '# 近期窗口\n\n- 已写完的章 〔已消费〕\n', 'utf-8')
    if (input.时间线 !== undefined) {
      fs.writeFileSync(path.join(卷目录, '计划时间线.md'), input.时间线, 'utf-8')
    }
    for (const n of input.定稿章号) {
      const dir = path.join(root, `定稿/卷${卷NN}`)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, `${String(n).padStart(4, '0')}-第${n}章.md`), serializeDocument({ 状态: '已定稿' }, '正文\n'), 'utf-8')
    }
    return root
  }
  const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i)

  it('卷纲明写17章、定稿11章、窗口耗尽 → 滚动补充(11/17),两次求值相同', () => {
    const root = mkBottomedBook({ 体量行: '卷01·改字无印（清河县）｜4 案／17 章，单章约 2000 字', 定稿章号: range(1, 11) })
    const r = activeChapterLine(root)
    expect(r.ok).toBe(true)
    if (!('行' in r)) return
    expect(r.行).toContain('滚动补充')
    expect(r.行).toContain('11')
    expect(r.行).toContain('17')
    expect(r.行).toBe('卷01 已定稿 11 章，近期窗口无可进入条目，先滚动补充（卷纲 17 章）')
    expect(activeChapterLine(root)).toEqual(r)
  })

  it('定稿达到卷纲章数 → 已全部完成', () => {
    const root = mkBottomedBook({ 体量行: '卷01·改字无印（清河县）｜4 案／17 章，单章约 2000 字', 定稿章号: range(1, 17) })
    const r = activeChapterLine(root)
    if (!('行' in r)) return
    expect(r.行).toContain('已全部完成')
  })

  it('卷纲无章数声明、窗口耗尽 → 完成情况未知(不带数字)', () => {
    const root = mkBottomedBook({ 体量行: '卷01·改字无印（清河县）｜4 案，单章约 2000 字', 定稿章号: range(1, 11) })
    const r = activeChapterLine(root)
    if (!('行' in r)) return
    expect(r.行).toBe('卷01 近期窗口无可进入条目，本卷完成情况未知，请核对卷纲后滚动补充')
    expect(r.行).not.toContain('已定稿')
    expect(r.行).not.toContain('17')
  })

  it('反例:卷二明写15章、章号18–32全书连续、本卷15章定稿 → 判完成(不取最大章号)', () => {
    const root = mkBottomedBook({ 卷: 2, 体量行: '卷02·誊正（江州府城）｜3 案／15 章，单章约 2000 字', 定稿章号: range(18, 32) })
    const r = activeChapterLine(root)
    if (!('行' in r)) return
    expect(r.行).toContain('卷02')
    expect(r.行).toContain('已全部完成')
  })

  it('反例:仅时间线局部锚点与卷内第N章提及、无明确章数 → 不判完成,报未知', () => {
    const root = mkBottomedBook({
      体量行: '卷01·改字无印（清河县）｜4 案，卷末第17章收束',
      时间线: '# 计划时间线\n\n- 第17章 卷末锚点\n',
      定稿章号: range(1, 11),
    })
    const r = activeChapterLine(root)
    if (!('行' in r)) return
    expect(r.行).toContain('完成情况未知')
    expect(r.行).not.toContain('已全部完成')
    expect(r.行).not.toContain('17')
  })

  it('反例:章数声明冲突 → 报未知', () => {
    const root = mkBottomedBook({ 体量行: '卷01｜4 案／17 章，后改按 15 章收束', 定稿章号: range(1, 17) })
    const r = activeChapterLine(root)
    if (!('行' in r)) return
    expect(r.行).toContain('完成情况未知')
    expect(r.行).not.toContain('已全部完成')
  })

  // 2026-09-20 第二轮补证（带空格「第 N 章」形态，区分旧/最终排除正则）:
  // 旧正则只查「第」紧邻前一字符,带空格时漏排除;最终正则 /第\s*$/ 覆盖带空格。
  it('反例:仅「卷末第 17 章收束」带空格引用、无本卷章数 → 报未知(不把17当章数)', () => {
    const root = mkBottomedBook({ 体量行: '卷01·改字无印（清河县）｜4 案，卷末第 17 章收束', 定稿章号: range(1, 11) })
    const r = activeChapterLine(root)
    if (!('行' in r)) return
    expect(r.行).toContain('完成情况未知')
    expect(r.行).not.toContain('已全部完成')
    expect(r.行).not.toContain('17')
  })

  it('反例:明确15章同时引用「第 32 章」带空格 → 按15章判定(不冲突、不取32)', () => {
    const root = mkBottomedBook({ 卷: 2, 体量行: '卷02·誊正（江州府城）｜3 案／15 章，卷末第 32 章收束', 定稿章号: range(18, 32) })
    const r = activeChapterLine(root)
    if (!('行' in r)) return
    expect(r.行).toContain('卷02')
    expect(r.行).toContain('已全部完成')
    expect(r.行).not.toContain('未知')
    expect(r.行).not.toContain('32 章')
  })
})

describe('卷行确认门槛(任务21, B2)', () => {
  function mkLayoutBook(分卷文: string): string {
    const root = mkBook(false)
    fs.mkdirSync(path.join(root, '大纲'), { recursive: true })
    fs.writeFileSync(path.join(root, '大纲/分卷布局.md'), 分卷文, 'utf-8')
    return root
  }
  const layout = (sectionState: string | null, rows: string[]): string => [
    '# 分卷布局', '',
    `## 故事阶段分配${sectionState === null ? '' : ` 〔${sectionState}〕`}`, '',
    ...rows, '',
  ].join('\n')

  it('行级/小节级/缺失/冲突八行输入期望表;中文卷号;首个出现卷行生效', () => {
    // 1. 旧行级已确认(小节留白)→ 行级优先
    let root = mkLayoutBook(layout('留白', ['- 卷01 〔已确认〕']))
    expect(scanDesign(root, 1).当前卷分配完整).toBe(true)
    // 2. 行级暂定(小节已确认)→ 暂定
    root = mkLayoutBook(layout('已确认', ['- 卷01 〔暂定〕']))
    expect(scanDesign(root, 1).当前卷分配完整).toBe(false)
    // 3. 行级留白 → 留白
    root = mkLayoutBook(layout('已确认', ['- 卷01 〔留白〕']))
    expect(scanDesign(root, 1).当前卷分配完整).toBe(false)
    // 4. 原书形态:小节已确认,无标注卷行(中文卷号)→ 继承
    root = mkLayoutBook(layout('已确认', ['- 卷一·改字无印（清河县，4 案／17 章）：局部。', '- 卷二·誊正（江州府城，3 案／15 章）：中间。']))
    expect(scanDesign(root, 1).当前卷分配完整).toBe(true)
    expect(scanDesign(root, 2).当前卷分配完整).toBe(true)
    // 5. 同上,小节暂定 → 暂定
    root = mkLayoutBook(layout('暂定', ['- 卷二·誊正（江州府城，3 案／15 章）：中间。']))
    expect(scanDesign(root, 2).当前卷分配完整).toBe(false)
    // 6. 同上,小节无标注 → 缺失,不默认确认
    root = mkLayoutBook(layout(null, ['- 卷二·誊正（江州府城，3 案／15 章）：中间。']))
    expect(scanDesign(root, 2).当前卷分配完整).toBe(false)
    // 7. 冲突:行级已确认+小节暂定 → 行级优先
    root = mkLayoutBook(layout('暂定', ['- 卷01 〔已确认〕']))
    expect(scanDesign(root, 1).当前卷分配完整).toBe(true)
    // 8. 冲突:行级暂定+小节已确认 → 行级优先
    root = mkLayoutBook(layout('已确认', ['- 卷01 〔暂定〕']))
    expect(scanDesign(root, 1).当前卷分配完整).toBe(false)
    // 解析面:行级/小节级字段齐全;同卷有效状态互斥的重复行呈报冲突(不按文件顺序放行)
    const allocs = parseVolumeAllocations(layout('暂定', ['- 卷01 〔已确认〕', '- 卷01 〔留白〕', '- 卷二·誊正（江州府城，3 案／15 章）：中间。']))
    expect(allocs).toHaveLength(3)
    expect(allocs.filter((a) => a.卷 === 1)).toEqual([
      expect.objectContaining({ 行级状态: '已确认', 小节状态: '暂定', 有效状态: null, 冲突: true }),
      expect.objectContaining({ 行级状态: '留白', 小节状态: '暂定', 有效状态: null, 冲突: true }),
    ])
    expect(allocs.find((a) => a.卷 === 2)).toMatchObject({ 行级状态: null, 小节状态: '暂定', 有效状态: '暂定' })
  })

  it('其他小节误放行反例(F21-3):只认故事阶段分配小节;正式段缺失不借状态;合法旧格式兼容;冲突呈报', () => {
    // ①其他小节已确认在前、正式段暂定在后 → 不放行(其他小节不压过正式分配段)
    let root = mkLayoutBook(['# 分卷布局', '', '## 卷目标与卷末状态 〔已确认〕', '', '- 卷二·目标描述', '', '## 故事阶段分配 〔暂定〕', '', '- 卷二·准备中', ''].join('\n'))
    expect(scanDesign(root, 2).当前卷分配完整).toBe(false)
    // ②其他小节在后同样不影响正式段判定
    root = mkLayoutBook(['# 分卷布局', '', '## 故事阶段分配 〔暂定〕', '', '- 卷二·准备中', '', '## 卷目标与卷末状态 〔已确认〕', '', '- 卷二·目标描述', ''].join('\n'))
    expect(scanDesign(root, 2).当前卷分配完整).toBe(false)
    // ③正式段存在但空、其他小节有显式已确认卷行 → 仍不确认(不借其他小节状态)
    root = mkLayoutBook(['# 分卷布局', '', '## 故事阶段分配 〔已确认〕', '', '## 卷目标与卷末状态 〔留白〕', '', '- 卷01 〔已确认〕', ''].join('\n'))
    expect(scanDesign(root, 1).当前卷分配完整).toBe(false)
    // ④无故事阶段分配小节(legacy):显式行级已确认卷行仍兼容
    root = mkLayoutBook(['# 分卷布局', '', '## 卷目标与卷末状态 〔留白〕', '', '- 卷01 〔已确认〕', ''].join('\n'))
    expect(scanDesign(root, 1).当前卷分配完整).toBe(true)
    // ⑤同卷有效状态互斥重复行 → 呈报冲突,不默认确认
    root = mkLayoutBook(layout('已确认', ['- 卷01 〔已确认〕', '- 卷01 〔暂定〕']))
    expect(scanDesign(root, 1).当前卷分配完整).toBe(false)
    expect(scanDesignDetail(root).分卷.各卷).toEqual([{ 卷号: 1, 状态: '冲突' }])
  })

  it('scanDesignDetail 各卷与 scanDesign 同一解析口径(缺失→缺失,不默认确认)', () => {
    const root = mkLayoutBook(layout('已确认', ['- 卷一·改字无印（清河县，4 案／17 章）：局部。', '- 卷二·誊正（江州府城，3 案／15 章）：中间。', '- 卷三·代画指（府城·回清河，3 案／14 章）：转折。']))
    const d = scanDesignDetail(root)
    expect(d.分卷.各卷).toEqual([
      { 卷号: 1, 状态: '已确认' },
      { 卷号: 2, 状态: '已确认' },
      { 卷号: 3, 状态: '已确认' },
    ])
    const missing = mkLayoutBook(layout(null, ['- 卷一·改字无印（清河县，4 案／17 章）：局部。']))
    expect(scanDesignDetail(missing).分卷.各卷).toEqual([{ 卷号: 1, 状态: '缺失' }])
    expect(scanDesign(missing, 1).当前卷分配完整).toBe(false)
  })
})

describe('当前卷选择(任务21, B3 决策表15行)', () => {
  const 卷 = (n: number) => String(n).padStart(2, '0')
  interface VolSpec {
    readonly 体量行?: string | null
    readonly 有卷纲?: boolean
    readonly 定稿章号?: number[]
    readonly 窗口?: readonly (readonly [string, string])[]
    readonly 空目录?: boolean
  }
  function mkVolBook(specs: Readonly<Record<number, VolSpec>>, 候选卷?: number): string {
    const root = mkBook(false)
    for (const [v, spec] of Object.entries(specs)) {
      const n = Number(v)
      const dir = path.join(root, `大纲/卷规划/卷${卷(n)}`)
      fs.mkdirSync(dir, { recursive: true })
      if (spec.空目录 === true) continue
      if (spec.有卷纲 !== false) {
        const outline = ['# 卷纲', '']
        if (spec.体量行 !== undefined && spec.体量行 !== null) outline.push(spec.体量行, '')
        outline.push('## 叙事结构 〔已确认〕', '', 'x', '')
        fs.writeFileSync(path.join(dir, '卷纲.md'), outline.join('\n'), 'utf-8')
      }
      if (spec.窗口 !== undefined) {
        fs.writeFileSync(path.join(dir, '近期窗口.md'), ['# 近期窗口', '', ...spec.窗口.map(([name, state]) => `- ${name} 〔${state}〕`), ''].join('\n'), 'utf-8')
      }
      for (const c of spec.定稿章号 ?? []) {
        const fd = path.join(root, `定稿/卷${卷(n)}`)
        fs.mkdirSync(fd, { recursive: true })
        fs.writeFileSync(path.join(fd, `${String(c).padStart(4, '0')}-第${c}章.md`), serializeDocument({ 状态: '已定稿' }, '正文\n'), 'utf-8')
      }
    }
    if (候选卷 !== undefined) {
      const cd = path.join(root, '草稿区/章细纲')
      fs.mkdirSync(cd, { recursive: true })
      fs.writeFileSync(path.join(cd, `卷${卷(候选卷)}-第${候选卷 === 2 ? '十八' : '一'}章 新案.md`), serializeDocument({ 状态: '候选' }, '候选\n'), 'utf-8')
    }
    return root
  }
  const 章17 = '卷01·改字无印（清河县）｜4 案／17 章，单章约 2000 字'
  const 章15 = '卷02·誊正（江州府城）｜3 案／15 章，单章约 2000 字'

  it('15行决策表全量', () => {
    // 1. 空书(含只有空目录)
    expect(selectCurrentVolume(mkVolBook({ 1: { 空目录: true } }))).toEqual({ kind: 'empty' })
    // 2. 冷启动就绪
    expect(selectCurrentVolume(mkVolBook({ 1: { 体量行: 章17, 窗口: [['第一章', '已确认']] } }))).toEqual({ kind: 'active', 卷: 1 })
    // 3. 冷启动只预备(仅暂定)
    expect(selectCurrentVolume(mkVolBook({ 1: { 体量行: 章17, 窗口: [['第一章', '暂定']] } }))).toEqual({ kind: 'planning', 已完成卷: null, 规划卷: 1 })
    // 4. 冷启动未来抢占反例:卷1仅候选(准备卷),卷2已确认窗口也不得越过
    expect(selectCurrentVolume(mkVolBook({ 1: { 窗口: [['第一章', '暂定']] }, 2: { 窗口: [['第十八章', '已确认']] } }, 1))).toEqual({ kind: 'planning', 已完成卷: null, 规划卷: 1 })
    // 5. 非卷1起步旧书
    expect(selectCurrentVolume(mkVolBook({ 2: { 体量行: 章15, 窗口: [['第十八章', '已确认']] } }))).toEqual({ kind: 'active', 卷: 2 })
    // 6. 当前卷完成未知(卷2已确认窗口不抢)
    expect(selectCurrentVolume(mkVolBook({ 1: { 有卷纲: true, 定稿章号: [1, 2, 3] }, 2: { 窗口: [['第十八章', '已确认']] } }))).toEqual({ kind: 'active', 卷: 1 })
    // 7. 当前卷未完(11/17,卷2已确认窗口不抢)
    expect(selectCurrentVolume(mkVolBook({ 1: { 体量行: 章17, 定稿章号: Array.from({ length: 11 }, (_, i) => i + 1) }, 2: { 窗口: [['第十八章', '已确认']] } }))).toEqual({ kind: 'active', 卷: 1 })
    // 8. 完成后仅暂定窗口
    expect(selectCurrentVolume(mkVolBook({ 1: { 体量行: 章17, 定稿章号: Array.from({ length: 17 }, (_, i) => i + 1) }, 2: { 体量行: 章15, 窗口: [['第十八章', '暂定']] } }))).toEqual({ kind: 'planning', 已完成卷: 1, 规划卷: 2 })
    // 9. 完成后仅候选细纲(无卷规划目录)
    expect(selectCurrentVolume(mkVolBook({ 1: { 体量行: 章17, 定稿章号: Array.from({ length: 17 }, (_, i) => i + 1) } }, 2))).toEqual({ kind: 'planning', 已完成卷: 1, 规划卷: 2 })
    // 10. 完成后仅卷纲无窗口
    expect(selectCurrentVolume(mkVolBook({ 1: { 体量行: 章17, 定稿章号: Array.from({ length: 17 }, (_, i) => i + 1) }, 2: { 体量行: 章15 } }))).toEqual({ kind: 'planning', 已完成卷: 1, 规划卷: 2 })
    // 11. 完成后就绪
    expect(selectCurrentVolume(mkVolBook({ 1: { 体量行: 章17, 定稿章号: Array.from({ length: 17 }, (_, i) => i + 1) }, 2: { 体量行: 章15, 窗口: [['第十八章', '已确认']] } }))).toEqual({ kind: 'active', 卷: 2 })
    // 12. 多未来卷均就绪按卷序
    expect(selectCurrentVolume(mkVolBook({ 1: { 体量行: 章17, 定稿章号: Array.from({ length: 17 }, (_, i) => i + 1) }, 2: { 体量行: 章15, 窗口: [['第十八章', '已确认']] }, 3: { 体量行: '卷03｜3 案／14 章', 窗口: [['第三十三章', '已确认']] } }))).toEqual({ kind: 'active', 卷: 2 })
    // 13. 中间卷未就绪不跳卷3
    expect(selectCurrentVolume(mkVolBook({ 1: { 体量行: 章17, 定稿章号: Array.from({ length: 17 }, (_, i) => i + 1) }, 3: { 体量行: '卷03｜3 案／14 章', 窗口: [['第三十三章', '已确认']] } }))).toEqual({ kind: 'planning', 已完成卷: 1, 规划卷: 2 })
    // 14. 完成无下一卷
    expect(selectCurrentVolume(mkVolBook({ 1: { 体量行: 章17, 定稿章号: Array.from({ length: 17 }, (_, i) => i + 1) } }))).toEqual({ kind: 'planning', 已完成卷: 1, 规划卷: 2 })
    // 15. 已进入后卷的旧书(卷2有定稿完成未知,卷1缺资料不倒退)
    expect(selectCurrentVolume(mkVolBook({ 2: { 有卷纲: true, 体量行: null, 定稿章号: [18, 19] } }))).toEqual({ kind: 'active', 卷: 2 })
  })

  it('消费映射:activeChapterLine planning/empty 行形状;连续两次求值相同', () => {
    const planningBook = mkVolBook({ 1: { 体量行: 章17, 定稿章号: Array.from({ length: 17 }, (_, i) => i + 1) }, 2: { 体量行: 章15, 窗口: [['第十八章', '暂定']] } })
    const r1 = activeChapterLine(planningBook)
    expect(r1.ok && '行' in r1 && r1.行).toBe('卷01 已全部完成；卷02 待规划（窗口未就绪或尚无材料）。')
    expect(activeChapterLine(planningBook)).toEqual(r1)

    const coldBook = mkVolBook({ 1: { 体量行: 章17, 窗口: [['第一章', '暂定']] } })
    const r2 = activeChapterLine(coldBook)
    expect(r2.ok && '行' in r2 && r2.行).toBe('卷01 尚未开写，待完成规划并确认窗口。')

    const emptyBook = mkVolBook({ 1: { 空目录: true } })
    const r3 = activeChapterLine(emptyBook)
    expect(r3.ok && '行' in r3 && r3.行).toContain('尚无已规划章节')
  })
})
