import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createKnowledgeSelectionRecord,
  validateContractUpdatePayload,
  validateCreateBookPayload,
  validateWorkContract,
} from '../../src/knowledge/contract.js'
import { minimalCreateBookPayload, minimalWorkContract } from '../state-machine/_helper.js'

test('建书契约：作者确认、八个小节、三项差异化和五项结算全部有效才通过', () => {
  const valid = minimalCreateBookPayload()
  assert.equal(validateCreateBookPayload(valid).ok, true)

  const unconfirmed = validateCreateBookPayload({ ...valid, 作者已确认: false })
  assert.equal(unconfirmed.ok, false)
  assert.ok(unconfirmed.errors.some((error) => error.includes('作者确认')))

  const incomplete = validateCreateBookPayload({
    ...valid,
    作品契约: valid.作品契约
      .replace('## 骨架约定', '## 缺失骨架')
      .replace('- 反派掌握先手信息。', '反派掌握先手信息。')
      .replace('- 救赎条件：持续付出代价。', '- 继续承担后果。'),
  })
  assert.equal(incomplete.ok, false)
  assert.ok(incomplete.errors.some((error) => error.includes('骨架约定')))
  assert.ok(incomplete.errors.some((error) => error.includes('至少需要 3 条')))
  assert.ok(incomplete.errors.some((error) => error.includes('救赎条件')))
})

test('建书契约：book、最终选择和来源版本必须是同一份答案', () => {
  const payload = minimalCreateBookPayload({ book: { 流派: ['系统流'] } })
  const result = validateCreateBookPayload(payload)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('流派不一致')))
})

test('衍生契约：必须同时选择至少一个实际世界副题材', () => {
  const missing = minimalCreateBookPayload({
    book: { 类型: '衍生', 副题材: [] },
    作品契约: minimalWorkContract({ type: '衍生' }),
    知识选择: [{ 维度: '题材', 名称: '衍生', 来源: '作者自定义' }],
  })
  const rejected = validateCreateBookPayload(missing)
  assert.equal(rejected.ok, false)
  assert.ok(rejected.errors.some((error) => error.includes('实际世界副题材')))

  const nonTopic = validateCreateBookPayload(minimalCreateBookPayload({
    book: { 类型: '衍生', 副题材: ['快穿流'] },
    作品契约: minimalWorkContract({ type: '衍生', secondaryTopics: ['快穿流'] }),
    知识选择: [
      { 维度: '题材', 名称: '衍生', 来源: '作者自定义' },
      { 维度: '题材', 名称: '快穿流', 来源: '作者自定义' },
    ],
  }))
  assert.equal(nonTopic.ok, false)
  assert.ok(nonTopic.errors.some((error) => error.includes('非正式题材名称')))
  assert.ok(nonTopic.errors.some((error) => error.includes('实际世界副题材')))

  const valid = minimalCreateBookPayload({
    book: { 类型: '衍生', 副题材: ['玄幻'] },
    作品契约: minimalWorkContract({ type: '衍生', secondaryTopics: ['玄幻'] }),
    知识选择: [
      { 维度: '题材', 名称: '衍生', 来源: '作者自定义' },
      { 维度: '题材', 名称: '玄幻', 来源: '作者自定义' },
    ],
  })
  assert.equal(validateCreateBookPayload(valid).ok, true)
})

test('节奏数值配额：必须同时写明统计对象、使用目的和失效条件', () => {
  const invalidCases = [
    '每三章推进一次主线。',
    '每章安排 2 个兑现。',
    '每卷至少 1 次转折。',
    ['统计对象：', '使用目的：', '失效条件：', '每三章推进一次主线。'].join('\n'),
  ]
  for (const pacing of invalidCases) {
    const incomplete = validateWorkContract(minimalWorkContract({ pacing }))
    assert.equal(incomplete.ok, false, pacing)
    assert.ok(
      incomplete.errors.some((error) => error.includes('统计对象、使用目的和失效条件')),
      pacing
    )
  }

  const complete = validateWorkContract(
    minimalWorkContract({
      pacing: [
        '统计对象：主线发生不可逆变化的章节。',
        '使用目的：防止中段主线停滞。',
        '失效条件：进入终局连续兑现阶段。',
        '本书配额：每三章至少推进一次。',
      ].join('\n'),
    })
  )
  assert.equal(complete.ok, true)
})

test('契约更新：版本严格加一、生效章不倒退，核心分类变化需确认影响分析', () => {
  const previous = validateWorkContract(minimalWorkContract()).data
  const unchanged = {
    作品契约: minimalWorkContract({ version: 2, effectiveChapter: 3 }),
    知识选择: [{ 维度: '题材', 名称: '玄幻', 来源: '作者自定义' }],
    作者已确认: true,
  }
  assert.equal(
    validateContractUpdatePayload(unchanged, { previous, nextChapter: 3 }).ok,
    true
  )

  const early = validateContractUpdatePayload(
    { ...unchanged, 作品契约: minimalWorkContract({ version: 2, effectiveChapter: 2 }) },
    { previous, nextChapter: 3 }
  )
  assert.ok(early.errors.some((error) => error.includes('第 3 章')))

  const changedContract = minimalWorkContract({ version: 2, effectiveChapter: 3 })
    .replace('类型: 玄幻', '类型: 都市')
  const changed = {
    ...unchanged,
    作品契约: changedContract,
    知识选择: [{ 维度: '题材', 名称: '都市', 来源: '作者自定义' }],
  }
  const gated = validateContractUpdatePayload(changed, { previous, nextChapter: 3 })
  assert.ok(gated.errors.some((error) => error.includes('影响分析')))
  assert.equal(
    validateContractUpdatePayload(
      { ...changed, 影响分析已确认: true },
      { previous, nextChapter: 3 }
    ).ok,
    true
  )
})

test('知识选择记录只保存最终采用和真实裁决，不制造评分或空反馈', () => {
  const contract = validateWorkContract(minimalWorkContract()).data
  const content = createKnowledgeSelectionRecord({
    contract,
    selections: [{ 维度: '题材', 名称: '玄幻', 来源: '作者自定义' }],
    decisions: [{ 对象: '万能系统', 结果: '修改', 原因: '改为有代价的能力' }],
  })
  assert.match(content, /题材：玄幻/)
  assert.match(content, /修改「万能系统」/)
  assert.doesNotMatch(content, /评分|满意度|效果预期|章后反馈/)
})
