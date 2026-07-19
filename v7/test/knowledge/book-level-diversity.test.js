import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { run as knowledgePack } from '../../src/commands/knowledge-pack.js'
import { validateCreateBookPayload } from '../../src/knowledge/contract.js'

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')

const cases = [
  {
    classification: { 类型: '仙侠', 副题材: ['末世'], 流派: ['系统流'] },
    variants: [
      {
        书名: '仙侠末世甲',
        constraint: '信息有限且会失效',
        promise: '在崩坏秩序中求道，任何先知信息都会因行动改变而过期。',
        mechanism: '系统只给局部灾变信息；角色使用信息改变现实后，后续提示必须重新验证。',
        fusion: [
          '共同核心冲突：求道所需的因果判断与末世中的信息失真共同迫使角色验证选择。',
          '主题材承诺与主线因果：仙侠负责修行、因果与超脱选择，主线由求道目标推进。',
          '副题材介入条件与独立贡献：文明保障崩坏时末世介入，提供稀缺、生存与新秩序压力。',
          '规则兼容或隔离：修行因果保持稳定，灾变信息只允许局部确认，二者不互相改写。',
          '主副线职责：求道选择改变主线，生存组织检验这些选择能否承担现实后果。',
          '冲突解决方式：信息冲突时先验证可观察后果，不让系统直接裁定正确答案。',
          '主要失焦风险：若系统信息永久准确，末世压力与因果判断都会退化为照单执行。',
        ],
        differences: ['先知信息会被角色行动改写。', '修行判断必须经过现实验证。', '生存组织反向影响求道选择。'],
      },
      {
        书名: '仙侠末世乙',
        constraint: '稀缺资源总量守恒',
        promise: '在崩坏秩序中求道，任何修行增长都必须重分配有限生存资源。',
        mechanism: '系统只能记录固定资源的去向，不能增发；角色变强必然改变共同体分配。',
        fusion: [
          '共同核心冲突：有限资源同时支撑修行与生存，任何分配都会改变共同体和求道路径。',
          '主题材承诺与主线因果：仙侠负责修行、因果与超脱选择，主线围绕资源如何改变道途。',
          '副题材介入条件与独立贡献：基础供应崩坏时末世介入，使修行资源与生存资源直接竞争。',
          '规则兼容或隔离：修行消耗和生存消耗使用同一守恒账，不允许系统在两套规则间增发。',
          '主副线职责：修行决策推进主线，共同体分配显示每次增长由谁承担成本。',
          '冲突解决方式：资源冲突通过公开取舍与替代成本解决，不用隐藏库存取消损失。',
          '主要失焦风险：若主角总能发现额外资源，末世稀缺与修行因果都会失去重量。',
        ],
        differences: ['修行与生存共用守恒资源。', '系统只记录分配而不创造资源。', '共同体承担的成本会改变修行路线。'],
      },
    ],
  },
  {
    classification: { 类型: '现言', 副题材: ['现实'], 流派: ['娱乐圈'] },
    variants: [
      {
        书名: '现言现实甲',
        constraint: '核心问题不可由优势直接解决',
        promise: '专业优势能创造公开机会，但不能替人物修复信任或替行业问题给出答案。',
        mechanism: '角色可以用专业能力获得证据和舞台，关系选择与制度改变仍需双方行动。',
        fusion: [
          '共同核心冲突：公开职业选择同时改变亲密关系与真实行业处境。',
          '主题材承诺与主线因果：现言负责双方关系选择，主线由信任边界变化推进。',
          '副题材介入条件与独立贡献：职业制度影响选择时现实介入，提供不能靠表白消除的后果。',
          '规则兼容或隔离：专业表现可以创造机会，不能直接决定关系与制度判断。',
          '主副线职责：关系行动推进主线，作品生产和制度反馈验证行动是否真实。',
          '冲突解决方式：证据只打开选择空间，最终结果由人物承担责任与组织行动形成。',
          '主要失焦风险：若一次成功作品解决全部关系和制度问题，现实副题材会变成装饰。',
        ],
        differences: ['专业能力只能创造条件。', '信任必须由双方行动重建。', '行业问题需要组织回应而非个人获奖。'],
      },
      {
        书名: '现言现实乙',
        constraint: '收益同步扩大风险',
        promise: '职业成功会扩大公众承诺和隐私风险，关系双方必须重新协商边界。',
        mechanism: '每次作品成功都增加机会、依赖与曝光，收益和关系压力来自同一公开反馈。',
        fusion: [
          '共同核心冲突：职业成功扩大公共责任，也压缩亲密关系可以保留的私人空间。',
          '主题材承诺与主线因果：现言负责关系边界协商，主线由双方对公开生活的选择推进。',
          '副题材介入条件与独立贡献：公共反馈改变职业与生活时现实介入，提供制度和群体后果。',
          '规则兼容或隔离：职业收益与曝光风险同源，关系承诺不能要求职业世界停止运转。',
          '主副线职责：关系选择推进主线，作品反馈持续改变可协商的资源与风险。',
          '冲突解决方式：双方通过调整承诺、工作与公开边界承担增长，不靠退出职业一键清零。',
          '主要失焦风险：若成功只增加名气和甜蜜，现实压力与关系选择都会失去递进。',
        ],
        differences: ['职业收益与曝光风险同源。', '关系边界随公众承诺变化。', '成功需要新的组织和责任能力承接。'],
      },
    ],
  },
]

