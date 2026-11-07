import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { LEDGER_KINDS, LEDGER_NAMES, paths } from '../src/repo/paths'
import { serializeDocument } from '../src/repo/frontmatter'
import { writeBatchAtomic } from '../src/repo/atomic'
import { removeSync } from '../src/repo/remove'
import { planSettlement, type LedgerSection } from '../src/settlement'
import { queryLedger } from '../src/ledger'
import { preparePack } from '../src/prepare/pack'

const temporary = fs.realpathSync.native(os.tmpdir())
const chapter = { 卷: 1, 章: 1, 章名: '身份核对' }
const packageRelative = paths.待定稿包目录(chapter.卷, chapter.章名)
const title = '账本条目'
let root: string

function put(relative: string, content: string): void {
  const filename = path.join(root, relative)
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  fs.writeFileSync(filename, content, 'utf8')
}

function files(): Record<string, string> {
  const result: Record<string, string> = {}
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.webnovel') continue
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(filename)
      else result[path.relative(root, filename)] = fs.readFileSync(filename, 'utf8')
    }
  }
  walk(root)
  return result
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(temporary, 'webnovel-ledger-identity-'))
  for (const kind of LEDGER_NAMES) put(paths.账本(kind), `# ${kind}\n`)
})
afterEach(() => {
  if (path.dirname(root) !== temporary || !path.basename(root).startsWith('webnovel-ledger-identity-')) throw new Error('Unexpected fixture path')
  removeSync(root)
})

function candidate(kind: LedgerSection['kind'], name?: string, prose = '本章明确发生的事。', status?: string): string {
  return [
    '# 账本变更', `## ${kind}`, `### ${title}`,
    ...(name === undefined ? [] : [`名称：${name}`]),
    `状态：${status ?? (kind === '线索' ? '已埋' : '进行中')}`, '计划来源：本章新增',
    ...(kind === '线索' ? ['埋设点：第1章', '预期兑现区间：第2-3章'] : []), prose, '',
  ].join('\n')
}

function plan(text: string, mode: '追加' | '更正' = '追加', key = chapter) {
  put(`${packageRelative}/账本变更.md`, text)
  return planSettlement(root, path.join(root, packageRelative), { 章节: key, 批准: true, 裁决记录: '批准本次沉淀' }, key, mode)
}

