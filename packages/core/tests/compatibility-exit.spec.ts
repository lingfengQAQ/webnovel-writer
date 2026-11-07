import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { queryLedger, queryMemory, queryDueLedger } from '../src/ledger'
import { planUpgradeRules } from '../src/maintenance/upgrade-rules'
import { readBookMemoryCatalog, readAuthorMemoryCatalog, renderMemoryCatalog } from '../src/memory/catalog'
import { listBookMemoryEntries, rebuildBookMemoryIndex, writeBookMemory, bookMemoryOps } from '../src/memory/book'
import { parseMemoryIndexLinks } from '../src/repo/memory-index-links'
import { parseLegacyMemoryIndexLinks } from '../src/repo/legacy-memory-index-links'
import { inspectBookDocuments } from '../src/maintenance/inspection'
import { serializeDocument } from '../src/repo/frontmatter'
import { LEDGER_NAMES } from '../src/repo/paths'
import { removeSync } from '../src/repo/remove'

let root: string | undefined
afterEach(() => { if (root) removeSync(root); root = undefined })
it('retired producer shapes are refused until explicit migration, then use the current query/catalog chain', () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-exit-'))
  const files = new Map(LEDGER_NAMES.map(name => [`账本/${name}.md`, `# ${name}\n`]))
  for (const [name, file] of [['clue', '账本/线索.md'], ['timeline', '账本/时间线.md'], ['memory', '本书记忆/决策.md']]) {
    files.set(file!, fs.readFileSync(path.join(__dirname, `fixtures/maintenance-upgrade/historical-${name}.md`), 'utf8'))
  }
  files.set('本书记忆/索引.md', '# 本书记忆索引\n- [决策](决策.md)\n')
  const put = (relative: string, text: string) => { const target = path.join(root!, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text) }
  for (const [file, text] of files) put(file, text)
  expect(queryLedger(root)).toMatchObject({ ok: false, kind: 'parse-error', entries: [] })
  expect(queryDueLedger(root, { 卷: 1, 章: 5 })).toMatchObject({ ok: false, 到期: [], 逾期: [] })
  expect(queryMemory(root)).toMatchObject({ ok: false, entries: [] })
  expect(readBookMemoryCatalog(root).状态).toBe('读取错误')
  expect(() => listBookMemoryEntries(root!)).toThrow('预览升级')
  for (const [file, text] of files) expect(fs.readFileSync(path.join(root, file), 'utf8')).toBe(text)
  expect(fs.existsSync(path.join(root, '.webnovel'))).toBe(false)
  const plan = planUpgradeRules(files)
  expect(plan.issues).toEqual([])
  expect(new Set(plan.changes.flatMap(change => change.rules))).toEqual(new Set(['C1-v1', 'C2-v1', 'C5-v1']))
  for (const change of plan.changes) { put(change.relPath, change.after); files.set(change.relPath, change.after) }
  expect(queryLedger(root).ok).toBe(true)
  expect(queryLedger(root, { 分类: '线索' }).entries[0]!.字段['埋设点']).toBe('第0003章')
  expect(queryLedger(root, { 分类: '时间线' }).entries[0]!.字段['时点']).toBe('次日清晨')
  expect(queryMemory(root)).toMatchObject({ ok: true, entries: [{ 名称: '保留渡口视角' }] })
  expect(readBookMemoryCatalog(root).状态).toBe('正常')
  expect(planUpgradeRules(files)).toEqual({ changes: [], issues: [] })
})

it('retired raw-percent targets are accepted only by the maintenance parser, never aliased to a current filename', () => {
  expect(parseMemoryIndexLinks('- [旧](%41.md)\n')).toMatchObject({ filenames: [], problems: [expect.any(String)] })
  expect(parseLegacyMemoryIndexLinks('- [旧](%41.md)\n')).toEqual({ filenames: ['%41.md'], problems: [] })
  expect(parseMemoryIndexLinks('- [当前](<./%2541.md>)\n- [普通](A.md)\n')).toEqual({ filenames: ['%41.md', 'A.md'], problems: [] })
})

it('empty category scaffolds do not demand missing index entries or become legacy memories', () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-empty-'))
  fs.mkdirSync(path.join(root, '本书记忆'))
  fs.writeFileSync(path.join(root, '本书记忆/文风.md'), '# 文风\n')
  expect(queryMemory(root)).toMatchObject({ ok: true, entries: [] })
  expect(readBookMemoryCatalog(root)).toMatchObject({ 状态: '无记忆', 条目: [] })
  fs.writeFileSync(path.join(root, '本书记忆/索引.md'), '# 本书记忆索引\n')
  expect(readBookMemoryCatalog(root)).toMatchObject({ 状态: '正常', 问题: [] })
})


