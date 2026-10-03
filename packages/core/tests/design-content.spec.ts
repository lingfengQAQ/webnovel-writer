import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { deriveDesign, scanDesign, 故事骨架九部 } from '../src/derive/design'
import { scanDesignDetail, renderBookProgress } from '../src/progress'
import { seedMinDesign } from '../src/design/seed'
import { LEDGER_NAMES, paths } from '../src/repo/paths'
import { serializeDocument } from '../src/repo/frontmatter'
import { reconcileBookLedger, reconcileLedger } from '../src/ledger'
import { removeSync } from '../src/repo/remove'
import { writeReadyDesign } from './fixtures/ready-design'
import { computePack } from '../src/prepare/pack'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'design-content-'))
afterAll(() => removeSync(scratch))
function put(root: string, file: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), text)
}
function emptyBook(): string {
  const root = fs.mkdtempSync(path.join(scratch, 'book-'))
  seedMinDesign(root)
  put(root, paths.构想快照(), '# 构想\n铜铃引出旧案。\n')
  for (const name of LEDGER_NAMES) put(root, paths.账本(name), `# ${name}\n`)
  return root
}
function readyBook(): string {
  const root = emptyBook()
  writeReadyDesign(root)
  return root
}

describe('#165 内容与就绪建议同源', () => {
  it('当前必要骨架确认，远期七部留白/暂定与生命周期子条目不妨碍开写，查询不写盘', () => {
    const root = readyBook()
    const text = 故事骨架九部.map((name, index) => `## ${name} 〔${index < 2 ? '已确认' : index % 2 ? '暂定' : '留白'}〕\n${index < 2 ? '主角想找回航图，船主拒绝同行。\n- 航图线索 〔已埋〕\n' : ''}`).join('\n')
    put(root, paths.故事骨架(), text)
    expect(deriveDesign(scanDesign(root)).建议).toBe('开写就绪')
    const progress = renderBookProgress(scanDesignDetail(root), {}, [])
    expect(progress).toContain('留白')
    expect(progress).toContain('暂定')
    expect(fs.readFileSync(path.join(root, paths.故事骨架()), 'utf8')).toBe(text)
  })

  it.each([
    ['## 结局方向与远期锚点 〔已确认〕\n', '缺少内容'],
    ['## 结局方向与远期锚点 〔猜测〕\n未知。', '状态无效'],
    ['## 结局方向与远期锚点 〔留白〕\n\n## 结局方向与远期锚点 〔已确认〕\n公开真相。', '状态冲突'],
    ['', '缺少分部'],
  ])('远期放宽仍拒绝损坏状态与空确认：%s', (replacement, issue) => {
    const root = readyBook(), file = path.join(root, paths.故事骨架())
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/## 结局方向与远期锚点[\s\S]*$/, replacement))
    const result = deriveDesign(scanDesign(root))
    expect(result.建议).toBe('故事骨架')
    expect(result.内容问题).toContainEqual(expect.objectContaining({ 分部: '结局方向与远期锚点', 问题: issue }))
  })
  it('占位确认态保留原标签事实，但不再建议开写就绪', () => {
    const root = emptyBook()
    const facts = scanDesign(root)
    expect(facts.契约六部已确认).toBe(true)
    expect(facts.骨架当前阶段已确认).toBe(true)
    expect(deriveDesign(facts).建议).not.toBe('开写就绪')
    expect(facts.内容问题).toEqual(expect.arrayContaining([expect.objectContaining({ 路径: paths.契约(), 分部: '叙事方式与文风基调' })]))
    const detail = scanDesignDetail(root)
    expect(detail.内容问题).toEqual(facts.内容问题)
    expect(renderBookProgress(detail, {}, [])).not.toContain('推导照常')
  })

  it('真实短设计可开写，允许留白的远期部分不阻塞', () => {
    const root = readyBook()
    expect(deriveDesign(scanDesign(root)).建议).toBe('开写就绪')
    expect(scanDesign(root).内容问题).toEqual([])
  })

  it.each([
    [paths.契约(), '## 叙事方式与文风基调 〔已确认〕\n<!-- 尚未填 -->\n### 空子标题\n待补：文风\n', '作品定调'],
    [paths.故事骨架(), '# 骨架\n- 主角目标与成长轨迹 〔已确认〕\n', '故事骨架'],
    ['世界书/人物档案/主角.md', serializeDocument({ 状态: '已确认' }, '# 主角\n<!-- 空 -->'), '世界构建'],
    [paths.分卷布局(), '# 分卷布局\n## 故事阶段分配\n- 卷01 〔已确认〕\n', '分卷布局'],
    [paths.卷纲(1), '# 卷纲\n## 叙事结构 〔已确认〕\n### 空子标题\n## 弧线 〔留白〕\n## 线索推进 〔留白〕\n## 卷末兑现 〔留白〕\n', '当前卷规划'],
    [paths.计划时间线(1), '# 计划时间线\n## 窗口覆盖\n- 〔留白〕\n', '当前卷规划'],
  ])('必要文件 %s 缺正文时给出对应阶段和文件依据', (file, text, stage) => {
    const root = readyBook()
    put(root, file!, text!)
    const result = deriveDesign(scanDesign(root))
    expect(result.建议).toBe(stage)
    expect(result.内容问题?.some(issue => issue.路径 === file)).toBe(true)
    expect(scanDesignDetail(root).内容问题).toEqual(result.内容问题)
  })

  it('行级与小节级矛盾显式呈报，不能静默挑一个放行', () => {
    const root = readyBook()
    put(root, paths.分卷布局(), '# 分卷布局\n## 故事阶段分配 〔留白〕\n- 卷01：追查铜铃 〔已确认〕\n')
    const result = deriveDesign(scanDesign(root))
    expect(result.建议).toBe('分卷布局')
    expect(result.内容问题).toEqual(expect.arrayContaining([expect.objectContaining({ 问题: '状态冲突' })]))
  })

  it.each([
    '# 分卷布局\n## 故事阶段分配 〔已确认〕\n- 卷一·铜铃旧案：主角追查父亲失踪。\n',
    '# 分卷布局\n## 旧计划 〔留白〕\n- 卷01：主角追查父亲失踪 〔已确认〕\n',
    '# 分卷布局\n## 故事阶段分配\n- 卷01 〔已确认〕\n  主角追查铜铃来历。\n',
  ])('有内容的卷行兼容显式、继承及旧格式', text => {
    const root = readyBook()
    put(root, paths.分卷布局(), text)
    expect(deriveDesign(scanDesign(root)).建议).toBe('开写就绪')
  })

  it('旧 seed 完整计划样式进入待核对，全书汇总一致且原文不改', () => {
    const root = emptyBook()
    const file = path.join(root, paths.计划时间线(1))
    const original = fs.readFileSync(file, 'utf8')
    const result = reconcileLedger(root, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.状态).toBe('待核对')
    expect(result.report.计划未兑现).toEqual([])
    expect(result.report.疑似占位待核对?.map(item => item.名称)).toEqual(['开篇任务', '卷末锚点'])
    const book = reconcileBookLedger(root)
    expect(book.ok && book.report.状态).toBe('待核对')
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
    const key = { 卷: 1, 章: 1, 章名: '开篇任务' }
    put(root, `${paths.草稿目录(1, key.章名)}/稿1.md`, serializeDocument({ 角色: '待审稿', 选定: true }, '少年在雨中听见铜铃。'))
    const pack = computePack(root, key)
    expect(pack.ok, pack.reason).toBe(true)
    const report = pack.文件?.find(file => file.relPath.endsWith('/卷对账.md'))?.content
    expect(report).toContain('疑似模板占位待核对')
    expect(report).not.toContain('计划未兑现：开篇任务')
    expect(report).not.toContain('无偏离')
    const rendered = renderBookProgress(scanDesignDetail(root), {}, [], 0, result.report.疑似占位待核对)
    expect(rendered).toContain('疑似模板占位待核对：开篇任务')
    expect(fs.existsSync(path.join(root, pack.dir))).toBe(false)
  })

  it('同名真实计划有作者说明时不按名字过滤', () => {
    const root = emptyBook()
    const file = path.join(root, paths.计划时间线(1))
    fs.appendFileSync(file, '\n## 作者说明\n开篇任务是主角实际接受的委托；卷末锚点指向委托兑现。\n')
    const result = reconcileLedger(root, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.计划未兑现.map(item => item.名称)).toEqual(['开篇任务', '卷末锚点'])
    expect(result.report.疑似占位待核对 ?? []).toEqual([])
  })
})
