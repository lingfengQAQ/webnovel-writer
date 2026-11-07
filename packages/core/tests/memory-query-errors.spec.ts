import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import { queryMemory, renderStatusCard, serializeDocument } from '../src/index'
import { removeSync } from '../src/repo/remove'

const temporary = fs.realpathSync.native(os.tmpdir())
let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(temporary, 'webnovel-memory-query-'))
  fs.mkdirSync(path.join(root, '本书记忆'))
})
afterEach(() => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  if (path.dirname(root) !== temporary || !path.basename(root).startsWith('webnovel-memory-query-')) throw new Error('Unexpected fixture path')
  removeSync(root)
})

function put(name: string, text: string): void { fs.writeFileSync(path.join(root, '本书记忆', name), text, 'utf8') }
function healthy(name = '正常条目', kind = '决策', status = '已确认'): void {
  put(`${name}.md`, serializeDocument({ 名称: name, 类: kind, 状态: status }, `${name}原文。`))
}
function snapshot(): Record<string, string> {
  return Object.fromEntries(fs.readdirSync(path.join(root, '本书记忆')).sort().map(name => [name, fs.readFileSync(path.join(root, '本书记忆', name), 'utf8')]))
}
function readOnlyQuery(filter?: Parameters<typeof queryMemory>[1]) {
  const before = snapshot()
  const result = queryMemory(root, filter)
  expect(snapshot()).toEqual(before)
  return result
}

