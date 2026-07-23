import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDesignChangePlan,
  validateDesignContent,
  validateDesignPayload,
  validateDesignRegistry,
} from '../../src/knowledge/design.js'
import { designFixture as design } from './_design-fixture.js'

const DEFAULT_KNOWLEDGE_BASIS = [
  '来源：作者自定义',
  '本书适配：人物设计方法经本书采用。',
].join('\n')

function withKnowledgeBasis(basis) {
  return design().replace(DEFAULT_KNOWLEDGE_BASIS, basis)
}

test('计划对象最小 schema：命名附着对象，必需小节与受控类型通过', () => {
  const result = validateDesignContent(design(), { classification: '人物' })
  assert.equal(result.ok, true, result.errors.join('；'))
  assert.equal(result.data.ID, 'CHAR-001')
  assert.equal(result.data.正名, '林晚')
  assert.deepEqual(result.data.别名, ['晚晚'])
  assert.equal(result.data.path, '大纲/创作设计/人物/CHAR-001-林晚.md')
  assert.equal(result.data.sections.get('知识依据'), DEFAULT_KNOWLEDGE_BASIS)
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

test('计划对象知识依据使用精确来源行并留下非空本书适配', () => {
  const missing = validateDesignContent(
    design().replace(/## 知识依据[\s\S]*$/, ''),
    { classification: '人物' }
  )
  assert.equal(missing.ok, false)
  assert.ok(missing.errors.some((error) => error.includes('知识依据')))

  const vague = validateDesignContent(
    withKnowledgeBasis('参考了一些人物方法。'),
    { classification: '人物' }
  )
  assert.equal(vague.ok, false)
  assert.ok(vague.errors.some((error) => error.includes('只允许')))

  const versioned = validateDesignContent(
    withKnowledgeBasis([
      `来源：人物/价值自洽反派与现实代价.md@sha256:${'a'.repeat(64)}`,
      `来源：命名/角色名身份语系.md@sha256:${'b'.repeat(64)}`,
      '本书适配：只采用价值排序与近名检查。',
    ].join('\n')),
    { classification: '人物' }
  )
  assert.equal(versioned.ok, true, versioned.errors.join('；'))

  for (const source of ['作者自定义', '对谈共创']) {
    const custom = validateDesignContent(
      withKnowledgeBasis(`来源：${source}\n本书适配：按本书人物底线改写。`),
      { classification: '人物' }
    )
    assert.equal(custom.ok, true, `${source}：${custom.errors.join('；')}`)
  }
})

test('计划对象知识依据拒绝路径逃逸、错维、substring 与畸形 hash', () => {
  const hash = 'a'.repeat(64)
  const invalidCases = [
    ['缺本书适配', `来源：人物/价值自洽反派与现实代价.md@sha256:${hash}`],
    ['空本书适配', '来源：作者自定义\n本书适配：'],
    ['重复本书适配', '来源：作者自定义\n本书适配：一\n本书适配：二'],
    ['substring trick', '来源：并非作者自定义\n本书适配：说明'],
    ['穿越路径', `来源：人物/../设定/能力.md@sha256:${hash}\n本书适配：说明`],
    ['反斜杠', `来源：人物\\角色.md@sha256:${hash}\n本书适配：说明`],
    ['POSIX 绝对路径', `来源：/人物/角色.md@sha256:${hash}\n本书适配：说明`],
    ['Windows 盘符', `来源：C:/人物/角色.md@sha256:${hash}\n本书适配：说明`],
    ['嵌套目录', `来源：人物/分组/角色.md@sha256:${hash}\n本书适配：说明`],
    ['错维来源', `来源：设定/能力.md@sha256:${hash}\n本书适配：说明`],
    ['63 位 hash', `来源：人物/角色.md@sha256:${'a'.repeat(63)}\n本书适配：说明`],
    ['65 位 hash', `来源：人物/角色.md@sha256:${'a'.repeat(65)}\n本书适配：说明`],
    ['非十六进制 hash', `来源：人物/角色.md@sha256:${'g'.repeat(64)}\n本书适配：说明`],
    ['大写 hash', `来源：人物/角色.md@sha256:${'A'.repeat(64)}\n本书适配：说明`],
    ['尾随垃圾', `来源：人物/角色.md@sha256:${hash}x\n本书适配：说明`],
    ['自由说明行', '来源：作者自定义\n另有一段自由说明\n本书适配：说明'],
  ]
  for (const [label, basis] of invalidCases) {
    const result = validateDesignContent(withKnowledgeBasis(basis), { classification: '人物' })
    assert.equal(result.ok, false, label)
  }
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
