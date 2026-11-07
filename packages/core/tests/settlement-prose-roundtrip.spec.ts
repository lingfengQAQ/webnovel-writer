import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { LEDGER_KINDS, LEDGER_NAMES, paths, planSettlement, queryLedger, writeBatchAtomic } from '../src/index'
import { removeSync } from '../src/repo/remove'

const temporary = fs.realpathSync.native(os.tmpdir())
const chapter = { 卷: 1, 章: 1, 章名: '正文保真' }
const packageRelative = '草稿区/定稿准备/正文保真'
let root: string

function put(relative: string, text: string): void {
  const filename = path.join(root, relative)
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  fs.writeFileSync(filename, text, 'utf8')
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(temporary, 'webnovel-settlement-prose-'))
  for (const name of LEDGER_NAMES) put(paths.账本(name), `# ${name}\n`)
})
afterEach(() => {
  if (path.dirname(root) !== temporary || !path.basename(root).startsWith('webnovel-settlement-prose-')) throw new Error('Unexpected fixture path')
  removeSync(root)
})

function prepare(candidate: string, timeline = false, mode: '追加' | '更正' = '追加') {
  put(`${packageRelative}/账本变更.md`, timeline ? '' : candidate)
  put(`${packageRelative}/时间线变更.md`, timeline ? candidate : '')
  return planSettlement(root, path.join(root, packageRelative), { 章节: chapter, 批准: true, 裁决记录: '测试作者批准' }, chapter, mode)
}

function settle(candidate: string, timeline = false, mode: '追加' | '更正' = '追加'): void {
  const plan = prepare(candidate, timeline, mode)
  expect(plan.ok, !plan.ok ? plan.reason : '').toBe(true)
  if (!plan.ok) throw new Error(plan.reason)
  writeBatchAtomic(root, plan.ops)
}

