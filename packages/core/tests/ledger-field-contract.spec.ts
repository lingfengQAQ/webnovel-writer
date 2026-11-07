import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  ACTIVE_CLUE_STATES, CLUE_FIELDS, CLUE_FIELD_RULES, CLUE_STATES, LEDGER_FIELD_KEYS, LEDGER_FIELD_RULES, LEDGER_STATES,
} from '../src/repo/ledger-field-contract'
import { CLUE_FIELDS as legacyModuleClueFields, hasLegacyClueFields } from '../src/ledger/clue'
import { LEDGER_KINDS, LEDGER_NAMES, paths } from '../src/repo/paths'
import { removeSync } from '../src/repo/remove'
import { checkLedgerSectionFields, parseLedgerSections, planSettlement, type LedgerSection } from '../src/settlement'
import { queryDueLedger, queryLedger } from '../src/ledger'

const temporary = fs.realpathSync.native(os.tmpdir())
const chapter = { 卷: 1, 章: 1, 章名: '字段核对' }
const packageRelative = paths.待定稿包目录(chapter.卷, chapter.章名)
let root: string

function put(relative: string, text: string): void {
  const filename = path.join(root, relative)
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  fs.writeFileSync(filename, text, 'utf8')
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(temporary, 'webnovel-ledger-fields-'))
  for (const kind of LEDGER_NAMES) put(paths.账本(kind), `# ${kind}\n`)
})
afterEach(() => {
  if (path.dirname(root) !== temporary || !path.basename(root).startsWith('webnovel-ledger-fields-')) throw new Error('Unexpected fixture path')
  removeSync(root)
})

function section(kind: LedgerSection['kind'], state: string): LedgerSection {
  return {
    kind, title: '事项',
    body: [
      `状态：${state}`, '计划来源：本章新增',
      ...(kind === '线索' ? ['埋设点：第1章', '预期兑现区间：第2-3章', ...(state === '已弃' ? ['弃因：作者终止。'] : [])] : []),
      '正文记载。',
    ].join('\n'),
  }
}

const statesFor = (kind: LedgerSection['kind']): readonly string[] => kind === '线索' ? CLUE_STATES : LEDGER_STATES
const wrongStatesFor = (kind: LedgerSection['kind']): readonly string[] => kind === '线索' ? LEDGER_STATES : CLUE_STATES
const validStates = LEDGER_KINDS.flatMap(kind => statesFor(kind).map(state => [kind, state] as const))
const crossDomainStates = LEDGER_KINDS.flatMap(kind => wrongStatesFor(kind).map(state => [kind, state] as const))

