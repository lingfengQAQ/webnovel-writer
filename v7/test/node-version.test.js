import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkNodeVersion, MIN_NODE } from '../src/runtime/node-version.js'

test('满足门槛的版本放行', () => {
  for (const v of ['v22.13.0', 'v24.15.0', '22.13.1', 'v23.0.0']) {
    const r = checkNodeVersion(v)
    assert.equal(r.ok, true, `${v} 应放行`)
    assert.equal(r.message, '')
  }
})

test('低于门槛的版本拦截并给人话提示', () => {
  for (const v of ['v22.12.0', 'v21.0.0', 'v18.20.0']) {
    const r = checkNodeVersion(v)
    assert.equal(r.ok, false, `${v} 应拦截`)
    assert.ok(r.message.length > 0, '应有人话提示')
    assert.ok(r.message.includes(MIN_NODE), '提示应含所需版本')
  }
})

test('无法识别的版本串也拦截', () => {
  for (const v of ['', 'abc', null, undefined]) {
    const r = checkNodeVersion(v)
    assert.equal(r.ok, false)
    assert.ok(r.message.length > 0)
  }
})
