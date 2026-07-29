import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSafeFileStem } from '../../src/util/filename.js'

/**
 * P0-F1/F3：AI 可控 id 字段进文件路径前的白名单校验。
 * 判定基准=「净化后与原值相同」，与 sanitizeFileName 单源（design §2.1）。
 * 校验拒绝而非静默改写——id 是语义标识，改写会造成 id 与文件名漂移。
 */

test('isSafeFileStem：合法文件名干通过', () => {
  assert.equal(isSafeFileStem('信息差-021-血书真相'), true)
  assert.equal(isSafeFileStem('伏笔-007'), true)
  assert.equal(isSafeFileStem('thread-3'), true)
  assert.equal(isSafeFileStem('第02卷'), true)
})

test('isSafeFileStem：路径穿越全拒', () => {
  assert.equal(isSafeFileStem('../../x'), false)
  assert.equal(isSafeFileStem('..'), false)
  assert.equal(isSafeFileStem('a/b'), false)
  assert.equal(isSafeFileStem('a\\b'), false)
  assert.equal(isSafeFileStem('C:\\x'), false)
  assert.equal(isSafeFileStem('/etc/passwd'), false)
})

test('isSafeFileStem：空串、隐藏文件、保留名、控制字符全拒', () => {
  assert.equal(isSafeFileStem(''), false)
  assert.equal(isSafeFileStem('   '), false)
  assert.equal(isSafeFileStem('.hidden'), false)
  assert.equal(isSafeFileStem('CON'), false)
  assert.equal(isSafeFileStem('con.md'.split('.')[0]), false)
  assert.equal(isSafeFileStem('a\nb'), false)
})

test('isSafeFileStem：Windows 非法字符拒绝', () => {
  for (const bad of ['a<b', 'a>b', 'a:b', 'a"b', 'a|b', 'a?b', 'a*b']) {
    assert.equal(isSafeFileStem(bad), false, bad)
  }
})

test('isSafeFileStem：非字符串入参按 String 归一后再判', () => {
  assert.equal(isSafeFileStem(null), false)
  assert.equal(isSafeFileStem(undefined), false)
  assert.equal(isSafeFileStem(42), true)
})