it('writing, settlement planning and rebuilding omit scaffolds while preventing category overwrite', () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-write-empty-'))
  fs.mkdirSync(path.join(root, '本书记忆'))
  const kinds = ['文风', '决策', '对话', '灵感']
  for (const kind of kinds) fs.writeFileSync(path.join(root, `本书记忆/${kind}.md`), `# ${kind}\r\n`)
  rebuildBookMemoryIndex(root)
  expect(parseMemoryIndexLinks(fs.readFileSync(path.join(root, '本书记忆/索引.md'), 'utf8')).filenames).toEqual([])
  const input = { 名称: '渡口选择', 类: '决策' as const, 正文: '从渡口出发', 来源: '作者对谈', 裁决记录: '批准' }
  expect(bookMemoryOps(root, [input]).find(op => op.relPath === '本书记忆/索引.md')!.content).not.toContain('旧格式记忆')
  expect(writeBookMemory(root, input).ok).toBe(true)
  rebuildBookMemoryIndex(root)
  expect(parseMemoryIndexLinks(fs.readFileSync(path.join(root, '本书记忆/索引.md'), 'utf8')).filenames).toEqual(['渡口选择.md'])
  for (const name of kinds) {
    expect(writeBookMemory(root, { ...input, 名称: name }).ok).toBe(false)
    expect(() => bookMemoryOps(root!, [{ ...input, 名称: name }])).toThrow('冲突')
    expect(fs.readFileSync(path.join(root, `本书记忆/${name}.md`), 'utf8')).toBe(`# ${name}\r\n`)
  }
  const catalog = readBookMemoryCatalog(root)
  expect(catalog).toMatchObject({ 状态: '正常', 条目: [{ 名称: '渡口选择' }] })
  expect(renderMemoryCatalog(catalog, '测试')).not.toContain('空分类')
})

it('author raw links retain their literal identities outside book migration scope', () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-author-'))
  const author = path.join(root, '书房/作者记忆'), book = path.join(root, '本书记忆')
  fs.mkdirSync(author, { recursive: true }); fs.mkdirSync(book)
  const names = ['%41', '带 空格', '圆(括号)', '井#号', 'A']
  const index = '# 索引\n' + names.map(name => `- [${name}](${name}.md) — 原说明\n`).join('')
  for (const dir of [author, book]) {
    for (const name of names) fs.writeFileSync(path.join(dir, `${name}.md`), serializeDocument({ 名称: name, 类: '决策' }, '原文'))
    fs.writeFileSync(path.join(dir, '索引.md'), index)
  }
  expect(readAuthorMemoryCatalog(root)).toMatchObject({ 状态: '正常', 问题: [] })
  expect(readAuthorMemoryCatalog(root).条目.map(entry => entry.名称).sort()).toEqual([...names].sort())
  expect(readBookMemoryCatalog(root).状态).toBe('读取错误')
  expect(fs.readFileSync(path.join(author, '索引.md'), 'utf8')).toBe(index)
})

const clueHeader = '名称：事项\n类型：线索\n状态：已埋\n计划来源：本章新增\n实际落点：第1章\n来源：第1章\n裁决记录：作者批准\n'
const timelineHeader = '章号：第1章\n来源：第1章\n裁决记录：作者批准\n'
it.each([
  ['线索', clueHeader, '埋设点：第1章\n', '预期兑现区间：第4章\n'],
  ['线索', clueHeader, '预期兑现区间：第4章\n', '埋设点：第1章\n'],
  ['时间线', timelineHeader, '时点：清晨\n', '事件：渡口会面\n'],
  ['时间线', timelineHeader, '事件：渡口会面\n', '时点：清晨\n'],
  ['时间线', timelineHeader, '', '时点：清晨\n'],
  ['线索', clueHeader, '', '埋设点：第1章\n预期兑现区间：第4章\n埋设点：第2章\n'],
  ['时间线', timelineHeader, '', '事件：渡口会面\n事件：另一场会面\n'],
] as const)('reader, inspector and upgrade consistently reject ambiguous %s (%s%s%s)', (kind, header, fields, prefix) => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-partial-'))
  fs.mkdirSync(path.join(root, '账本'))
  const relative = `账本/${kind}.md`, source = `# ${kind}\n## 事项\n${header}${fields}### 正文\n${prefix}原文保留。\n`
  fs.writeFileSync(path.join(root, relative), source)
  const read = queryLedger(root, { 分类: kind })
  expect(read).toMatchObject({ ok: false, kind: 'parse-error', entries: [] })
  const issues = inspectBookDocuments(root).问题.filter(issue => issue.路径 === relative)
  expect(issues.some(issue => issue.代码 === 'DOCUMENT_INVALID')).toBe(true)
  expect(issues.some(issue => issue.代码 === 'LEGACY_SHAPE')).toBe(false)
  const plan = planUpgradeRules(new Map([[relative, source]]))
  expect(plan.changes).toEqual([])
  expect(plan.issues).toHaveLength(1)
  expect(fs.readFileSync(path.join(root, relative), 'utf8')).toBe(source)
  expect(fs.existsSync(path.join(root, '.webnovel'))).toBe(false)
})

