import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bindReviewInput,
  reviewInputToken,
  validateReviewInputToken,
} from '../../src/review/input-binding.js'

function input(overrides = {}) {
  return {
    章号: 3,
    作品契约版本: 1,
    草稿全文: '正文。',
    作品契约: '## 核心读者承诺\n承诺。',
    相关角色: [{ 名称: '林晚', 状态: '清醒' }],
    ...overrides,
  }
}

test('审稿输入令牌对对象键序稳定，且自校验通过', () => {
  const left = bindReviewInput(input())
  const right = bindReviewInput({
    相关角色: [{ 状态: '清醒', 名称: '林晚' }],
    作品契约: left.作品契约,
    草稿全文: left.草稿全文,
    作品契约版本: 1,
    章号: 3,
  })
  assert.equal(left.审稿输入令牌, right.审稿输入令牌)
  assert.equal(validateReviewInputToken(left).ok, true)
  assert.equal(reviewInputToken(left), left.审稿输入令牌)
})

test('审稿输入令牌绑定数组顺序、正文、契约版本和任一 DTO 字段', () => {
  const base = bindReviewInput(input({ 相关角色: ['甲', '乙'] }))
  const variants = [
    input({ 相关角色: ['乙', '甲'] }),
    input({ 草稿全文: '另一份正文。', 相关角色: ['甲', '乙'] }),
    input({ 作品契约版本: 2, 相关角色: ['甲', '乙'] }),
    input({ 相关角色: ['甲', '乙'], 新字段: '变化' }),
  ].map(bindReviewInput)
  for (const variant of variants) {
    assert.notEqual(variant.审稿输入令牌, base.审稿输入令牌)
  }
})

test('审稿输入令牌缺失、畸形或内容漂移均拒绝', () => {
  const bound = bindReviewInput(input())
  assert.equal(validateReviewInputToken({ ...bound, 审稿输入令牌: '' }).ok, false)
  assert.equal(validateReviewInputToken({ ...bound, 审稿输入令牌: 'sha256:abc' }).ok, false)
  assert.equal(validateReviewInputToken({ ...bound, 草稿全文: '被替换' }).ok, false)
})
