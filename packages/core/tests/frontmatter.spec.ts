import { describe, expect, it } from 'vitest'
import { parseDocument, serializeDocument, unwrap } from '../src/repo/frontmatter'

describe('frontmatter 解析(B3/B4/B5)', () => {
  it('标准结构', () => {
    const r = parseDocument('---\n状态: 候选\n版本: 3\n---\n\n正文第一行\n')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.fields['状态']).toBe('候选')
      expect(r.data.fields['版本']).toBe(3)
      expect(r.data.body).toContain('正文第一行')
    }
  })
  it('无 frontmatter=空字段(合法)', () => {
    const r = parseDocument('# 只有正文\n')
    expect(r.ok).toBe(true)
    if (r.ok) expect(Object.keys(r.data.fields)).toEqual([])
  })
  it('识别紧邻 frontmatter 的 UTF-8 BOM，但不裁剪普通正文', () => {
    expect(parseDocument('\uFEFF---\r\n版本: 2\r\n---\r\n  原正文\r\n'))
      .toEqual({ ok: true, data: { fields: { 版本: 2 }, body: '  原正文\n' } })
    const prose = '\uFEFF# 只有正文\n'
    expect(parseDocument(prose)).toEqual({ ok: true, data: { fields: {}, body: prose } })
    expect(parseDocument('\uFEFF---\n版本: [坏数据\n---\n正文')).toMatchObject({ ok: false, reason: 'parse-error' })
  })
  it('B5:未闭合→parse-error 带明细,不静默', () => {
    const r = parseDocument('---\n状态: 候选\n')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('parse-error')
      expect(r.detail).toContain('未闭合')
    }
  })
  it('B5:YAML 语法错→parse-error 带明细', () => {
    const r = parseDocument('---\n状态: [未闭合\n---\nx\n')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('parse-error')
  })
  it('B4:unwrap 区分 missing 与 parse-error 的报错语义', () => {
    const missing: ReturnType<typeof parseDocument> = { ok: false, reason: 'missing', detail: '' }
    expect(() => unwrap(missing, '契约')).toThrow('没有数据')
    const broken: ReturnType<typeof parseDocument> = { ok: false, reason: 'parse-error', detail: 'YAML 解析失败:…' }
    expect(() => unwrap(broken, '契约')).toThrow('解析失败')
  })
})

describe('frontmatter 序列化(B9 稳定输出)', () => {
  it('键序稳定:定义序优先,其余按中文排序', () => {
    const a = serializeDocument({ 状态: '候选', 版本: 1 }, '正文')
    const b = serializeDocument({ 版本: 1, 状态: '候选' }, '正文')
    expect(a).toBe(b)
  })
  it('空字段省略 frontmatter', () => {
    expect(serializeDocument({}, '正文')).toBe('正文\n')
  })
  it('往返一致', () => {
    const text = serializeDocument({ 状态: '已确认', 来源引用: '大纲/卷规划/卷01/卷纲.md@5' }, '# 标题\n内容')
    const r = parseDocument(text)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.fields['状态']).toBe('已确认')
      expect(r.data.body).toContain('# 标题')
    }
  })
})