it.each(['线索', '时间线'] as const)('complete current %s metadata leaves same-named prose and duplicates untouched', kind => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-current-'))
  fs.mkdirSync(path.join(root, '账本'))
  const header = kind === '线索' ? clueHeader : timelineHeader
  const fields = kind === '线索' ? '埋设点：第1章\n预期兑现区间：第4章\n' : '事件：渡口会面\n时点：清晨\n'
  const prose = fields + fields + '原文保留。'
  const relative = `账本/${kind}.md`, source = `# ${kind}\n## 事项\n${header}${fields}### 正文\n${prose}\n`
  fs.writeFileSync(path.join(root, relative), source)
  expect(queryLedger(root, { 分类: kind }).entries[0]?.正文).toBe(prose)
  expect(inspectBookDocuments(root).问题.filter(issue => issue.路径 === relative)).toEqual([])
  expect(planUpgradeRules(new Map([[relative, source]]))).toEqual({ changes: [], issues: [] })
  expect(fs.readFileSync(path.join(root, relative), 'utf8')).toBe(source)
})


it.each([
  ['[决策]', '\\[决策]'],
  ['[[决策]]', '\\[[决策]]'],
  ['\\[决策\\]', '\\[决策\\]'],
])('C5 retains nested/escaped label %s and author prose across later index writes', (label, retainedLabel) => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-category-label-'))
  fs.mkdirSync(path.join(root, '本书记忆'))
  const legacy = fs.readFileSync(path.join(__dirname, 'fixtures/maintenance-upgrade/historical-memory.md'), 'utf8')
  const note = `- ${retainedLabel} — 作者原说明 [参考](其他.md) 留作说明  \r\n`
  const introduction = '# 作者索引\r\n\r\n保留这段说明。  \r\n'
  const original = introduction + `- [${label}](决策.md) — 作者原说明 [参考](其他.md) 留作说明  \r\n- [[源材料]]\r\n`
  const files = new Map([['本书记忆/决策.md', legacy], ['本书记忆/索引.md', original]])
  const plan = planUpgradeRules(files)
  expect(plan.issues).toEqual([])
  for (const [file, text] of files) fs.writeFileSync(path.join(root, file), text)
  for (const change of plan.changes) fs.writeFileSync(path.join(root, change.relPath), change.after)
  const readIndex = () => fs.readFileSync(path.join(root!, '本书记忆/索引.md'), 'utf8')
  expect(readIndex()).toContain(note)
  expect(parseMemoryIndexLinks(readIndex())).toEqual({ filenames: ['保留渡口视角.md'], problems: [] })
  expect(readBookMemoryCatalog(root).状态).toBe('正常')
  rebuildBookMemoryIndex(root)
  const once = readIndex()
  rebuildBookMemoryIndex(root)
  expect(readIndex()).toBe(once)
  const input = { 名称: '新决定', 类: '决策' as const, 正文: '仍从渡口开始。', 来源: '作者对谈', 裁决记录: '批准' }
  expect(writeBookMemory(root, input).ok).toBe(true)
  const expectedProse = introduction + note + '- [[源材料]]\r\n'
  expect(readIndex().startsWith(expectedProse)).toBe(true)
  expect(parseMemoryIndexLinks(readIndex()).problems).toEqual([])
  const planned = bookMemoryOps(root, [{ ...input, 名称: '另一决定', 正文: '不同记忆。' }])
  expect(planned.find(op => op.relPath === '本书记忆/索引.md')!.content.startsWith(expectedProse)).toBe(true)
  expect(fs.readFileSync(path.join(root, '本书记忆/决策.md'), 'utf8')).toBe('# 决策\n\n')
})
