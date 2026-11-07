import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
import {
  parseDocument, parseWorldbookHistory, planSettlement, prepareEntry, serializeDocument,
  writeBatchAtomic, writeEntry, type WorldbookEntryInput,
} from '../src'
import { removeSync } from '../src/repo/remove'

const temporary = fs.realpathSync.native(os.tmpdir())
const entry = '世界书/人物档案/林舟.md'
const base = { 类型: '人物', 性质: '计划', 状态: '已确认', 来源: '对谈共创' } as const
const extension = { 版本: 4, 父版本: 3, 来源快照: null, 来源引用: ['世界书/世界规则/渡口.md@2'], 作者备注: { 留白: null }, 别名: ['小舟', '船夫'] }
let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(temporary, 'webnovel-worldbook-update-')) })
afterEach(() => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  if (path.dirname(root) !== temporary || !path.basename(root).startsWith('webnovel-worldbook-update-')) throw new Error('Unexpected fixture path')
  removeSync(root)
})

function put(text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, entry)), { recursive: true })
  fs.writeFileSync(path.join(root, entry), text, 'utf8')
}
function prepare(fields: WorldbookEntryInput = {}) { return prepareEntry(root, '人物档案', '林舟', fields) }
function raw() { return fs.readFileSync(path.join(root, entry), 'utf8') }
function settle(chapter = 3, mode: '追加' | '更正' = '追加'): string {
  fs.mkdirSync(path.dirname(path.join(root, entry)), { recursive: true })
  const dir = path.join(root, '草稿区/定稿准备/测试')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '事实变更.md'), '# 事实变更\n## 人物档案\n### 林舟\n守住渡口。\n', 'utf8')
  const key = { 卷: 1, 章: chapter, 章名: '守渡' }
  const plan = planSettlement(root, dir, { 章节: key, 批准: true, 裁决记录: '测试批准' }, key, mode)
  if (!plan.ok) throw new Error(plan.reason)
  writeBatchAtomic(root, plan.ops)
  return raw()
}

describe('worldbook typed partial input and preservation', () => {
  it('declares a closed input type, separate from persisted extension fields', () => {
    expectTypeOf<keyof WorldbookEntryInput>().toEqualTypeOf<'类型' | '性质' | '状态' | '来源' | '别名' | '正文'>()
    expectTypeOf<WorldbookEntryInput['性质']>().toEqualTypeOf<'计划' | '事实' | undefined>()
  })

  it('prepares new plans without writing; synchronous writer reuses the preparation', () => {
    const op = prepare({ ...base, 别名: '小舟' })
    expect(fs.readdirSync(root)).toEqual([])
    expect(parseDocument(op.content)).toMatchObject({ ok: true, data: { fields: { ...base, 名称: '林舟', 别名: '小舟' }, body: '# 林舟\n' } })
    writeEntry(root, '人物档案', '林舟', { ...base, 别名: '小舟' })
    expect(raw()).toBe(op.content)
  })

  it.each(['类型', '性质', '状态', '来源'] as const)('requires %s for creation, not for a partial update', key => {
    const fields: WorldbookEntryInput = { ...base, [key]: undefined }
    expect(() => prepare(fields)).toThrow(new RegExp(`${key}必填`))
    expect(fs.readdirSync(root)).toEqual([])
    put(serializeDocument({ 名称: '林舟', ...base }, '原正文'))
    expect(parseDocument(prepare({ 正文: '新正文' }).content)).toMatchObject({ ok: true, data: { fields: { [key]: base[key] } } })
  })

  it.each([null, {}, { 哈希: 'abc', 版本: 2 }])('preserves source snapshots and extensions on body updates: %j', snapshot => {
    const fields = { 名称: '林舟', ...base, ...extension, 来源快照: snapshot }
    const before = serializeDocument(fields, '原正文')
    put(before)
    const op = prepare({ 正文: '新正文\n来源：正文中的纸条\n' })
    expect(parseDocument(op.content)).toEqual({ ok: true, data: { fields, body: '新正文\n来源：正文中的纸条\n' } })
    expect(raw()).toBe(before)
  })

  it('does not synthesize omitted source/version fields', () => {
    put(serializeDocument({ 名称: '林舟', ...base }, '原文'))
    const doc = parseDocument(prepare({ 正文: '改写' }).content)
    expect(doc.ok && doc.data.fields).toEqual({ 名称: '林舟', ...base })
  })

  it.each(['', '原文无末尾换行', '原文\r\n\r\n  \r\n', '~~~md\r\n### 事实@第0009章\r\n~~~\r\n'])('field-only updates retain exact raw prose: %j', body => {
    const before = '\uFEFF' + serializeDocument({ 名称: '林舟', ...base, ...extension }, '').replace(/\n/g, '\r\n').replace(/\r\n$/, '') + body
    put(before)
    const op = prepare({ 别名: '渡者' })
    expect(op.content.slice(op.content.indexOf('\n---\n') + 5)).toBe(body)
    expect(parseDocument(op.content)).toMatchObject({ ok: true, data: { fields: { ...extension, 别名: '渡者' } } })
    expect(raw()).toBe(before)
  })

  it('empty alias and empty prose are values, not field deletion; same content retains original bytes', () => {
    const before = '\uFEFF' + serializeDocument({ 名称: '林舟', ...base, ...extension }, '原文\n').replace(/\n/g, '\r\n') + '\r\n'
    put(before)
    expect(prepare().content).toBe(before)
    expect(prepare({ 正文: '原文\n\n' }).content).toBe(before)
    const cleared = prepare({ 别名: '', 正文: '' })
    expect(parseDocument(cleared.content)).toMatchObject({ ok: true, data: { fields: { 别名: '' }, body: '\n' } })
    put(cleared.content)
    expect(prepare({ 别名: '', 正文: '' }).content).toBe(cleared.content)
  })

  it.each([
    { 别名: null }, { 别名: ['小舟'] }, { 来源: null }, { 来源: 23 }, { 来源: '' }, { 类型: ' ' },
    { 正文: null }, { 正文: ['正文'] }, { 性质: '已成事实' }, { 状态: '进行中' },
    { 类型: '人物\n性质：事实' }, { 别名: '小舟\r船夫' }, { 关系双方: ['林舟', '沈青'] },
    { 来源快照: undefined }, { 名称: '沈青' },
  ])('rejects invalid or unmanaged inputs without changing bytes: %j', fields => {
    const before = serializeDocument({ 名称: '林舟', ...base }, '原文')
    put(before)
    expect(() => prepare(fields as unknown as WorldbookEntryInput)).toThrow()
    expect(raw()).toBe(before)
  })
})

