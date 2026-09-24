import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  checkConfirmable,
  confirmOutline,
  deriveChapterFacts,
  scanChapter,
  seedMinDesign,
  writeCandidate,
  writeEntry,
  writeRecentWindow,
} from '../src/index'
import { paths } from '../src/repo/paths'

const roots: string[] = []
function mkBook(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-outline-'))
  roots.push(dir)
  seedMinDesign(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

const key = { 卷: 1, 章: 1, 章名: '开篇任务' } as const

describe('章细纲(格式规格 §3.3)', () => {
  it('write candidate → scan/derive 章细纲(待确认)', () => {
    const root = mkBook()
    const rel = writeCandidate(root, { 卷: 1, 章名: '开篇任务' })
    expect(rel).toBe(paths.候选细纲(1, '开篇任务'))
    expect(fs.existsSync(path.join(root, rel))).toBe(true)
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('章细纲(待确认)')
  })

  it('confirm without valid 来源引用 → rejected', () => {
    const root = mkBook()
    writeCandidate(root, { 卷: 1, 章名: '开篇任务' })
    const gate = checkConfirmable(root, key)
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.gaps.some((g) => g.includes('来源引用'))).toBe(true)
    const confirmed = confirmOutline(root, key)
    expect(confirmed.ok).toBe(false)
    expect(fs.existsSync(path.join(root, paths.确认细纲(1, 1, '开篇任务')))).toBe(false)
    expect(fs.existsSync(path.join(root, paths.候选细纲(1, '开篇任务')))).toBe(true)
  })

  it('confirm with valid refs + window item → 真源区, candidate gone, derive 写作备料', () => {
    const root = mkBook()
    const body = [
      '# 章细纲', '', '## 定位段', '',
      '### 来源窗口项及拆并关系', '开篇任务，单章承接', '',
      '### 章节功能', '建立开场冲突', '- 〔软〕节奏平稳', '',
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
    writeCandidate(root, {
      卷: 1,
      章: 1,
      章名: '开篇任务',
      来源引用: ['作品契约/契约.md@1', '大纲/卷规划/卷01/卷纲.md@1'],
      body,
    })
    const confirmed = confirmOutline(root, key)
    expect(confirmed).toEqual({ ok: true })
    expect(fs.existsSync(path.join(root, paths.确认细纲(1, 1, '开篇任务')))).toBe(true)
    expect(fs.existsSync(path.join(root, paths.候选细纲(1, '开篇任务')))).toBe(false)
    const text = fs.readFileSync(path.join(root, paths.确认细纲(1, 1, '开篇任务')), 'utf-8')
    expect(text).toMatch(/状态:\s*已确认/)
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('写作备料')
  })

  it('valid refs cannot bypass incomplete outline sections', () => {
    const root = mkBook()
    writeCandidate(root, {
      卷: 1,
      章: 1,
      章名: '开篇任务',
      来源引用: ['作品契约/契约.md@1', '大纲/卷规划/卷01/卷纲.md@1'],
    })
    const gate = checkConfirmable(root, key)
    expect(gate.ok).toBe(false)
    if (!gate.ok) {
      expect(gate.gaps.some((g) => g.includes('定位段'))).toBe(true)
      expect(gate.gaps.some((g) => g.includes('叙事单元'))).toBe(true)
      expect(gate.gaps.some((g) => g.includes('约束分级'))).toBe(true)
    }
  })

  it('留白设定引用 → 允许确认并播报', () => {
    const root = mkBook()
    writeEntry(root, '人物档案', '路人', {
      类型: '人物',
      性质: '计划',
      状态: '留白',
      来源: '对谈共创',
    })
    writeCandidate(root, {
      卷: 1,
      章名: '开篇任务',
      来源引用: ['世界书/人物档案/路人.md@1'],
    })
    const gate = checkConfirmable(root, key)
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.gaps.some((g) => g.includes('留白'))).toBe(false)
  })

  it('章名 B2 reject', () => {
    const root = mkBook()
    expect(() => writeCandidate(root, { 卷: 1, 章名: 'a/b' })).toThrow(/B2/)
  })
})

describe('已定稿章细纲勘误(候选→再确认, F-001/任务19)', () => {
  const errataKey = { 卷: 1, 章: 10, 章名: '第十章 急殓' } as const
  const refs = ['作品契约/契约.md@1', '大纲/卷规划/卷01/卷纲.md@1']

  function outlineBody(代词: string): string {
    return [
      '# 章细纲', '', '## 定位段', '',
      '### 来源窗口项及拆并关系', '第十章 急殓，单章承接', '',
      '### 章节功能', '推进第3案开场', '- 〔软〕节奏平稳', '',
      '### 视角与焦点', '主角视角', '',
      '### 时空锚定', '码头，黄昏', '',
      '### 起止边界', '从报案到急殓', '',
      '### 故事线与承诺分配', '推进第3案', '',
      '### 信息边界', `只披露${代词}所见`, '',
      '### 情绪与节奏目标', '紧迫', '',
      '### 前置条件核对结果', '已核对来源与窗口，前置设定均非留白', '',
      '## 细纲段', '', '### 单元 1', '',
      '- 目标: 勘误演示', '- 人物: 阿禾', '- 时空: 码头',
      '- 行动/冲突: 急殓入棺', '- 信息披露: 无', '- 状态变化: 无', '',
    ].join('\n')
  }

  /** 建「已定稿章＋真源确认细纲 v1＋窗口条目〔已消费〕」的 F-001 现场。 */
  function mkErrataBook(): { root: string; finalizedAbs: string; finalizedBytes: string } {
    const root = mkBook()
    writeRecentWindow(root, 1, [
      { 名称: '开篇任务', 状态: '已消费' },
      { 名称: '第十章 急殓', 状态: '已确认' },
    ])
    // 首次确认(窗口就绪)落真源 v1
    writeCandidate(root, { 卷: 1, 章: 10, 章名: '第十章 急殓', 来源引用: refs, body: outlineBody('她') })
    const first = confirmOutline(root, errataKey)
    expect(first).toEqual({ ok: true })
    // 定稿入档后窗口条目转为已消费(F-001 现场)
    writeRecentWindow(root, 1, [
      { 名称: '开篇任务', 状态: '已消费' },
      { 名称: '第十章 急殓', 状态: '已消费' },
    ])
    const finalizedAbs = path.join(root, '定稿/卷01/0010-第十章 急殓.md')
    fs.mkdirSync(path.dirname(finalizedAbs), { recursive: true })
    fs.writeFileSync(finalizedAbs, '---\n状态: 已定稿\n来源细纲版本: 大纲/卷规划/卷01/章细纲/0010-第十章 急殓.md@1\n---\n# 第十章 急殓\n\n正文一律用「他」。\n', 'utf-8')
    const finalizedBytes = fs.readFileSync(finalizedAbs, 'utf-8')
    return { root, finalizedAbs, finalizedBytes }
  }

  it('再确认不需窗口条目:版本+1、父版本指旧版、候选删除、定稿字节不变', () => {
    const { root, finalizedAbs, finalizedBytes } = mkErrataBook()
    // 草稿区出现同名候选(「阿禾：她→他」纠正记录)
    writeCandidate(root, { 卷: 1, 章: 10, 章名: '第十章 急殓', 来源引用: refs, body: outlineBody('他') })
    const before = checkConfirmable(root, errataKey)
    expect(before.ok).toBe(true)

    const r = confirmOutline(root, errataKey)
    expect(r).toEqual({ ok: true })
    const confirmedAbs = path.join(root, paths.确认细纲(1, 10, '第十章 急殓'))
    const text = fs.readFileSync(confirmedAbs, 'utf-8')
    expect(text).toMatch(/状态:\s*已确认/)
    expect(text).toMatch(/版本:\s*2/)
    expect(text).toMatch(/父版本:\s*1/)
    expect(text).toContain('只披露他所见')
    expect(fs.existsSync(path.join(root, paths.候选细纲(1, '第十章 急殓')))).toBe(false)
    // 定稿 frontmatter 来源细纲版本不回写,定稿字节不变
    expect(fs.readFileSync(finalizedAbs, 'utf-8')).toBe(finalizedBytes)
    // scanChapter:候选 false、确认 true、已定稿 true
    const facts = scanChapter(root, errataKey)
    expect(facts.候选细纲).toBe(false)
    expect(facts.确认细纲).toBe(true)
    expect(facts.已定稿).toBe(true)
  })

  it('再确认分支其余门槛照旧:候选缺来源引用仍拒(且不再报窗口)', () => {
    const { root } = mkErrataBook()
    writeCandidate(root, { 卷: 1, 章: 10, 章名: '第十章 急殓', body: outlineBody('他') })
    const gate = checkConfirmable(root, errataKey)
    expect(gate.ok).toBe(false)
    if (!gate.ok) {
      expect(gate.gaps.some((g) => g.includes('来源引用'))).toBe(true)
      expect(gate.gaps.some((g) => g.includes('窗口未就绪'))).toBe(false)
    }
    expect(confirmOutline(root, errataKey).ok).toBe(false)
  })

  it('首次确认反例:真源无确认细纲时窗口门槛字节级不变', () => {
    const root = mkBook()
    writeRecentWindow(root, 1, [
      { 名称: '开篇任务', 状态: '已消费' },
      { 名称: '第十章 急殓', 状态: '已消费' },
    ])
    writeCandidate(root, { 卷: 1, 章: 10, 章名: '第十章 急殓', 来源引用: refs, body: outlineBody('他') })
    const gate = checkConfirmable(root, errataKey)
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.gaps.some((g) => g.startsWith('窗口未就绪或无匹配已确认窗口项') && g.includes('当前窗口无可进入条目'))).toBe(true)
    expect(confirmOutline(root, errataKey).ok).toBe(false)
    expect(fs.existsSync(path.join(root, paths.确认细纲(1, 10, '第十章 急殓')))).toBe(false)
  })

  it('窗口门槛不过时报出可进入条目名(已消费条目不列),调用方一次即可对上章名', () => {
    const root = mkBook()
    writeRecentWindow(root, 1, [
      { 名称: '开篇任务', 状态: '已确认' },
      { 名称: '第十章 急殓', 状态: '已消费' },
    ])
    writeCandidate(root, { 卷: 1, 章: 1, 章名: '第一章', 来源引用: refs, body: outlineBody('他') })
    const gate = checkConfirmable(root, { 卷: 1, 章: 1, 章名: '第一章' })
    expect(gate.ok).toBe(false)
    if (!gate.ok) {
      const gap = gate.gaps.find((g) => g.startsWith('窗口未就绪或无匹配已确认窗口项'))
      expect(gap).toContain('当前可进入：开篇任务')
      expect(gap).not.toContain('急殓')
    }
  })
})
