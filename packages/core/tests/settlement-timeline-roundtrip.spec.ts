import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { LEDGER_NAMES, parseTimelineSections, paths, planSettlement, queryLedger, writeBatchAtomic } from '../src'
import { removeSync } from '../src/repo/remove'

const temporary = fs.realpathSync.native(os.tmpdir())
const key = { 卷: 1, 章: 1, 章名: '进城' }
let root: string
function put(relative: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), text, 'utf8')
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(temporary, 'webnovel-timeline-contract-'))
  for (const name of LEDGER_NAMES) put(paths.账本(name), `# ${name}\n`)
})
afterEach(() => {
  if (path.dirname(root) !== temporary || !path.basename(root).startsWith('webnovel-timeline-contract-')) throw new Error('Unexpected fixture path')
  removeSync(root)
})

function prepare(candidate: string, mode: '追加' | '更正' = '追加', approved = true) {
  const pkg = '草稿区/定稿准备/时间线'
  put(`${pkg}/时间线变更.md`, candidate)
  return planSettlement(root, path.join(root, pkg), { 章节: key, 批准: approved, 裁决记录: '作者确认' }, key, mode)
}
function settle(candidate: string, mode: '追加' | '更正' = '追加'): void {
  const plan = prepare(candidate, mode)
  expect(plan.ok, !plan.ok ? plan.reason : '').toBe(true)
  if (!plan.ok) throw new Error(plan.reason)
  writeBatchAtomic(root, plan.ops)
}

describe('RW05 timeline production-to-query contract', () => {
  it.each(['清晨', '三日后', '景历三年五月初一', '未知'])('writes and reads the original story time: %s', time => {
    settle(`## 抵达城门\n事件：甲进城。\n时点：${time}\n章号：第0099章\n来源：候选来源\n裁决记录：候选裁决\n抵达后接受盘查。\n`)
    const raw = fs.readFileSync(path.join(root, paths.账本('时间线')), 'utf8')
    expect(raw.indexOf('事件：甲进城。')).toBeLessThan(raw.indexOf('### 正文'))
    expect(raw.indexOf(`时点：${time}`)).toBeLessThan(raw.indexOf('### 正文'))
    const read = queryLedger(root, { 分类: '时间线' })
    expect(read.ok).toBe(true)
    expect(read.entries[0]).toMatchObject({ 名称: '抵达城门', 正文: '抵达后接受盘查。', 字段: {
      事件: '甲进城。', 时点: time, 章号: '第0001章', 来源: paths.定稿章(1, 1, key.章名), 裁决记录: '作者确认',
    } })
  })

  it.each(['', '时点：\n'])('writes an explicit unknown for absent story time without using chapter or prose: %j', timeLine => {
    const prose = '以下为纸条原文：\n时点：另一日。\n```text\n事件：纸条内容。\n时点：三更。\n```'
    settle(`## 抵达城门\n事件：甲进城。\n${timeLine}${prose}\n`)
    const entry = queryLedger(root, { 分类: '时间线' }).entries[0]!
    expect(entry.字段['时点']).toBe('未知')
    expect(entry.正文).toBe(prose)
  })

  it('allows an event with no additional narrative instead of inventing prose', () => {
    settle('## 抵达城门\n事件：甲进城。\n')
    expect(queryLedger(root, { 分类: '时间线' }).entries[0]).toMatchObject({ 正文: '', 字段: { 时点: '未知' } })
  })

  it.each(['## 抵达城门\n时点：清晨\n', '## 抵达城门\n事件：\n', '## 抵达城门\n引文如下。\n事件：甲进城。\n'])('rejects missing or non-leading events without writing: %s', text => {
    const original = fs.readFileSync(path.join(root, paths.账本('时间线')), 'utf8')
    expect(prepare(text)).toMatchObject({ ok: false, reason: expect.stringContaining('事件') })
    expect(fs.readFileSync(path.join(root, paths.账本('时间线')), 'utf8')).toBe(original)
  })

  it('preserves a known structured time when a correction omits it, but permits explicit unknown', () => {
    settle('## 抵达城门\n事件：甲进城。\n时点：三日后\n保留说明。\n')
    settle('## 抵达城门\n事件：甲被拒之城外。\n更正说明。\n', '更正')
    expect(queryLedger(root, { 分类: '时间线' }).entries[0]?.字段).toMatchObject({ 事件: '甲被拒之城外。', 时点: '三日后' })
    settle('## 抵达城门\n事件：甲未能入城。\n时点：未知\n更正说明。\n', '更正')
    expect(queryLedger(root, { 分类: '时间线' }).entries[0]?.字段['时点']).toBe('未知')
  })

  it('preserves the latest explicit time through sequential corrections of the same target', () => {
    settle('## 抵达城门\n事件：甲进城。\n时点：三日后\n')
    settle('## 抵达城门\n事件：甲抵达城外。\n时点：五日后\n## 抵达城门\n事件：甲尚未进城。\n', '更正')
    const entries = queryLedger(root, { 分类: '时间线' }).entries
    expect(entries).toHaveLength(1)
    expect(entries[0]?.字段).toMatchObject({ 事件: '甲尚未进城。', 时点: '五日后' })
  })

  it('does not infer fields from old free prose or silently rewrite the old record', () => {
    const old = '# 时间线\n## 旧事件\n章号：第0001章\n来源：定稿/卷01/0001-进城.md\n### 正文\n事件：甲进城。\n时点：清晨\n'
    put(paths.账本('时间线'), old)
    const read = queryLedger(root, { 分类: '时间线' })
    expect(read.entries[0]?.字段['时点']).toBeUndefined()
    expect(read.entries[0]?.正文).toContain('时点：清晨')
    expect(fs.readFileSync(path.join(root, paths.账本('时间线')), 'utf8')).toBe(old)
  })

  it('does not turn another domain time-looking prose into a field', () => {
    put(paths.账本('承诺'), '# 承诺\n## 信守约定\n时点：作者说明\n### 正文\n承诺正文。\n')
    const entry = queryLedger(root, { 分类: '承诺' }).entries[0]!
    expect(entry.字段['时点']).toBeUndefined()
    expect(entry.正文).toBe('时点：作者说明\n承诺正文。')
  })

  it('retains duplicate-field rejection and the author approval boundary', () => {
    expect(() => parseTimelineSections('## 抵达城门\n事件：甲进城。\n时点：清晨\n时点：傍晚\n')).toThrow(/时点重复/)
    expect(prepare('## 抵达城门\n事件：甲进城。\n', '追加', false)).toMatchObject({ ok: false })
    expect(fs.readFileSync(path.join(root, paths.账本('时间线')), 'utf8')).toBe('# 时间线\n')
  })
})