describe('worldbook history and fact write boundaries', () => {
  it('updates the plan head after real settlement without changing any appended bytes', () => {
    put(serializeDocument({ 名称: '林舟', ...base, ...extension }, '未来计划。'))
    settle(3)
    const before = settle(8).replace(/\n/g, '\r\n') + '\r\n  '
    put(before)
    const tail = before.slice(before.indexOf('### 事实@第0003章'))
    const op = prepare({ 正文: '新计划。\n~~~md\n### 事实@第0009章\n来源：这里只是示例\n~~~', 别名: '渡者' })
    expect(op.content.endsWith(tail)).toBe(true)
    expect(parseWorldbookHistory(op.content)).toMatchObject({ ok: true, data: {
      字段: { ...extension, 版本: 6, 父版本: 5, 别名: '渡者', 性质: '计划', 来源: base.来源 },
      追加: [{ 章: 3, 来源: '定稿/卷01/0003-守渡.md', 正文: '守住渡口。' }, { 章: 8, 来源: '定稿/卷01/0008-守渡.md', 正文: '守住渡口。' }],
    } })
    expect(raw()).toBe(before)
    put(op.content)
    expect(prepare({ 正文: '新计划。\n~~~md\n### 事实@第0009章\n来源：这里只是示例\n~~~', 别名: '渡者' }).content).toBe(op.content)
    const metadataOnly = prepare({ 状态: '暂定' }).content
    expect(metadataOnly.slice(metadataOnly.indexOf('\n---\n') + 5)).toBe(op.content.slice(op.content.indexOf('\n---\n') + 5))
  })

  it.each(['新计划\n```', '新计划\n~~~markdown', '### 事实@第0002章\n伪造的事实'])('rejects changed history boundaries: %j', body => {
    put(serializeDocument({ 名称: '林舟', ...base }, '旧计划'))
    const before = settle()
    expect(() => prepare({ 正文: body })).toThrow(/事实.*边界/)
    expect(raw()).toBe(before)
  })

  it('rejects direct new facts, plan-to-fact conversion and injected facts', () => {
    expect(() => prepare({ ...base, 性质: '事实' })).toThrow(/定稿入档/)
    expect(() => prepare({ ...base, 正文: '### 事实@第0001章\n伪造事实' })).toThrow(/事实.*边界/)
    put(prepare({ ...base }).content)
    expect(() => prepare({ 性质: '事实' })).toThrow(/定稿入档/)
  })

  it.each(['```md\n示例', '~~~\n示例'])('does not let unfinished plan fences swallow future settled facts: %j', body => {
    expect(() => prepare({ ...base, 正文: body })).toThrow(/事实.*边界/)
    // A pre-fix file may already hide real settlement appends; do not erase them to repair prose.
    put(serializeDocument({ 名称: '林舟', ...base }, body))
    const before = settle()
    expect(parseWorldbookHistory(before)).toMatchObject({ ok: true, data: { 未闭合围栏: true, 追加: [] } })
    expect(() => prepare({ 正文: '替换首段' })).toThrow(/旧文围栏未闭合/)
    expect(raw()).toBe(before)
  })

  it('protects settled facts, including metadata; true no-op is allowed and retcon still works', () => {
    const before = settle()
    expect(prepare().content).toBe(before)
    expect(prepare({ 正文: '守住渡口。' }).content).toBe(before)
    for (const fields of [{ 正文: '改写事实' }, { 别名: '小舟' }, { 来源: '对谈' }, { 性质: '计划' }] as const) {
      expect(() => prepare(fields)).toThrow(/更正\/吃书/)
      expect(raw()).toBe(before)
    }
    const corrected = settle(8, '更正')
    expect(parseWorldbookHistory(corrected)).toMatchObject({ ok: true, data: { 字段: { 性质: '事实', 版本: 2 }, 首段: '守住渡口。' } })
  })

  it('keeps a corrected plan head factual after the next settlement append', () => {
    put(prepare({ ...base, 正文: '原计划' }).content)
    const corrected = settle(3, '更正')
    expect(parseDocument(corrected)).toMatchObject({ ok: true, data: { fields: { 性质: '事实', 生成模块: '吃书补偿' } } })
    expect(() => prepare({ 正文: '不得覆盖已更正事实' })).toThrow(/更正\/吃书/)
    const appended = settle(8)
    expect(parseDocument(appended)).toMatchObject({ ok: true, data: { fields: { 性质: '事实', 生成模块: '事实沉淀' } } })
    expect(() => prepare({ 正文: '仍不得覆盖' })).toThrow(/更正\/吃书/)
    expect(raw()).toBe(appended)
  })

  it('protects an evidenced old correction marker and retains fact ownership on its next append', () => {
    const before = serializeDocument({ 名称: '林舟', ...base, 生成模块: '吃书补偿' }, '此前已更正的事实。')
    put(before)
    expect(prepare().content).toBe(before)
    expect(() => prepare({ 正文: '新计划' })).toThrow(/更正\/吃书/)
    const appended = settle(8)
    expect(parseDocument(appended)).toMatchObject({ ok: true, data: { fields: { 性质: '事实', 生成模块: '事实沉淀' } } })
    expect(appended).toContain('此前已更正的事实。')
    expect(() => prepare({ 别名: '新别名' })).toThrow(/更正\/吃书/)
  })
})

