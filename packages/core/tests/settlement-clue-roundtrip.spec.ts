import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { LEDGER_NAMES, planSettlement, queryDueLedger, queryLedger, writeBatchAtomic } from '../src/index'
import { removeSync } from '../src/repo/remove'

const temporary = fs.realpathSync.native(os.tmpdir())
const chapter = { 卷: 1, 章: 1, 章名: '线索往返' }
let root: string
const put = (relative: string, text: string) => {
  const filename = path.join(root, relative)
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  fs.writeFileSync(filename, text, 'utf8')
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(temporary, 'webnovel-clue-roundtrip-'))
  for (const name of LEDGER_NAMES) put(`账本/${name}.md`, `# ${name}\n`)
})
afterEach(() => {
  if (path.dirname(root) !== temporary || !path.basename(root).startsWith('webnovel-clue-roundtrip-')) throw new Error('Unexpected fixture path')
  removeSync(root)
})

function prepare(body: string, key = chapter, mode: '追加' | '更正' = '追加') {
  put('草稿区/定稿准备/审计/账本变更.md', `# 账本变更\n## 线索\n### 密信\n${body}\n`)
  return planSettlement(root, path.join(root, '草稿区/定稿准备/审计'), { 章节: key, 批准: true, 裁决记录: '测试批准' }, key, mode)
}

function legacy(body: string, extra = ''): string {
  return ['# 线索', '## 密信', '名称：密信', '类型：线索', '状态：已埋', '计划来源：本章新增',
    '实际落点：定稿/卷01/0001-线索往返.md', '来源：定稿/卷01/0001-线索往返.md', '裁决记录：已批准', extra,
    '### 正文', body, ''].filter(line => line !== '').join('\n')
}