describe('ledger candidate identity uses its heading', () => {
  it.each(LEDGER_KINDS)('rejects a conflicting leading name before planning %s writes', kind => {
    put(`${packageRelative}/账本变更.md`, candidate(kind, '另一条目'))
    const before = files()
    const result = planSettlement(root, path.join(root, packageRelative), { 章节: chapter, 批准: true, 裁决记录: '批准本次沉淀' }, chapter)
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('名称与标题存在歧义') })
    if (!result.ok) {
      expect(result.reason).toContain(title)
      expect(result.reason).toContain('另一条目')
    }
    expect(files()).toEqual(before)
  })

  it.each(LEDGER_KINDS)('rejects the same identity conflict in preparePack for %s without creating a package', kind => {
    put(`${paths.草稿目录(chapter.卷, chapter.章名)}/稿1.md`, serializeDocument({ 角色: '待审稿', 选定: true, 版本: 1 }, '原稿正文。'))
    const before = files()
    const result = preparePack(root, chapter, { 账本变更: candidate(kind, '另一条目') })
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('名称与标题存在歧义') })
    expect(fs.existsSync(path.join(root, packageRelative))).toBe(false)
    expect(files()).toEqual(before)
  })

  for (const kind of LEDGER_KINDS) {
    it.each([undefined, '', title])('retains one heading identity through preparation and correction for ' + kind + ': %j', name => {
      const initial = plan(candidate(kind, title, '原有事实。'))
      expect(initial.ok).toBe(true)
      if (!initial.ok) return
      writeBatchAtomic(root, initial.ops)
      put(`${paths.草稿目录(chapter.卷, chapter.章名)}/稿1.md`, serializeDocument({ 角色: '待审稿', 选定: true, 版本: 1 }, '更正后的正文。'))
      expect(preparePack(root, chapter, { 账本变更: candidate(kind, name, '更正后的事实。') })).toMatchObject({ ok: true })
      const corrected = plan(candidate(kind, name, '更正后的事实。'), '更正')
      expect(corrected).toMatchObject({ ok: true })
      if (!corrected.ok) return
      writeBatchAtomic(root, corrected.ops)
      expect(queryLedger(root, { 分类: kind }).entries).toMatchObject([{ 名称: title, 字段: { 名称: title }, 正文: '更正后的事实。' }])
    })

    it('rejects a conflicting correction name without altering ' + kind, () => {
      const initial = plan(candidate(kind, title))
      expect(initial.ok).toBe(true)
      if (!initial.ok) return
      writeBatchAtomic(root, initial.ops)
      put(`${packageRelative}/账本变更.md`, candidate(kind, '另一条目'))
      const before = files()
      expect(planSettlement(root, path.join(root, packageRelative), { 章节: chapter, 批准: true, 裁决记录: '批准本次沉淀' }, chapter, '更正'))
        .toMatchObject({ ok: false, reason: expect.stringContaining('名称与标题存在歧义') })
      expect(files()).toEqual(before)
    })

    it('still refuses an ambiguous existing target with an empty name for ' + kind, () => {
      const original = `# ${kind}\n## ${title}\n名称：\n类型：${kind}\n状态：旧状态\n### 正文\n旧事实。\n`
      put(paths.账本(kind), original)
      expect(plan(candidate(kind, ''), '更正')).toMatchObject({ ok: false, reason: expect.stringContaining('名称与标题存在歧义') })
      expect(fs.readFileSync(path.join(root, paths.账本(kind)), 'utf8')).toBe(original)
    })

    it.each([undefined, '', title])('keeps omitted, empty or matching names for ' + kind + ': %j', name => {
      const result = plan(candidate(kind, name))
      expect(result.ok).toBe(true)
      if (!result.ok) return
      writeBatchAtomic(root, result.ops)
      expect(queryLedger(root, { 分类: kind }).entries[0]).toMatchObject({ 名称: title, 字段: { 名称: title, 类型: kind } })
    })

    it.each([
      '纸条上的署名如下。\n名称：另一条目',
      '```text\n名称：另一条目\n```',
    ])('preserves a different name inside ' + kind + ' prose: %s', prose => {
      const result = plan(candidate(kind, title, prose))
      expect(result.ok).toBe(true)
      if (!result.ok) return
      writeBatchAtomic(root, result.ops)
      expect(queryLedger(root, { 分类: kind }).entries[0]).toMatchObject({ 名称: title, 字段: { 名称: title }, 正文: prose })
    })
  }

  it('does not reinterpret legacy contradictory identity and still refuses an ambiguous correction', () => {
    const original = '# 承诺\r\n## 账本条目\r\n名称：另一条目\r\n状态：进行中\r\n### 正文\r\n旧原文。\r\n'
    put(paths.账本('承诺'), original)
    expect(queryLedger(root, { 分类: '承诺' }).entries[0]).toMatchObject({ 名称: title, 字段: { 名称: '另一条目' } })
    expect(plan(candidate('承诺', title), '更正')).toMatchObject({ ok: false, reason: expect.stringContaining('名称与标题存在歧义') })
    expect(fs.readFileSync(path.join(root, paths.账本('承诺')), 'utf8')).toBe(original)
  })

  it('retains one identity across append, historical query and correction while preserving other entries', () => {
    const initial = plan(candidate('承诺', title, '首次作出的承诺。'))
    expect(initial.ok).toBe(true)
    if (!initial.ok) return
    writeBatchAtomic(root, initial.ops)
    const original = fs.readFileSync(path.join(root, paths.账本('承诺')), 'utf8')
    const other = '\n## 另一事项\n名称：另一事项\n类型：承诺\n状态：进行中\n计划来源：本章新增\n### 正文\n另一事项的原文。\n'
    put(paths.账本('承诺'), original + other)
    const second = { 卷: 1, 章: 2, 章名: '兑现承诺' }
    const appended = plan(candidate('承诺', title, '承诺已经兑现。', '已兑现'), '追加', second)
    expect(appended.ok).toBe(true)
    if (!appended.ok) return
    writeBatchAtomic(root, appended.ops)
    expect(queryLedger(root, { 分类: '承诺', 名称: title }).entries).toHaveLength(1)
    expect(queryLedger(root, { 分类: '承诺', 名称: title }).entries[0]?.字段).toMatchObject({ 名称: title, 状态: '已兑现', 来源: paths.定稿章(1, 2, second.章名), 裁决记录: '批准本次沉淀' })
    expect(queryLedger(root, { 分类: '承诺', 名称: title, 章上限: 1 }).entries[0]?.字段['状态']).toBe('进行中')
    const corrected = plan(candidate('承诺', title, '更正后的完整记载。', '已结束'), '更正', second)
    expect(corrected.ok).toBe(true)
    if (!corrected.ok) return
    writeBatchAtomic(root, corrected.ops)
    expect(queryLedger(root, { 分类: '承诺', 名称: title }).entries[0]).toMatchObject({ 字段: { 名称: title, 状态: '已结束' }, 正文: '更正后的完整记载。' })
    expect(fs.readFileSync(path.join(root, paths.账本('承诺')), 'utf8')).toContain(other.trimEnd())
  })
})