describe('worldbook reads fail closed before preparing content', () => {
  it.each(['---\n名称: [\n---\n正文', '---\n名称: 林舟\n名称: 沈青\n---\n正文', '---\n名称: 沈青\n---\n正文', '---\n性质: 假值\n---\n正文', '---\n状态: 损坏值\n---\n正文'])('retains invalid existing metadata: %j', text => {
    put(text)
    expect(() => prepare(base)).toThrow()
    expect(raw()).toBe(text)
  })

  it('rejects directories, non-directory parents and read failures rather than treating them as new', () => {
    fs.mkdirSync(path.join(root, entry), { recursive: true })
    expect(() => prepare(base)).toThrow(/独立普通文件/)
    fs.rmdirSync(path.join(root, entry))
    fs.rmdirSync(path.dirname(path.join(root, entry)))
    fs.writeFileSync(path.dirname(path.join(root, entry)), '不是目录')
    expect(() => prepare(base)).toThrow(/目录/)
    fs.unlinkSync(path.dirname(path.join(root, entry)))
    put(serializeDocument({ 名称: '林舟', ...base }, '保留'))
    const read = fs.readFileSync
    vi.spyOn(fs, 'readFileSync').mockImplementation((...args: Parameters<typeof fs.readFileSync>) => {
      if (String(args[0]) === path.join(root, entry)) throw Object.assign(new Error('denied'), { code: 'EACCES' })
      return read(...args)
    })
    syncBuiltinESMExports()
    expect(() => prepare({ 正文: '更新' })).toThrow('denied')
  })

  it('rejects hardlinks before reading content', () => {
    const original = path.join(root, '作者原件.md')
    fs.writeFileSync(original, serializeDocument({ 名称: '林舟', ...base }, '链接原文'))
    fs.mkdirSync(path.dirname(path.join(root, entry)), { recursive: true })
    fs.linkSync(original, path.join(root, entry))
    expect(() => prepare()).toThrow(/独立普通文件/)
    expect(fs.readFileSync(original, 'utf8')).toContain('链接原文')
  })

  it('rejects linked parents, inside or outside the book, without reading their content', () => {
    const module = path.join(root, '世界书/人物档案')
    fs.mkdirSync(path.dirname(module), { recursive: true })
    for (const dest of [root, temporary]) {
      fs.symlinkSync(dest, module, process.platform === 'win32' ? 'junction' : 'dir')
      try { expect(() => prepare(base)).toThrow(/链接|逃逸/) }
      finally { fs.unlinkSync(module) }
    }
  })
})
