import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createBook } from '../src/book/create'
import {
  checkContractComplete,
  checkVolumeReady,
  checkWorldbookMinComplete,
  ensureModulesDeclared,
  ingestNote,
  planTimelineBody,
  seedMinDesign,
  writeContract,
  writeEntry,
  writePlanTimeline,
  writeRecentWindow,
  writeVolumeOutline,
} from '../src/index'
import { deriveDesign, scanDesign } from '../src/derive/design'
import { type Concept } from '../src/inspire/concept'

const roots: string[] = []
function mkRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-design-min-'))
  roots.push(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

function confirmed(): Concept {
  return {
    状态: '已确认',
    核心创意: '被系统选中的普通人',
    题材与目标读者: '都市异能向网文读者',
  }
}

describe('定调契约', () => {
  it('空白六部未确认;六部已确认后完成', () => {
    const root = mkRoot()
    writeContract(root)
    expect(checkContractComplete(root).ok).toBe(false)

    writeContract(root, {
      题材与读者定位: { state: '已确认' },
      核心看点与差异化: { state: '已确认' },
      阅读体验与情绪承诺: { state: '已确认' },
      主角原则与关系边界: { state: '已确认' },
      叙事方式与文风基调: { state: '已确认' },
      创作禁区与不可妥协项: { state: '已确认' },
    })
    expect(checkContractComplete(root)).toEqual({ ok: true })
  })
})

describe('世界书最小模块', () => {
  it('缺模块或缺已确认条目不足;两模块各一条已确认后足够', () => {
    const root = mkRoot()
    expect(checkWorldbookMinComplete(root).ok).toBe(false)

    ensureModulesDeclared(root)
    expect(checkWorldbookMinComplete(root).ok).toBe(false)

    writeEntry(root, '人物档案', '主角', {
      类型: '人物',
      性质: '计划',
      状态: '已确认',
      来源: '对谈共创',
    })
    expect(checkWorldbookMinComplete(root).ok).toBe(false)

    writeEntry(root, '世界规则', '基础规则', {
      类型: '规则',
      性质: '计划',
      状态: '已确认',
      来源: '对谈共创',
    })
    expect(checkWorldbookMinComplete(root)).toEqual({ ok: true })
  })
})

describe('卷规划三件', () => {
  it('空窗口未就绪;一条已确认窗口项后就绪', () => {
    const root = mkRoot()
    writeVolumeOutline(root, 1, '# 卷纲\n\n## 叙事结构 〔留白〕\n\n## 弧线 〔留白〕\n\n## 线索推进 〔留白〕\n\n## 卷末兑现 〔留白〕\n')
    writePlanTimeline(root, 1, planTimelineBody({
      windowEvents: [{ 名称: '开篇', 先后: '最先', 间隔: '当日' }],
      anchors: [{ 名称: '卷末对决' }],
    }))
    writeRecentWindow(root, 1, [])
    expect(checkVolumeReady(root).ok).toBe(false)

    writeRecentWindow(root, 1, [{ 名称: '开篇', 状态: '已确认' }])
    expect(checkVolumeReady(root)).toEqual({ ok: true })

    const tl = fs.readFileSync(path.join(root, '大纲/卷规划/卷01/计划时间线.md'), 'utf-8')
    expect(tl).toContain('## 窗口覆盖')
    expect(tl).toContain('开篇')
    expect(tl).toContain('## 窗口外锚点')
    expect(tl).toContain('卷末对决')
  })
})

describe('seedMinDesign', () => {
  it('建书后写入占位 seed 仍需补充真实设计', () => {
    const author = mkRoot()
    ingestNote(author, '随手记:想写系统流')
    const parent = mkRoot()
    const created = createBook({
      workspaceRoot: parent,
      书名: '开写书',
      concept: {
        状态: '已确认',
        核心创意: '脑洞创意',
        题材与目标读者: '玄幻修真',
        主角核心欲望: '求道成仙',
        主要冲突: '生死磨难',
        核心看点: '稳健布局',
        差异化方向: '智商在线',
        明确不要什么: '无脑套路',
      },
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect(deriveDesign(scanDesign(created.bookRoot)).建议).toBe('作品定调')
    seedMinDesign(created.bookRoot)
    expect(deriveDesign(scanDesign(created.bookRoot)).建议).toBe('作品定调')
    expect(scanDesign(created.bookRoot).内容问题?.length).toBeGreaterThan(0)
  })
})
