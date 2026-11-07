import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseDocument, serializeDocument } from '../src/repo/frontmatter'
import { MEMORY_KINDS } from '../src/repo/paths'
import { removeSync } from '../src/repo/remove'
import { queryMemory } from '../src/ledger'
import { bookMemoryOps, listBookMemoryEntries, rebuildBookMemoryIndex, writeBookMemory } from '../src/memory/book'
import { readAuthorMemoryCatalog, readBookMemoryCatalog } from '../src/memory/catalog'
import { listAuthorMemory, writeAuthorMemory } from '../src/memory/author'
import { MemoryWriteError } from '../src/memory/write'

const temporary = fs.realpathSync.native(os.tmpdir())
let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(temporary, 'webnovel-memory-contract-'))
  fs.mkdirSync(path.join(root, '本书记忆'))
})
afterEach(() => {
  if (path.dirname(root) !== temporary || !path.basename(root).startsWith('webnovel-memory-contract-')) throw new Error('Unexpected fixture path')
  removeSync(root)
})

const input = { 类: '决策' as const, 名称: '新增条目', 来源: '对谈', 裁决记录: '作者批准', 正文: '保留主角的选择。' }
function put(name: string, text: string): void { fs.writeFileSync(path.join(root, '本书记忆', name), text, 'utf8') }
function snapshot(): Record<string, string> {
  return Object.fromEntries(fs.readdirSync(path.join(root, '本书记忆')).sort().map(name => [name, fs.readFileSync(path.join(root, '本书记忆', name), 'utf8')]))
}
function putGood(): void {
  put('好条目.md', serializeDocument({ 名称: '好条目', 类: '文风' }, '不进入目录的正文。'))
}
const invalidShapes = [
  { name: '未知类.md', fields: { 类: '未知类别' } },
  { name: '空类.md', fields: { 类: null } },
  { name: '数字类.md', fields: { 类: 42 } },
  { name: '数组类.md', fields: { 类: ['文风'] } },
  { name: '对象类.md', fields: { 类: { 值: '文风' } } },
  { name: '缺类.md', fields: { 名称: '缺类' } },
  { name: '文风.md', fields: { 类: null } },
  { name: '决策.md', fields: { 类: '未知类别' } },
  { name: '对话.md', fields: { 类: 42 } },
  { name: '灵感.md', fields: { 类: ['灵感'] } },
] satisfies readonly { name: string; fields: Record<string, unknown> }[]

