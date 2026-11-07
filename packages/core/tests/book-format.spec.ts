import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
import {
  BOOK_FORMAT_VERSION_FIELD, CURRENT_BOOK_FORMAT_VERSION, emptyContractBody, parseBookFormatVersion,
  parseDocument, paths, prepareContract, readBookFormatVersion, serializeDocument,
} from '../src'
import { removeSync } from '../src/repo/remove'

const temporary = fs.realpathSync.native(os.tmpdir())
let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(temporary, 'webnovel-book-format-')) })
afterEach(() => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  if (path.dirname(root) !== temporary || !path.basename(root).startsWith('webnovel-book-format-')) throw new Error('Unexpected fixture path')
  removeSync(root)
})

function put(text: string): void {
  fs.mkdirSync(path.join(root, '作品契约'), { recursive: true })
  fs.writeFileSync(path.join(root, paths.契约()), text, 'utf8')
}

describe('book format identity is separate from content and machine versions', () => {
  it('new contract text carries a program-owned marker without writing files', () => {
    const text = emptyContractBody('book-format-test')
    expect(parseDocument(text)).toMatchObject({ ok: true, data: { fields: { 书id: 'book-format-test', 书仓格式版本: 1 } } })
    expect(parseBookFormatVersion(text)).toEqual({ ok: true, version: CURRENT_BOOK_FORMAT_VERSION })
    expect(fs.readdirSync(root)).toEqual([])
  })

  it('does not infer a book format from content or machine version fields', () => {
    const text = serializeDocument({ 版本: 8, 父版本: 7, schemaVersion: 1 }, '书仓格式版本：1\n')
    expect(parseBookFormatVersion(text)).toMatchObject({ ok: false, kind: 'unversioned' })
    expect(parseBookFormatVersion(serializeDocument({ 书仓格式版本: 1, 版本: 90, schemaVersion: 99 }, '正文')))
      .toEqual({ ok: true, version: 1 })
  })

  it.each(['# 契约\n', '---\n书id: old-book\n---\n# 契约\n'])('never stamps an unversioned existing contract during a read', text => {
    put(text)
    expect(readBookFormatVersion(root)).toMatchObject({ ok: false, kind: 'unversioned' })
    expect(fs.readFileSync(path.join(root, paths.契约()), 'utf8')).toBe(text)
  })

  it.each([null, 0, -1, 1.5, '1', true, [], {}, Infinity])('reports an invalid marker without guessing: %j', value => {
    expect(parseBookFormatVersion(serializeDocument({ [BOOK_FORMAT_VERSION_FIELD]: value }, '# 契约')))
      .toMatchObject({ ok: false, kind: 'invalid-format' })
  })

  it('distinguishes an unknown positive version from an unversioned book', () => {
    expect(parseBookFormatVersion(serializeDocument({ 书仓格式版本: 2 }, '# 契约')))
      .toMatchObject({ ok: false, kind: 'unsupported-version', version: 2 })
  })

  it('recognizes BOM-prefixed current and future markers without rewriting the input', () => {
    expect(parseBookFormatVersion(`\uFEFF${emptyContractBody('bom-book')}`)).toEqual({ ok: true, version: 1 })
    const future = '\uFEFF---\r\n书仓格式版本: 2\r\n---\r\n# 契约\r\n'
    put(future)
    expect(readBookFormatVersion(root)).toMatchObject({ ok: false, kind: 'unsupported-version', version: 2 })
    expect(fs.readFileSync(path.join(root, paths.契约()), 'utf8')).toBe(future)
    expect(parseBookFormatVersion('\uFEFF---\n书仓格式版本: [broken\n---\n正文')).toMatchObject({ ok: false, kind: 'invalid-format' })
    expect(parseBookFormatVersion('\uFEFF---\n书仓格式版本: 2')).toMatchObject({ ok: false, kind: 'invalid-format' })
  })

  it.each(['---\n书仓格式版本: [broken\n---\n正文', '---\n书仓格式版本: 1\n书仓格式版本: 2\n---\n正文', '---\n书仓格式版本: 1'])('reports malformed metadata rather than unversioned input', text => {
    expect(parseBookFormatVersion(text)).toMatchObject({ ok: false, kind: 'invalid-format' })
  })

  it('distinguishes a missing contract from an unreadable contract', () => {
    expect(readBookFormatVersion(root)).toMatchObject({ ok: false, kind: 'missing' })
    const read = fs.readFileSync
    vi.spyOn(fs, 'readFileSync').mockImplementation((...args: Parameters<typeof fs.readFileSync>) => {
      if (args[0] === path.join(root, paths.契约())) throw Object.assign(new Error('denied'), { code: 'EACCES' })
      return read(...args)
    })
    syncBuiltinESMExports()
    expect(readBookFormatVersion(root)).toMatchObject({ ok: false, kind: 'read-error', reason: expect.stringContaining('denied') })
  })

  it('preserves a managed marker and unrelated fields during ordinary contract updates', () => {
    const original = serializeDocument({ 书id: 'old-book', 书仓格式版本: 1, 自定义: ['保留'], 版本: 8 }, '# 作品契约\n')
    put(original)
    const op = prepareContract(root, { 题材与读者定位: { state: '已确认', body: '更新定位' } })
    expect(parseDocument(op.content)).toMatchObject({ ok: true, data: { fields: { 书id: 'old-book', 书仓格式版本: 1, 自定义: ['保留'], 版本: 8 } } })
    expect(fs.readFileSync(path.join(root, paths.契约()), 'utf8')).toBe(original)
  })

  it.each([undefined, null, 1, 2])('does not expose the managed marker as an ordinary update field: %j', value => {
    const original = emptyContractBody('test-book')
    put(original)
    expect(() => prepareContract(root, {}, { [BOOK_FORMAT_VERSION_FIELD]: value })).toThrow(/普通契约更新不能设置/)
    expect(fs.readFileSync(path.join(root, paths.契约()), 'utf8')).toBe(original)
  })

  it('does not silently upgrade an old contract on a normal update', () => {
    put(serializeDocument({ 书id: 'old-book' }, '# 作品契约'))
    const op = prepareContract(root, { 题材与读者定位: { state: '已确认', body: '旧书的新定位' } })
    expect(parseBookFormatVersion(op.content)).toMatchObject({ ok: false, kind: 'unversioned' })
  })
})