describe('RW04: settlement preserves prose after the leading field region', () => {
  it.each(LEDGER_KINDS)('roundtrips ordinary and fenced field-looking prose in %s', kind => {
    const prose = [
      '纸条原文如下：', '',
      '名称：纸条署名，不是条目身份。',
      `类型: ${kind}`,
      '状态：这是一段引文。',
      '计划来源: 纸条中写下的猜测。',
      '实际落点：纸条角落。',
      '来源：匿名线人，尚未证实。',
      '裁决记录: 纸条上并无作者裁决。', '',
      '```text',
      '- 来源: 原文里的来源行不能删除。',
      '* 状态：正文里的状态不能覆盖正式状态。',
      '预期兑现区间：这是引文而非正式区间。',
      '```', '', '这段原文仍待核实。',
    ].join('\n')
    const fields = ['- 名称：保留记录', `类型: ${kind}`, '', `状态：${kind === '线索' ? '已埋' : '进行中'}`, '* 计划来源: 本章新增',
      '来源：候选来源不被信任', '实际落点: 候选位置不被信任', '裁决记录：候选裁决不被信任',
      ...(kind === '线索' ? ['埋设点：第1章', '预期兑现区间：第2-3章'] : [])].join('\n')
    settle(`## ${kind}\n### 保留记录\n${fields}\n${prose}\n`)
    const read = queryLedger(root, { 分类: kind })
    expect(read.ok).toBe(true)
    expect(read.entries).toHaveLength(1)
    expect(read.entries[0]?.正文).toBe(prose)
    expect(read.entries[0]?.字段).toMatchObject({
      名称: '保留记录', 类型: kind, 状态: kind === '线索' ? '已埋' : '进行中', 计划来源: '本章新增',
      来源: paths.定稿章(chapter.卷, chapter.章, chapter.章名), 裁决记录: '测试作者批准',
    })
    if (kind === '线索') expect(read.entries[0]?.字段['预期兑现区间']).toBe('第2-3章')
  })

  it('does not treat optional type or name lines in prose as metadata', () => {
    const prose = '这是引文，不是系统字段：\n类型：自由文字\n名称: 另一名字\n来源：口述。'
    settle(`## 承诺\n### 保留记录\n状态：进行中\n计划来源：本章新增\n${prose}\n`)
    const entry = queryLedger(root, { 分类: '承诺' }).entries[0]!
    expect(entry.字段).toMatchObject({ 名称: '保留记录', 类型: '承诺' })
    expect(entry.正文).toBe(prose)
  })

  it.each(['状态', '计划来源', '名称', '类型'])('rejects duplicate leading %s without writing', field => {
    const value = { 状态: '进行中', 计划来源: '本章新增', 名称: '保留记录', 类型: '承诺' }[field]!
    const candidate = `## 承诺\n### 保留记录\n状态：进行中\n计划来源：本章新增\n${field}: ${value}\n${field}：${value}\n说明原文。\n`
    const before = fs.readFileSync(path.join(root, paths.账本('承诺')), 'utf8')
    expect(prepare(candidate)).toMatchObject({ ok: false, reason: expect.stringMatching(new RegExp(`${field}.*重复`)) })
    expect(fs.readFileSync(path.join(root, paths.账本('承诺')), 'utf8')).toBe(before)
  })

  it.each([
    ['状态', '计划来源：本章新增\n说明已经开始。\n状态：进行中'],
    ['计划来源', '状态：进行中\n说明已经开始。\n计划来源：本章新增'],
    ['状态', '计划来源：本章新增\n```text\n状态：进行中\n```'],
  ])('rejects a required %s found only after prose begins', (field, body) => {
    const before = fs.readFileSync(path.join(root, paths.账本('承诺')), 'utf8')
    expect(prepare(`## 承诺\n### 保留记录\n${body}\n`)).toMatchObject({ ok: false, reason: expect.stringMatching(new RegExp(`${field}.*不在.*开头`)) })
    expect(fs.readFileSync(path.join(root, paths.账本('承诺')), 'utf8')).toBe(before)
  })

  it.each([false, true])('roundtrips structured timeline fields while preserving prose (source first=%s)', sourceFirst => {
    const event = '事件：甲进城。\n时点: 清晨'
    const generated = '章号：第0099章\n来源: 候选来源不被信任\n裁决记录：候选裁决不被信任'
    const prose = '纸条原文如下：\n来源：匿名线人，尚未证实。\n```text\n章号: 纸条写的是别章\n裁决记录：这是引文\n```'
    settle(`## 进城\n${sourceFirst ? `${generated}\n${event}` : `${event}\n${generated}`}\n${prose}\n`, true)
    const read = queryLedger(root, { 分类: '时间线' })
    expect(read.ok).toBe(true)
    expect(read.entries[0]?.正文).toBe(prose)
    expect(read.entries[0]?.字段).toMatchObject({ 事件: '甲进城。', 时点: '清晨', 章号: '第0001章', 来源: paths.定稿章(1, 1, chapter.章名), 裁决记录: '测试作者批准' })
  })

  it.each(['事件', '时点', '章号', '来源', '裁决记录'])('rejects duplicate leading timeline %s', field => {
    expect(prepare(`## 进城\n事件：甲进城。\n${field}: 重复值\n${field}：重复值\n说明。\n`, true))
      .toMatchObject({ ok: false, reason: expect.stringMatching(new RegExp(`${field}.*重复`)) })
    expect(fs.readFileSync(path.join(root, paths.账本('时间线')), 'utf8')).toBe('# 时间线\n')
  })

  it('rejects a timeline event field that appears only inside a prose example', () => {
    expect(prepare('## 进城\n时点：清晨\n纸条原文如下：\n```text\n事件：甲进城。\n```\n', true))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/事件字段.*不在.*开头/) })
  })

  it('keeps field-looking names in correction prose and does not alter another entry', () => {
    settle('## 承诺\n### 保留记录\n状态：进行中\n计划来源：本章新增\n旧错误。\n### 其他记录\n状态：进行中\n计划来源：本章新增\n其他原文。\n')
    const prose = '这是更正后的完整原文：\n名称：正文署名，不是条目名。\n类型: 自由文字\n```text\n来源：作者引用的纸条。\n```'
    settle(`## 承诺\n### 保留记录\n名称：保留记录\n状态：已结束\n计划来源：本章新增\n${prose}\n`, false, '更正')
    const read = queryLedger(root, { 分类: '承诺' })
    expect(read.ok).toBe(true)
    expect(read.entries.find(entry => entry.名称 === '保留记录')?.正文).toBe(prose)
    expect(read.entries.find(entry => entry.名称 === '其他记录')?.正文).toBe('其他原文。')
    expect(read.entries.find(entry => entry.名称 === '保留记录')?.字段['状态']).toBe('已结束')
    expect(fs.readFileSync(path.join(root, paths.账本('承诺')), 'utf8')).not.toContain('旧错误')
  })
})
