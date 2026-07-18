import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDesignChangePlan,
  validateDesignContent,
  validateDesignPayload,
  validateDesignRegistry,
} from '../../src/knowledge/design.js'
import { designFixture as design } from './_design-fixture.js'

test('计划对象最小 schema：命名附着对象，必需小节与受控类型通过', () => {
  const result = validateDesignContent(design(), { classification: '人物' })
  assert.equal(result.ok, true, result.errors.join('；'))
  assert.equal(result.data.ID, 'CHAR-001')
  assert.equal(result.data.正名, '林晚')
  assert.deepEqual(result.data.别名, ['晚晚'])
  assert.equal(result.data.path, '大纲/创作设计/人物/CHAR-001-林晚.md')
})

test('计划对象拒绝嵌套字段、非法类型和缺一致性边界', () => {
  const content = design()
    .replace('对象类型: 角色', '对象类型: 物品\n额外:\n  子项: 值')
    .replace('## 一致性边界', '## 其他边界')
  const result = validateDesignContent(content, { classification: '人物' })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('嵌套对象')))
  assert.ok(result.errors.some((error) => error.includes('允许范围')))
  assert.ok(result.errors.some((error) => error.includes('一致性边界')))
})

test('对象 ID 的英文字母必须大写，避免 Windows 大小写路径碰撞', () => {
  const result = validateDesignContent(design({ id: 'char-001' }), { classification: '人物' })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('必须大写')))
})

test('计划变更在落盘前检查 ID、正名与别名冲突', () => {
  const first = validateDesignContent(design(), { classification: '人物' }).data
  const second = validateDesignContent(
    design({ id: 'CHAR-002', name: '搭档计划', canonical: '沈砚', alias: '晚晚' }),
    { classification: '人物' }
  ).data
  const plan = buildDesignChangePlan([], [first, second], [], [])
  assert.equal(plan.ok, false)
  assert.ok(plan.errors.some((error) => error.includes('晚晚')))

  const reserved = buildDesignChangePlan([], [first], [], [{ 名称: '林晚', 归属: '林晚' }])
  assert.equal(reserved.ok, false)
  assert.ok(reserved.errors.some((error) => error.includes('定稿名册')))
})

test('现有计划目录的重复 ID 在读取前即可发现', () => {
  const first = validateDesignContent(design(), { classification: '人物' }).data
  const duplicate = {
    ...validateDesignContent(
      design({ name: '另一份计划', canonical: '沈砚', alias: '阿砚' }),
      { classification: '人物' }
    ).data,
    path: '大纲/创作设计/人物/CHAR-001-沈砚.md',
  }
  const errors = validateDesignRegistry([first, duplicate])
  assert.ok(errors.some((error) => error.includes('ID「CHAR-001」')))
})

test('persist-design payload 必须由作者确认，保存与放弃不能指向同一 ID', () => {
  const result = validateDesignPayload({
    作者已确认: false,
    对象: [{ 分类: '人物', 内容: design() }],
    放弃: ['CHAR-001'],
  })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('作者确认')))
  assert.ok(result.errors.some((error) => error.includes('既保存又放弃')))
})