describe('线索沉淀与到期查询往返', () => {
  it('新写入的线索字段位于系统区，能直接查询到期和逾期', () => {
    const planned = prepare('状态：已埋\n计划来源：本章新增\n埋设点：第1章\n预期兑现区间：第2-3章\n尚未找到收信人。')
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    writeBatchAtomic(root, planned.ops)
    const raw = fs.readFileSync(path.join(root, '账本/线索.md'), 'utf8')
    expect(raw.indexOf('预期兑现区间：第2-3章')).toBeLessThan(raw.indexOf('### 正文'))
    const read = queryLedger(root, { 分类: '线索' })
    expect(read.ok).toBe(true)
    expect(read.entries[0]?.字段).toMatchObject({ 埋设点: '第1章', 预期兑现区间: '第2-3章' })
    expect(read.entries[0]?.正文).toBe('尚未找到收信人。')
    expect(queryDueLedger(root, { 卷: 1, 章: 1 }).到期).toHaveLength(0)
    expect(queryDueLedger(root, { 卷: 1, 章: 2 }).到期).toHaveLength(1)
    expect(queryDueLedger(root, { 卷: 1, 章: 4 }).逾期[0]).toMatchObject({ 名称: '密信', 超出幅度: 1 })
  })

  it('保留弃因与正文后续同名字段，不把正文再次提取成元数据', () => {
    const planned = prepare('状态：已弃\n计划来源：本章新增\n埋设点：第1章\n预期兑现区间：第2-3章\n弃因：作者取消此线。\n原始标签记录：\n```text\n预期兑现区间：不得覆盖正式字段\n```')
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    writeBatchAtomic(root, planned.ops)
    const entry = queryLedger(root, { 分类: '线索' }).entries[0]!
    expect(entry.字段).toMatchObject({ 弃因: '作者取消此线。', 预期兑现区间: '第2-3章' })
    expect(entry.正文).toContain('预期兑现区间：不得覆盖正式字段')
    expect(queryDueLedger(root, { 卷: 1, 章: 4 }).到期).toHaveLength(0)
  })

  it('未弃线索的说明里出现弃因字样仍按正文保留', () => {
    const planned = prepare('状态：已埋\n计划来源：本章新增\n埋设点：第1章\n预期兑现区间：第2-3章\n- 弃因：\n旁注如下。\n弃因：作者曾考虑放弃，现保留。')
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    writeBatchAtomic(root, planned.ops)
    const entry = queryLedger(root, { 分类: '线索' }).entries[0]!
    expect(entry.字段['弃因']).toBeUndefined()
    expect(entry.正文).toBe('- 弃因：\n旁注如下。\n弃因：作者曾考虑放弃，现保留。')
  })

  it('旧沉淀正文前缀报告升级，不补字段且原文件不变', () => {
    const body = '埋设点：第1章\n预期兑现区间：第2-3章\n仍待查明。'
    const raw = legacy(body)
    put('账本/线索.md', raw)
    const read = queryLedger(root, { 分类: '线索' })
    expect(read).toMatchObject({ ok: false, kind: 'parse-error', entries: [] })
    expect(!read.ok && read.reason).toContain('预览升级')
    expect(queryDueLedger(root, { 卷: 1, 章: 4 }).ok).toBe(false)
    expect(fs.readFileSync(path.join(root, '账本/线索.md'), 'utf8')).toBe(raw)
  })

  it.each([
    '下面是抄录：\n埋设点：第1章\n预期兑现区间：第2-3章',
    '```text\n埋设点：第1章\n预期兑现区间：第2-3章\n```',
    '埋设点：第1章\n预期兑现区间：第2-3章\n预期兑现区间：第4-5章',
    '预期兑现区间：第2-3章\n没有完整字段。',
  ])('不从模糊旧正文猜字段：%s', body => {
    put('账本/线索.md', legacy(body))
    const read = queryLedger(root, { 分类: '线索' })
    if (body.startsWith('埋设点') || body.startsWith('预期兑现')) {
      expect(read).toMatchObject({ ok: false, kind: 'parse-error', entries: [] })
    } else {
      expect(read.ok).toBe(true)
      expect(read.entries[0]?.字段['预期兑现区间']).toBeUndefined()
      expect(queryDueLedger(root, { 卷: 1, 章: 4 }).区间不明).toHaveLength(1)
    }
  })

  it('无沉淀系统头的普通正文不启用兼容，已有系统字段优先', () => {
    put('账本/线索.md', '# 线索\n## 密信\n状态：已埋\n### 正文\n埋设点：第1章\n预期兑现区间：第2-3章')
    expect(queryLedger(root, { 分类: '线索' }).entries[0]?.字段['预期兑现区间']).toBeUndefined()
    put('账本/线索.md', legacy('埋设点：第1章\n预期兑现区间：第2-3章', '埋设点：第1章\n预期兑现区间：第8-9章'))
    expect(queryLedger(root, { 分类: '线索' }).entries[0]?.字段['预期兑现区间']).toBe('第8-9章')
  })

  it.each([
    ['状态：已埋\n计划来源：本章新增\n叙述开始。\n埋设点：第1章\n预期兑现区间：第2-3章', /埋设点不在条目开头/],
    ['状态：已埋\n计划来源：本章新增\n埋设点：第1章\n预期兑现区间：第2-3章\n预期兑现区间：第4-5章', /预期兑现区间重复/],
  ])('拒绝非前置或重复的线索候选字段：%s', (body, reason) => {
    expect(prepare(body)).toMatchObject({ ok: false, reason: expect.stringMatching(reason) })
    expect(fs.readFileSync(path.join(root, '账本/线索.md'), 'utf8')).toBe('# 线索\n')
  })

  it('追加已示与吃书更正后，当前态字段仍可读，已收退出到期', () => {
    const settle = (body: string, key: typeof chapter, mode?: '更正') => {
      const planned = prepare(body, key, mode)
      expect(planned.ok).toBe(true)
      if (planned.ok) writeBatchAtomic(root, planned.ops)
    }
    const second = { 卷: 1, 章: 2, 章名: '封口' }
    settle('状态：已埋\n计划来源：本章新增\n埋设点：第1章\n预期兑现区间：第3-4章\n密信藏进夹层。', chapter)
    settle('- 状态：已示\n- 计划来源：本章新增\n- 埋设点：第1章\n- 预期兑现区间：第3-4章\n读者看到了封口。', second)
    expect(queryDueLedger(root, { 卷: 1, 章: 3 }).到期.map(item => item.状态)).toEqual(['已示'])
    settle('状态：已收\n计划来源：本章新增\n埋设点：第1章\n预期兑现区间：第3-4章\n收信人当众拆开。', second, '更正')
    const current = queryLedger(root, { 分类: '线索' }).entries
    expect(current).toHaveLength(1)
    expect(current[0]?.字段).toMatchObject({ 状态: '已收', 预期兑现区间: '第3-4章' })
    expect(current[0]?.正文).toBe('收信人当众拆开。')
    expect(queryDueLedger(root, { 卷: 1, 章: 5 })).toMatchObject({ ok: true, 到期: [], 区间不明: [] })
  })
})
