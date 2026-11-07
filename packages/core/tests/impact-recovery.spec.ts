import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  analyzeImpact,
  paths,
  rebuildResume,
  seedMinDesign,
  serializeDocument,
  writeFileAtomic,
} from '../src/index'

const roots: string[] = []
afterAll(() => { for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

function mkBook(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-recovery-'))
  roots.push(root)
  seedMinDesign(root)
  return root
}

describe('影响分析与断更恢复', () => {
  it('只标记真实来源引用者，定稿区保持只读', () => {
    const root = mkBook()
    const downstream = '大纲/故事骨架.md'
    writeFileAtomic(root, downstream, serializeDocument({ 状态: '已确认', 来源引用: ['作品契约/契约.md@1'] }, '# 故事骨架\n'))
    writeFileAtomic(root, '定稿/卷01/0001-已完成.md', serializeDocument({ 状态: '已定稿', 来源引用: ['作品契约/契约.md@1'] }, '正文\n'))
    const report = analyzeImpact(root, paths.契约())
    expect(report.references.map((ref) => ref.relPath)).toContain(downstream)
    // 拍板 7:影响面现算呈报,不落盘——下游状态原样保留(闭包与吃书标注见 impact-closure.spec.ts)
    const text = fs.readFileSync(path.join(root, downstream), 'utf8')
    expect(text).toMatch(/状态:\s*已确认/)
  })

  it('新会话凭书仓推导恢复近况与材料，不依赖会话记忆', () => {
    const root = mkBook()
    const key = { 卷: 1, 章: 1, 章名: '开篇任务' } as const
    const outline = paths.确认细纲(1, 1, key.章名)
    writeFileAtomic(root, outline, serializeDocument({ 状态: '已确认', 版本: 3 }, '# 章细纲\n\n已确认内容\n'))
    const section = '草稿区/材料包/卷01-开篇任务/01-本章任务与确认细纲.md'
    writeFileAtomic(root, section, '材料来源\n')
    const snapshot = rebuildResume(root, key)
    expect(snapshot.derived.建议.环节).toBe('写作备料')
    expect(snapshot.statusCard).toMatch(/近况/)
    expect(snapshot.statusCard).toMatch(/写作备料/)
    expect(snapshot.injection.细纲).toContain('章细纲')
    expect(snapshot.injection.材料段['本章任务与确认细纲']).toContain('材料来源')
  })

  it('恢复近况包含账本/记忆计数与计划对账状态', () => {
    const root = mkBook()
    for (const [name, body] of [
      ['故事线', '## 主线\n状态：进行中\n计划来源：卷纲#1\n'],
      ['人物弧线', '## 主角\n状态：进行中\n计划来源：卷纲#2\n'],
      ['承诺', '## 查明\n状态：进行中\n计划来源：卷纲#3\n'],
      ['线索', '## 纸鹤\n状态：已埋\n计划来源：卷纲#4\n埋设点：第1章\n预期兑现区间：第8章\n'],
      ['时间线', '## 城门异响\n事件：发现异常\n章号：第0001章\n'],
    ] as const) writeFileAtomic(root, `账本/${name}.md`, `# ${name}\n\n${body}`)
    for (const name of ['文风', '决策', '对话', '灵感']) {
      writeFileAtomic(root, `本书记忆/${name}条目.md`, serializeDocument({ 名称: `${name}条目`, 类: name, 状态: '已确认' }, '已沉淀。'))
    }
    writeFileAtomic(root, paths.计划时间线(1), '# 计划时间线\n\n## 窗口覆盖\n- 城门异响〔已确认〕\n- 尚未发生〔暂定〕\n')
    const snapshot = rebuildResume(root, { 卷: 1, 章: 1, 章名: '开篇任务' })
    expect(snapshot.ledger.ok).toBe(true)
    expect(snapshot.memory.ok).toBe(true)
    expect(snapshot.reconciliation.ok).toBe(true)
    if (snapshot.ledger.ok) expect(snapshot.ledger.entries).toHaveLength(5)
    if (snapshot.memory.ok) expect(snapshot.memory.entries).toHaveLength(4)
    if (snapshot.reconciliation.ok) expect(snapshot.reconciliation.report.状态).toBe('有偏离')
    expect(snapshot.statusCard).toMatch(/账本：5 条/)
    expect(snapshot.statusCard).toMatch(/本书记忆：4 条/)
    expect(snapshot.statusCard).toMatch(/计划对账：有偏离/)
    expect(snapshot.statusCard).not.toMatch(/到期：/)
    expect(snapshot.statusCard).not.toMatch(/到期清单/)
  })

  it('账本解析失败时状态卡说解析失败，不说部分缺失', () => {
    const root = mkBook()
    for (const name of ['故事线', '人物弧线', '承诺', '线索', '时间线'] as const) {
      writeFileAtomic(root, paths.账本(name), `# ${name}\n\n## 条目-${name}\n状态：进行中\n计划来源：卷纲#1\n`)
    }
    // 重复系统字段 → parse-error，但其余四个文件仍有可用条目
    writeFileAtomic(root, paths.账本('线索'), '# 线索\n\n## 纸鹤\n状态：已埋\n状态：已示\n')
    const snapshot = rebuildResume(root, { 卷: 1, 章: 1, 章名: '开篇任务' })
    expect(snapshot.ledger.ok).toBe(false)
    if (snapshot.ledger.ok) return
    expect(snapshot.ledger.kind).toBe('parse-error')
    expect(snapshot.ledger.entries.length).toBeGreaterThan(0)
    expect(snapshot.statusCard).toContain('解析失败')
    expect(snapshot.statusCard).not.toContain('部分缺失')
  })
  it('旧分类记忆不进入恢复材料，状态卡明确显示失败并保留维护指引', () => {
    const root = mkBook(), original = '# 决策\n## 旧条目\n状态：已确认\n### 正文\n旧决定。\n'
    writeFileAtomic(root, '本书记忆/决策.md', original)
    const snapshot = rebuildResume(root, { 卷: 1, 章: 1, 章名: '开篇任务' })
    expect(snapshot.memory).toMatchObject({ ok: false, kind: 'parse-error', entries: [] })
    expect(!snapshot.memory.ok && snapshot.memory.reason).toContain('预览升级')
    expect(snapshot.statusCard).toContain('解析失败')
    expect(fs.readFileSync(path.join(root, '本书记忆/决策.md'), 'utf8')).toBe(original)
  })
})