describe('RW07: memory queries report partial failures rather than silent absence', () => {
  it.each([
    '---\n名称: [\n类: 决策\n---\n坏条目原文。\n',
    '---\n名称: 坏条目\n类: 决策\n坏条目原文。\n',
    '---\n- 顶层不是映射\n---\n坏条目原文。\n',
    '---\n名称: 坏条目\n类: 决策\n类: 文风\n---\n坏条目原文。\n',
  ])('reports malformed frontmatter beside a readable entry: %s', broken => {
    healthy()
    put('坏条目.md', broken)
    const result = readOnlyQuery()
    expect(result).toMatchObject({ ok: false, kind: 'parse-error', file: '本书记忆/坏条目.md' })
    expect(!result.ok && result.reason).toMatch(/本书记忆\/坏条目\.md.*(?:YAML|frontmatter)/s)
    expect(result.entries.map(entry => entry.名称)).toEqual(['正常条目'])
    expect(result.files).toEqual(['本书记忆/正常条目.md'])
  })

  it('reports parse-error rather than missing when the only entry is broken', () => {
    put('坏条目.md', '---\n类: [\n---\n坏条目原文。\n')
    expect(readOnlyQuery()).toMatchObject({ ok: false, kind: 'parse-error', file: '本书记忆/坏条目.md', entries: [], files: [] })
  })

  it.each([false, true])('the recovery card exposes memory parse failure (readable entry=%s)', readable => {
    if (readable) healthy()
    put('坏条目.md', '---\n类: [\n---\n坏条目原文。\n')
    const before = snapshot()
    const card = renderStatusCard(root, { 卷: 1, 章: 1, 章名: '记忆核对' })
    expect(card).toContain(readable ? '本书记忆：部分解析失败（1 条可用）' : '本书记忆：解析失败（0 条可用）')
    expect(snapshot()).toEqual(before)
  })

  it.each(['未知类别', 42, null, ['决策']])('reports an invalid declared class without assuming legacy: %j', kind => {
    healthy()
    put('坏条目.md', serializeDocument({ 名称: '坏条目', 类: kind }, '仍需保留的原文。'))
    const result = readOnlyQuery({ 类: '决策' })
    expect(result).toMatchObject({ ok: false, kind: 'parse-error', file: '本书记忆/坏条目.md' })
    expect(!result.ok && result.reason).toMatch(/类.*(?:无效|非法|合法)/)
    expect(result.entries.map(entry => entry.名称)).toEqual(['正常条目'])
  })

  it('reports a missing class on a non-legacy file rather than silently skipping it', () => {
    healthy()
    put('坏条目.md', serializeDocument({ 名称: '坏条目' }, '原文。'))
    const result = readOnlyQuery()
    expect(result).toMatchObject({ ok: false, kind: 'parse-error', file: '本书记忆/坏条目.md' })
    expect(!result.ok && result.reason).toMatch(/缺少.*类/)
  })

  it.each([
    [{ 类: '文风' as const }, ['匹配']],
    [{ 名称: '匹配' }, ['匹配']],
    [{ 状态: '已确认' }, ['匹配']],
    [{ 名称: '不存在' }, []],
  ])('still applies filters to readable entries when another entry fails: %j', (filter, expected) => {
    healthy('匹配', '文风', '已确认')
    healthy('不匹配', '决策', '候选')
    put('坏条目.md', '---\n类: [\n---\n原文。\n')
    const result = readOnlyQuery(filter)
    expect(result).toMatchObject({ ok: false, kind: 'parse-error', file: '本书记忆/坏条目.md' })
    expect(result.entries.map(entry => entry.名称)).toEqual(expected)
    expect([...result.files].sort()).toEqual(['本书记忆/不匹配.md', '本书记忆/匹配.md'].sort())
  })

  it('aggregates multiple failed paths and preserves every readable file', () => {
    healthy()
    put('坏条目甲.md', '---\n类: [\n---\n原文甲。\n')
    put('坏条目乙.md', serializeDocument({ 类: '未知' }, '原文乙。'))
    const result = readOnlyQuery()
    expect(result).toMatchObject({ ok: false, kind: 'parse-error' })
    expect(!result.ok && result.reason).toContain('本书记忆/坏条目甲.md')
    expect(!result.ok && result.reason).toContain('本书记忆/坏条目乙.md')
    expect(result.entries.map(entry => entry.名称)).toEqual(['正常条目'])
  })

  it('rejects populated legacy memory while allowing empty scaffolds', () => {
    healthy()
    put('文风.md', '# 文风\n')
    put('决策.md', '# 决策\n## 旧条目\n状态：已确认\n### 正文\n旧原文。\n')
    const result = readOnlyQuery()
    expect(result).toMatchObject({ ok: false, kind: 'parse-error' })
    expect(result.entries.find(entry => entry.名称 === '旧条目')).toBeUndefined()
    expect(result.entries.find(entry => entry.名称 === '正常条目')?.格式).toBeUndefined()
    expect(result.files).toHaveLength(2)
  })

  it.each([
    '---\n类: [\n---\n## 不能回退\n状态：已确认\n旧形正文。\n',
    '---\n类: 未知类别\n---\n## 不能回退\n状态：已确认\n旧形正文。\n',
  ])('does not hide broken or explicitly invalid frontmatter behind a legacy filename: %s', broken => {
    healthy()
    put('文风.md', broken)
    const result = readOnlyQuery()
    expect(result).toMatchObject({ ok: false, kind: 'parse-error', file: '本书记忆/文风.md' })
    expect(result.entries.map(entry => entry.名称)).toEqual(['正常条目'])
  })

  it('retains legacy parse errors and does not lose the readable filtered entries', () => {
    healthy('匹配', '文风')
    put('决策.md', '# 决策\n## 坏旧条目\n状态：已确认\n状态：候选\n')
    const result = readOnlyQuery({ 类: '文风' })
    expect(result).toMatchObject({ ok: false, kind: 'parse-error', file: '本书记忆/决策.md' })
    expect(result.entries.map(entry => entry.名称)).toEqual(['匹配'])
  })

  it.each(['ENOENT', 'EACCES'])('reports a discovered entry that cannot be read (%s)', code => {
    healthy()
    put('坏条目.md', serializeDocument({ 类: '决策' }, '原文。'))
    const before = snapshot()
    const readFile = fs.readFileSync
    let faultHit = false
    vi.spyOn(fs, 'readFileSync').mockImplementation(((filename, ...args) => {
      if (String(filename) === path.join(root, '本书记忆/坏条目.md')) {
        faultHit = true
        throw Object.assign(new Error('injected read failure'), { code })
      }
      return readFile(filename, ...args)
    }) as typeof fs.readFileSync)
    syncBuiltinESMExports()
    const result = queryMemory(root, { 类: '决策' })
    vi.restoreAllMocks()
    syncBuiltinESMExports()
    expect(faultHit).toBe(true)
    expect(result).toMatchObject({ ok: false, kind: code === 'ENOENT' ? 'missing' : 'parse-error', file: '本书记忆/坏条目.md' })
    expect(result.entries.map(entry => entry.名称)).toEqual(['正常条目'])
    expect(snapshot()).toEqual(before)
  })

  it('reports directory enumeration failures rather than claiming the memory is absent', () => {
    healthy()
    const before = snapshot()
    let faultHit = false
    vi.spyOn(fs, 'readdirSync').mockImplementation(dir => {
      if (String(dir) !== path.join(root, '本书记忆')) throw new Error('Unexpected enumeration target')
      faultHit = true
      throw Object.assign(new Error('injected directory failure'), { code: 'EACCES' })
    })
    syncBuiltinESMExports()
    const result = queryMemory(root)
    vi.restoreAllMocks()
    syncBuiltinESMExports()
    expect(faultHit).toBe(true)
    expect(result).toMatchObject({ ok: false, kind: 'parse-error', file: '本书记忆' })
    expect(snapshot()).toEqual(before)
  })

  it('ignores the catalog and still distinguishes an empty directory from parse failure', () => {
    put('索引.md', '---\n故意不是条目 YAML: [\n')
    expect(readOnlyQuery()).toMatchObject({ ok: false, kind: 'missing', entries: [], files: [] })
    healthy()
    expect(readOnlyQuery()).toMatchObject({ ok: true })
  })
})