describe('shared current ledger fields', () => {
  it('keeps the current key order, field ownership and separate state domains explicit', () => {
    expect(LEDGER_FIELD_KEYS).toEqual(['名称', '类型', '状态', '计划来源', '实际落点', '来源', '裁决记录'])
    expect(Object.keys(LEDGER_FIELD_RULES)).toEqual([...LEDGER_FIELD_KEYS])
    expect(LEDGER_FIELD_RULES.名称).toMatchObject({ owner: 'heading', empty: 'use-heading' })
    expect(LEDGER_FIELD_RULES.状态).toMatchObject({ owner: 'candidate', candidate: 'required-domain-state', empty: 'reject' })
    expect(LEDGER_FIELD_RULES.来源).toMatchObject({ owner: 'settlement', candidate: 'overwritten' })
    expect(CLUE_FIELDS).toEqual(['埋设点', '预期兑现区间', '弃因'])
    expect(Object.keys(CLUE_FIELD_RULES)).toEqual([...CLUE_FIELDS])
    expect(CLUE_FIELD_RULES.弃因).toMatchObject({ candidate: 'required-when-abandoned', empty: 'allowed-unless-abandoned' })
    expect(legacyModuleClueFields).toBe(CLUE_FIELDS)
    expect(LEDGER_STATES).toEqual(['进行中', '已兑现', '已结束', '已放弃'])
    expect(CLUE_STATES).toEqual(['已埋', '已示', '已收', '已弃'])
    expect(ACTIVE_CLUE_STATES).toEqual(['已埋', '已示'])
  })

  it.each(validStates)('accepts the current %s state %s', (kind, state) => {
    expect(() => checkLedgerSectionFields(section(kind, state))).not.toThrow()
  })

  it.each(crossDomainStates)('rejects another domain state for %s: %s', (kind, state) => {
    expect(() => checkLedgerSectionFields(section(kind, state))).toThrow(`状态非法「${state}」`)
  })

  for (const conflicting of [false, true]) {
    it.each(LEDGER_FIELD_KEYS)(`rejects duplicate leading %s (conflicting=${conflicting})`, field => {
      const base = section('承诺', '进行中')
      const values = { 名称: '事项', 类型: '承诺', 状态: '进行中', 计划来源: '本章新增', 实际落点: '候选位置', 来源: '候选来源', 裁决记录: '候选裁决' }
      const lines = base.body.split('\n').filter(line => !line.startsWith(`${field}：`))
      const body = [`${field}：${values[field]}`, `${field}：${conflicting ? '不同的值' : values[field]}`, ...lines].join('\n')
      expect(() => checkLedgerSectionFields({ ...base, body })).toThrow(`${field}字段重复`)
    })
  }

  it.each(CLUE_FIELDS)('rejects duplicate clue %s before its prose', field => {
    const base = section('线索', '已弃')
    const body = base.body.replace('正文记载。', `${field}：另一条值\n正文记载。`)
    expect(() => checkLedgerSectionFields({ ...base, body })).toThrow(`${field}重复`)
  })

  it('requires a reason only for abandoned clues and preserves the non-abandoned empty line as prose', () => {
    const abandoned = section('线索', '已弃')
    expect(() => checkLedgerSectionFields({ ...abandoned, body: abandoned.body.replace('弃因：作者终止。\n', '') })).toThrow('已弃但缺少弃因')
    expect(() => checkLedgerSectionFields({ ...abandoned, body: abandoned.body.replace('弃因：作者终止。', '弃因：') })).toThrow('已弃但缺少弃因')
    const active = section('线索', '已示')
    expect(() => checkLedgerSectionFields({ ...active, body: active.body.replace('正文记载。', '弃因：\n正文记载。') })).not.toThrow()
  })

  it.each(LEDGER_KINDS)('serializes %s with the same field ordering and approved source values', kind => {
    const item = section(kind, kind === '线索' ? '已埋' : '进行中')
    const body = `名称：事项\n类型：${kind}\n实际落点：忽略位置\n来源：忽略来源\n裁决记录：忽略裁决\n${item.body}`
    put(`${packageRelative}/账本变更.md`, `# 账本变更\n## ${kind}\n### 事项\n${body}\n`)
    const plan = planSettlement(root, path.join(root, packageRelative), { 章节: chapter, 批准: true, 裁决记录: '本次批准' }, chapter)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const source = paths.定稿章(chapter.卷, chapter.章, chapter.章名)
    expect(plan.ops).toEqual([{
      relPath: paths.账本(kind),
      content: [`# ${kind}`, '', '## 事项', '名称：事项', `类型：${kind}`, `状态：${kind === '线索' ? '已埋' : '进行中'}`, '计划来源：本章新增',
        ...(kind === '线索' ? ['埋设点：第1章', '预期兑现区间：第2-3章'] : []),
        `实际落点：${source}`, `来源：${source}`, '裁决记录：本次批准', '### 正文', '正文记载。', ''].join('\n'),
    }])
  })

  it.each(LEDGER_NAMES)('keeps the legacy accepted reader field set for %s without requiring candidate states', kind => {
    const accepted = ['名称', '类型', '状态', '计划来源', '实际落点', '来源', '裁决记录', '埋设点', '预期兑现区间', '弃因', '事件', '章号', '类']
    const text = [`# ${kind}`, '## 事项', ...accepted.map(field => `${field}：原值-${field}`), '时点：旧正文原值', '### 正文', '原始说明。'].join('\n')
    put(paths.账本(kind), text)
    const read = queryLedger(root, { 分类: kind })
    expect(read.ok).toBe(true)
    const entry = read.entries[0]!
    expect(Object.keys(entry.字段).sort()).toEqual([...accepted, ...(kind === '时间线' ? ['时点'] : [])].sort())
    expect(entry.字段['状态']).toBe('原值-状态')
    expect(entry.正文).toBe(kind === '时间线' ? '原始说明。' : '时点：旧正文原值\n原始说明。')
    expect(fs.readFileSync(path.join(root, paths.账本(kind)), 'utf8')).toBe(text)
  })

  it('does not make historical missing states invalid merely because candidate states are required', () => {
    put(paths.账本('承诺'), '# 承诺\n## 旧事项\n### 正文\n缺少状态但仍须可读的旧原文。\n')
    const result = queryLedger(root, { 分类: '承诺' })
    expect(result.ok).toBe(true)
    expect(result.entries[0]).toMatchObject({ 名称: '旧事项', 字段: {}, 正文: '缺少状态但仍须可读的旧原文。' })
    expect(() => checkLedgerSectionFields({ kind: '承诺', title: '旧事项', body: '计划来源：本章新增\n原文。' })).toThrow('缺少状态字段')
  })

  it('uses only the active clue-state subset for due queries', () => {
    const text = ['# 线索', ...[...CLUE_STATES, '其他状态'].flatMap((state, index) => [
      `## 事项${index}`, `状态：${state}`, '埋设点：第1章', '预期兑现区间：第2-3章', '### 正文', '原文。',
    ])].join('\n')
    put(paths.账本('线索'), text)
    const result = queryDueLedger(root, { 卷: 1, 章: 4 })
    expect(result.ok).toBe(true)
    expect(result.到期.map(entry => entry.状态)).toEqual([...ACTIVE_CLUE_STATES])
    expect(result.逾期).toHaveLength(2)
  })

  it('retains the original seven-field legacy detector independently of current contracts', () => {
    const oldHeader = { 名称: '旧事项', 类型: '线索', 状态: '已埋', 计划来源: '本章新增', 实际落点: '定稿/卷01/0001-旧章.md', 来源: '定稿/卷01/0001-旧章.md', 裁决记录: '旧批准' }
    const prose = '埋设点：第1章\n预期兑现区间：第2-3章\n旧原文。'
    expect(hasLegacyClueFields(oldHeader, prose)).toBe(true)
    for (const omitted of ['名称', '类型', '状态', '计划来源', '实际落点', '来源', '裁决记录']) {
      const partial = Object.fromEntries(Object.entries(oldHeader).filter(([key]) => key !== omitted))
      expect(hasLegacyClueFields(partial, prose)).toBe(false)
    }
    const modern = { ...oldHeader, 埋设点: '第8章', 预期兑现区间: '第9章' }
    expect(hasLegacyClueFields(modern, prose)).toBe(false)
  })

  it('retains parsed title-line diagnostics for a conflicting identity', () => {
    const [item] = parseLedgerSections('# 账本变更\n\n## 承诺\n### 事项\n名称：另一事项\n状态：进行中\n计划来源：本章新增\n说明。')
    expect(() => checkLedgerSectionFields(item!)).toThrow('账本变更第 4 行：条目「承诺/事项」名称与标题存在歧义')
  })
})
