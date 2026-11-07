import { describe, expect, it } from 'vitest'
import { DOCUMENT_FIELDS, isDocumentFieldValue, TIMELINE_FIELD_KEYS, WORLDBOOK_INPUT_FIELDS, WORLDBOOK_NATURES, WORLDBOOK_STATES } from '../src/repo/document-fields'

describe('shared document field definitions', () => {
  it('scopes worldbook patch fields to plans, including explicit empty and conditional required semantics', () => {
    expect(Object.keys(WORLDBOOK_INPUT_FIELDS)).toEqual(['类型', '性质', '状态', '来源', '别名', '正文'])
    expect(Object.values(WORLDBOOK_INPUT_FIELDS).every(field => field.owner === 'plan-content')).toBe(true)
    expect(Object.entries(WORLDBOOK_INPUT_FIELDS).filter(([, field]) => field.requiredOnCreate).map(([key]) => key)).toEqual(['类型', '性质', '状态', '来源'])
    expect(WORLDBOOK_INPUT_FIELDS.别名).toMatchObject({ type: 'single-line-text', allowEmpty: true })
    expect(WORLDBOOK_INPUT_FIELDS.正文).toMatchObject({ type: 'markdown', allowEmpty: true })
    expect(WORLDBOOK_INPUT_FIELDS.性质.values).toBe(WORLDBOOK_NATURES)
    expect(WORLDBOOK_INPUT_FIELDS.状态.values).toBe(WORLDBOOK_STATES)
  })

  it('uses one canonical field set for timeline input and stored output', () => {
    expect(TIMELINE_FIELD_KEYS).toEqual(['事件', '时点', '章号', '来源', '裁决记录'])
    expect(new Set(TIMELINE_FIELD_KEYS).size).toBe(TIMELINE_FIELD_KEYS.length)
    expect(DOCUMENT_FIELDS.storyTime.unknown).toBe('未知')
    expect(DOCUMENT_FIELDS.storyTime.owner).toBe('content')
    expect(DOCUMENT_FIELDS.timelineChapter.owner).toBe('system')
  })

  it.each([1, 2, Number.MAX_SAFE_INTEGER])('accepts a positive integer format marker %s', value => {
    expect(isDocumentFieldValue(DOCUMENT_FIELDS.bookFormatVersion, value)).toBe(true)
  })

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined, {}, []])('rejects a non-integer format value %j', value => {
    expect(isDocumentFieldValue(DOCUMENT_FIELDS.bookFormatVersion, value)).toBe(false)
  })

  it.each(['清晨', '三日后', '未知', '景历三年，五月初一'])('keeps a story time as text: %s', value => {
    expect(isDocumentFieldValue(DOCUMENT_FIELDS.storyTime, value)).toBe(true)
  })

  it.each(['', '  ', '清晨\n章号：1', '清晨\r次日', null, 1])('rejects empty or non-field text %j', value => {
    expect(isDocumentFieldValue(DOCUMENT_FIELDS.timelineEvent, value)).toBe(false)
  })
})
