import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePositiveInt } from '../../src/util/positive-int.js'

/**
 * P0-F5：章号/卷号统一口径——十进制正整数，其余一律 null。
 * 拒绝 isNaN 拦不住的 "3.5"（Number 后不截断比较）、"1e3"、负数、0、杂字符。
 */

test('parsePositiveInt：正常章号/卷号通过', () => {
  assert.equal(parsePositiveInt('3'), 3)
  assert.equal(parsePositiveInt(3), 3)
  assert.equal(parsePositiveInt('12'), 12)
  assert.equal(parsePositiveInt(' 3 '), 3)
})

test('parsePositiveInt：非正整数一律 null', () => {
  for (const bad of ['3.5', '-1', '0', '1e3', 'abc', '', '03a', '1.0', null, undefined]) {
    assert.equal(parsePositiveInt(bad), null, String(bad))
  }
  for (const bad of [3.5, -1, 0, NaN, Infinity]) {
    assert.equal(parsePositiveInt(bad), null, String(bad))
  }
})

test('parsePositiveInt：拒绝前导零与非十进制形态', () => {
  assert.equal(parsePositiveInt('03'), null)
  assert.equal(parsePositiveInt('0x10'), null)
})
