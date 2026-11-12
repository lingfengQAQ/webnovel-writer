import { describe, expect, it } from 'vitest'
import { isJsonValue } from '@deepseek-ai/dsh-util-values'
import { omitUndefinedFields } from '../src/tool-json'

describe('工具结果出口的无损 JSON 防护（#213）', () => {
  it('只剔除普通对象中值为 undefined 的键，嵌套与空原型对象同样处理', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { kept: 1, gone: undefined })
    const value = { ok: true, gone: undefined, nested: { a: '文', b: undefined, list: [{ c: undefined, d: null }] }, bare }
    const result = omitUndefinedFields(value)
    expect(result).toStrictEqual({ ok: true, nested: { a: '文', list: [{ d: null }] }, bare: { kept: 1 } })
    expect(isJsonValue(result)).toBe(true)
    expect(value.nested.b).toBeUndefined(); expect(Object.hasOwn(value, 'gone')).toBe(true)
  })

  it('无需改动时保留原对象与未改动子树的身份', () => {
    const clean = { ok: true, list: [1, '二', { 三: false }] }
    expect(omitUndefinedFields(clean)).toBe(clean)
    const partly = { keep: { deep: [1] }, fix: { gone: undefined } }
    const result = omitUndefinedFields(partly)
    expect(result.keep).toBe(partly.keep)
    expect(result.fix).toStrictEqual({})
  })

  it('数组中的 undefined、非有限数、环与非普通对象不改写，宿主仍会拒收', () => {
    const cyclic: Record<string, unknown> = { gone: undefined }
    cyclic['self'] = cyclic
    const date = new Date(0)
    for (const value of [[1, undefined], { n: Number.NaN }, { date }]) {
      expect(omitUndefinedFields(value)).toBe(value)
      expect(isJsonValue(omitUndefinedFields(value))).toBe(false)
    }
    expect(isJsonValue(omitUndefinedFields(cyclic))).toBe(false)
    for (const scalar of [null, undefined, 0, '', false]) expect(omitUndefinedFields(scalar)).toBe(scalar)
  })
})