describe('book memory document shape is shared by real consumers and writers', () => {
  it.each(invalidShapes)('keeps good entries and reports invalid shape $name without writes', ({ name, fields }) => {
    putGood()
    put(name, serializeDocument(fields, '不能按旧格式掩盖的正文。'))
    put('索引.md', `- [好条目](好条目.md)\n- [坏条目](${name})\n`)
    const before = snapshot()
    const queried = queryMemory(root)
    expect(queried).toMatchObject({ ok: false, kind: 'parse-error', file: `本书记忆/${name}` })
    expect(queried.entries.map(entry => entry.名称)).toEqual(['好条目'])
    const catalog = readBookMemoryCatalog(root)
    expect(catalog.状态).toBe('读取错误')
    expect(catalog.问题.join(';')).toContain(`本书记忆/${name}`)
    expect(catalog.条目.map(entry => entry.名称)).toEqual(['好条目'])
    expect(() => listBookMemoryEntries(root)).toThrow(`本书记忆/${name}`)
    expect(snapshot()).toEqual(before)
  })

  it.each(invalidShapes)('does not claim an all-invalid catalog is normal or empty: $name', ({ name, fields }) => {
    put(name, serializeDocument(fields, '原文。'))
    const before = snapshot()
    expect(readBookMemoryCatalog(root)).toMatchObject({ 状态: '读取错误', 条目: [] })
    expect(snapshot()).toEqual(before)
  })

  it.each(invalidShapes)('rejects write planning, writing and index rebuild before changing files: $name', ({ name, fields }) => {
    putGood()
    put(name, serializeDocument(fields, '原文必须保留。'))
    put('索引.md', '# 原索引\n')
    const before = snapshot()
    expect(() => bookMemoryOps(root, [input])).toThrow(MemoryWriteError)
    expect(snapshot()).toEqual(before)
    expect(writeBookMemory(root, input)).toMatchObject({ ok: false, reason: expect.stringContaining(`本书记忆/${name}`) })
    expect(snapshot()).toEqual(before)
    expect(() => rebuildBookMemoryIndex(root)).toThrow(`本书记忆/${name}`)
    expect(snapshot()).toEqual(before)
  })

  it.each(MEMORY_KINDS)('accepts current %s entries without requiring optional historical fields', kind => {
    put('最小条目.md', serializeDocument({ 类: kind }, '类：不是元数据\n正文保真。'))
    const before = snapshot()
    expect(queryMemory(root).entries).toMatchObject([{ 类: kind, 名称: '最小条目', 正文: '类：不是元数据\n正文保真。\n' }])
    expect(listBookMemoryEntries(root)).toMatchObject([{ 类: kind, 名称: '最小条目', 来源: '', 状态: '' }])
    expect(readBookMemoryCatalog(root)).toMatchObject({ 状态: '索引失效', 条目: [{ 类: kind, 名称: '最小条目' }] })
    expect(snapshot()).toEqual(before)
    expect(rebuildBookMemoryIndex(root)).toBe('本书记忆/索引.md')
    expect(readBookMemoryCatalog(root).状态).toBe('正常')
    expect(snapshot()['最小条目.md']).toBe(before['最小条目.md'])
  })

  it('refuses writes while populated legacy memory remains and preserves all source bytes', () => {
    const empty = '# 文风\n'
    const populated = '# 决策\n\n## 旧结论\n状态：已确认\n### 正文\n旧正文。\n'
    put('文风.md', empty)
    put('决策.md', populated)
    const before = snapshot()
    expect(writeBookMemory(root, input).ok).toBe(false)
    expect(queryMemory(root)).toMatchObject({ ok: false, kind: 'parse-error', entries: [] })
    expect(readBookMemoryCatalog(root).状态).toBe('读取错误')
    expect(() => listBookMemoryEntries(root)).toThrow('旧格式')
    expect(() => rebuildBookMemoryIndex(root)).toThrow('旧格式')
    expect(snapshot()).toEqual(before)
  })

  it('does not mistake shape classification for validation of legacy section contents', () => {
    put('文风.md', '# 文风\n## 坏旧条目\n状态：已确认\n状态：候选\n')
    expect(queryMemory(root)).toMatchObject({ ok: false, kind: 'parse-error' })
    expect(readBookMemoryCatalog(root)).toMatchObject({ 状态: '读取错误', 条目: [] })
    expect(() => listBookMemoryEntries(root)).toThrow('旧格式')
  })

  it('preserves extensions and omitted fields through update, exact retry and stale-input rejection', () => {
    expect(writeBookMemory(root, { ...input, 描述: '本书取舍', 标签: ['主角'] }).ok).toBe(true)
    const file = path.join(root, '本书记忆', `${input.名称}.md`)
    const parsed = parseDocument(fs.readFileSync(file, 'utf8'))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const original = serializeDocument({ ...parsed.data.fields, 扩展: { 作者值: 7 }, 生成模块: '作者手改' }, parsed.data.body)
    fs.writeFileSync(file, original, 'utf8')
    const update = { ...input, 操作: '更新' as const, 原文: original, 正文: '保留主角的选择，也允许长期例外。' }
    expect(writeBookMemory(root, update)).toMatchObject({ ok: true, changed: true, updated: true })
    const updated = fs.readFileSync(file, 'utf8')
    const result = parseDocument(updated)
    expect(result.ok && result.data.fields).toMatchObject({ 描述: '本书取舍', 标签: ['主角'], 扩展: { 作者值: 7 }, 生成模块: '作者手改' })
    expect(queryMemory(root, { 类: '决策' }).entries).toMatchObject([{ 名称: input.名称, 正文: `${update.正文}\n` }])
    expect(readBookMemoryCatalog(root)).toMatchObject({ 状态: '正常', 条目: [{ 名称: input.名称, 描述: '本书取舍', 标签: ['主角'] }] })
    expect(listBookMemoryEntries(root)).toMatchObject([{ 名称: input.名称, 描述: '本书取舍', 正文: `${update.正文}\n` }])
    const beforeRetry = snapshot()
    expect(writeBookMemory(root, update)).toMatchObject({ ok: true, changed: false, updated: true })
    expect(snapshot()).toEqual(beforeRetry)
    expect(writeBookMemory(root, { ...update, 正文: '使用旧原文的另一修改。' })).toMatchObject({ ok: false, reason: expect.stringContaining('原文已变化') })
    expect(snapshot()).toEqual(beforeRetry)
  })

  it('does not apply the book-only shape contract to author documents', () => {
    const directory = path.join(root, '书房', '作者记忆')
    fs.mkdirSync(directory, { recursive: true })
    const old = serializeDocument({ 名称: '旧作者条目', 类: null }, '既有作者原文。')
    const missing = serializeDocument({ 名称: '无类作者条目' }, '作者旧记录。')
    fs.writeFileSync(path.join(directory, '旧作者条目.md'), old, 'utf8')
    fs.writeFileSync(path.join(directory, '无类作者条目.md'), missing, 'utf8')
    expect(readAuthorMemoryCatalog(root)).toMatchObject({ 状态: '索引失效', 问题: ['索引文件不存在，目录按条目文件列出'] })
    expect(listAuthorMemory(root)).toHaveLength(2)
    expect(writeAuthorMemory(root, { 名称: '跨书偏好', 描述: '作者偏好', 类: '文风', 来源: '对谈', 正文: '跨书采用克制叙述。' }).ok).toBe(true)
    expect(readAuthorMemoryCatalog(root).状态).toBe('正常')
    expect(fs.readFileSync(path.join(directory, '旧作者条目.md'), 'utf8')).toBe(old)
    expect(fs.readFileSync(path.join(directory, '无类作者条目.md'), 'utf8')).toBe(missing)
  })
})
