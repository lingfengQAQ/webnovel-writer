import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { deriveDesign, scanDesign, type DesignFacts } from '../src/derive/design'
import { serializeDocument } from '../src/repo/frontmatter'
import { writeReadyDesign } from './fixtures/ready-design'

function facts(over: Partial<DesignFacts> = {}): DesignFacts {
  return {
    书仓存在: true,
    构想冻结: true,
    契约六部已确认: true,
    世界书最小模块足够: true,
    骨架当前阶段已确认: true,
    当前卷分配完整: true,
    卷纲存在: true,
    计划时间线存在: true,
    近期窗口存在: true,
    窗口有可进入条目: true,
    ...over,
  }
}

describe('设计侧事实清单与建议(格式规格 §8;R1:建议无权威)', () => {
  it('灵感阶段:无书', () => {
    expect(deriveDesign(facts({ 书仓存在: false })).建议).toBe('灵感阶段')
  })
  it('灵感阶段:构想未冻结', () => {
    expect(deriveDesign(facts({ 构想冻结: false })).建议).toBe('灵感阶段')
  })
  it('作品定调:契约六部未齐', () => {
    expect(deriveDesign(facts({ 契约六部已确认: false })).建议).toBe('作品定调')
  })
  it('世界构建:最小模块不足', () => {
    expect(deriveDesign(facts({ 世界书最小模块足够: false })).建议).toBe('世界构建')
  })
  it('故事骨架:当前阶段未确认', () => {
    expect(deriveDesign(facts({ 骨架当前阶段已确认: false })).建议).toBe('故事骨架')
  })
  it('分卷布局:当前卷分配不完整', () => {
    expect(deriveDesign(facts({ 当前卷分配完整: false })).建议).toBe('分卷布局')
  })
  it('当前卷规划:三件缺一', () => {
    expect(deriveDesign(facts({ 卷纲存在: false })).建议).toBe('当前卷规划')
    expect(deriveDesign(facts({ 计划时间线存在: false })).建议).toBe('当前卷规划')
    expect(deriveDesign(facts({ 近期窗口存在: false })).建议).toBe('当前卷规划')
  })
  it('当前卷规划:窗口无可进入条目→滚动补充', () => {
    expect(deriveDesign(facts({ 窗口有可进入条目: false })).建议).toBe('当前卷规划')
  })
  it('开写就绪:设计链满足,交给章节推导表', () => {
    expect(deriveDesign(facts()).建议).toBe('开写就绪')
  })
})

const roots: string[] = []
function mkBook(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-design-'))
  roots.push(dir)
  return dir
}
function put(root: string, rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), content, 'utf-8')
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

function seedReady(root: string): void { writeReadyDesign(root) }

describe('设计侧扫描(文件事实)', () => {
  it('空目录→灵感阶段', () => {
    const root = mkBook()
    expect(deriveDesign(scanDesign(root)).建议).toBe('灵感阶段')
  })

  it('窗口无可进入条目→当前卷规划', () => {
    const root = mkBook()
    seedReady(root)
    put(root, '大纲/卷规划/卷01/近期窗口.md', '- 初见 〔暂定〕\n')
    expect(deriveDesign(scanDesign(root)).建议).toBe('当前卷规划')
  })

  it('最小模块缺已确认条目→世界构建', () => {
    const root = mkBook()
    seedReady(root)
    put(root, '世界书/世界规则/基础规则.md', serializeDocument({ 状态: '暂定' }, '规则'))
    expect(deriveDesign(scanDesign(root)).建议).toBe('世界构建')
  })

  it('设计链齐→开写就绪', () => {
    const root = mkBook()
    seedReady(root)
    expect(deriveDesign(scanDesign(root)).建议).toBe('开写就绪')
  })
})