test('相同题材/流派输入可形成不同创意约束和融合协议', async () => {
  for (const group of cases) {
    const options = {
      类型: group.classification.类型,
      副题材: group.classification.副题材.join(','),
      流派: group.classification.流派.join(','),
    }
    const pack = await knowledgePack([], options, { packageRoot })
    assert.equal(pack.ok, true)
    assert.match(pack.output, /题材融合协议检查/)
    for (const variant of group.variants) {
      assert.doesNotMatch(pack.output, new RegExp(variant.constraint), '固定路由不应选择创意约束')
    }

    const payloads = group.variants.map((variant) => makePayload(group.classification, variant))
    const validations = payloads.map((payload) => validateCreateBookPayload(payload))
    for (const validation of validations) {
      assert.equal(validation.ok, true, validation.errors.join('\n'))
      const fusion = validation.contract.sections.get('题材融合协议')
      for (const item of ['共同核心冲突', '主题材承诺与主线因果', '副题材介入条件与独立贡献', '规则兼容或隔离', '主副线职责', '冲突解决方式', '主要失焦风险']) {
        assert.match(fusion, new RegExp(item))
      }
    }
    assert.deepEqual(payloads[0].book.类型, payloads[1].book.类型)
    assert.deepEqual(payloads[0].book.副题材, payloads[1].book.副题材)
    assert.deepEqual(payloads[0].book.流派, payloads[1].book.流派)
    assert.notEqual(
      validations[0].contract.sections.get('创意约束落地'),
      validations[1].contract.sections.get('创意约束落地')
    )
    assert.notEqual(
      validations[0].contract.sections.get('题材融合协议'),
      validations[1].contract.sections.get('题材融合协议')
    )
  }
})

function makePayload(classification, variant) {
  const selections = [
    { 维度: '题材', 名称: classification.类型, 来源: '作者自定义' },
    ...classification.副题材.map((名称) => ({ 维度: '题材', 名称, 来源: '作者自定义' })),
    ...classification.流派.map((名称) => ({ 维度: '流派', 名称, 来源: '作者自定义' })),
    { 维度: '创意约束', 名称: variant.constraint, 来源: '作者自定义' },
  ]
  const contract = [
    '---',
    `类型: ${classification.类型}`,
    '副题材:',
    ...classification.副题材.map((name) => `  - ${name}`),
    '流派:',
    ...classification.流派.map((name) => `  - ${name}`),
    '创意约束:',
    `  - ${variant.constraint}`,
    '来源版本:',
    ...selections.map(() => '  - 作者自定义'),
    '契约版本: 1',
    '生效起章: 1',
    '更新原因: 初始建书',
    '变更类型: 建书',
    '---',
    '## 核心读者承诺',
    variant.promise,
    '## 骨架约定',
    '题材、流派和创意约束共同改变主线选择，不按固定组合模板推进。',
    '## 题材融合协议',
    ...variant.fusion.map((line) => `- ${line}`),
    '## 创意约束落地',
    variant.mechanism,
    '## 差异化点',
    ...variant.differences.map((line) => `- ${line}`),
    '## 冲突与关系结算原则',
    '- 主角底线：由本书行为边界决定，不从题材默认推导。',
    '- 伤害后果：造成的实际影响必须进入后续选择。',
    '- 和解条件：责任与修复行动由具体关系共同确定。',
    '- 救赎条件：持续改变行为并承担既有后果。',
    '- 允许余地：角色可以克制、宽恕、分离或重建关系。',
    '## 本书专属毒点',
    '- 不让通用路由替作者决定具体创意与结局。',
    '## 节奏与兑现参数',
    '按因果节点推进，不设固定章数。',
  ].join('\n')
  return {
    book: { spec_version: '7.0', 书名: variant.书名, ...classification },
    总纲: '# 总纲',
    卷纲: '# 第一卷',
    作品契约: contract,
    知识选择: selections,
    作者已确认: true,
  }
}
