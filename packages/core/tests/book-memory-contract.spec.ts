import { describe, expect, it } from 'vitest'
import { classifyBookMemoryDocument, isMemoryKind } from '../src/repo/book-memory-contract'
import { MEMORY_KINDS } from '../src/repo/paths'

describe('book memory shape contract', () => {
  it.each(MEMORY_KINDS)('recognizes current %s by the declared class, not the filename', kind => {
    expect(isMemoryKind(kind)).toBe(true)
    expect(classifyBookMemoryDocument({ 类: kind }, '普通条目')).toEqual({ ok: true, format: 'current', memoryKind: kind })
    expect(classifyBookMemoryDocument({ 类: kind }, '文风')).toEqual({ ok: true, format: 'current', memoryKind: kind })
  })

  it.each(MEMORY_KINDS)('recognizes legacy %s only when no class is declared', kind => {
    expect(classifyBookMemoryDocument({}, kind)).toEqual({ ok: true, format: 'legacy', memoryKind: kind })
  })

  it.each([undefined, null, '', ' ', '未知', '文风 ', 42, true, [], ['文风'], { 类: '文风' }])('rejects an explicitly invalid class %j even on a legacy filename', value => {
    expect(isMemoryKind(value)).toBe(false)
    for (const basename of ['文风', '普通条目']) {
      expect(classifyBookMemoryDocument({ 类: value }, basename)).toMatchObject({ ok: false, kind: 'invalid-class' })
    }
  })

  it.each(['普通条目', '文风.md', '文风 ', '', '未知'])('does not infer a class for %s', basename => {
    expect(classifyBookMemoryDocument({}, basename)).toMatchObject({ ok: false, kind: 'missing-class' })
  })

  it('does not alter or validate unrelated metadata', () => {
    const fields = Object.freeze({ 类: '文风', 名称: null, 描述: [], 来源: 42, 作者扩展: Object.freeze({ 原值: true }) })
    expect(classifyBookMemoryDocument(fields, '保留原文')).toEqual({ ok: true, format: 'current', memoryKind: '文风' })
    expect(fields).toEqual({ 类: '文风', 名称: null, 描述: [], 来源: 42, 作者扩展: { 原值: true } })
  })
})
