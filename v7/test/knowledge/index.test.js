import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import {
  loadRoutes,
  KNOWLEDGE_DIMENSIONS,
  KNOWLEDGE_GROUPS,
  getDimensionDefinition,
  resolveLabel,
  resolveBookKnowledge,
  readEntry,
  listKnowledgeEntries,
  queryKnowledge,
} from '../../src/knowledge/index.js'

// 真源知识库（v7 包根）——样例条目即测试夹具
const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('十维注册表：三阶段边界完整且没有兜底维度', () => {
  assert.deepEqual(KNOWLEDGE_GROUPS.作品契约, ['题材', '流派', '创意约束'])
  assert.deepEqual(KNOWLEDGE_GROUPS.故事对象, ['设定', '人物', '命名'])
  assert.deepEqual(KNOWLEDGE_GROUPS.篇章执行, ['节拍', '场景', '技法', '追读'])
  assert.equal(new Set(KNOWLEDGE_DIMENSIONS).size, 10)
  assert.equal(getDimensionDefinition('桥段'), null)
})

test('loadRoutes 读路由表：题材/流派两维齐全', async () => {
  const rows = await loadRoutes(packageRoot)
  assert.equal(rows.filter((row) => row.维度 === '题材').length, 19)
  assert.equal(rows.filter((row) => row.维度 === '流派').length, 24)
  assert.ok(rows.some((r) => r.维度 === '题材' && r.名称 === '玄幻'))
  assert.ok(rows.some((r) => r.维度 === '流派' && r.名称 === '系统流'))
})

test('resolveLabel 别名归一：修仙→仙侠、系统→系统流；未收录返回 null', async () => {
  const rows = await loadRoutes(packageRoot)
  assert.equal(resolveLabel(rows, '修仙')?.名称, '仙侠')
  assert.equal(resolveLabel(rows, '系统')?.名称, '系统流')
  assert.equal(resolveLabel(rows, '玄幻')?.名称, '玄幻')
  assert.equal(resolveLabel(rows, '不存在的题材'), null)
  assert.equal(resolveLabel(rows, ''), null)
})

test('resolveLabel 边界：快穿/种田只归流派，歧义和复合词不猜题材', async () => {
  const rows = await loadRoutes(packageRoot)
  assert.equal(resolveLabel(rows, '快穿', '题材'), null)
  assert.equal(resolveLabel(rows, '快穿', '流派')?.名称, '快穿流')
  assert.equal(resolveLabel(rows, '种田', '题材'), null)
  assert.equal(resolveLabel(rows, '种田', '流派')?.名称, '种田经营流')
  assert.equal(resolveLabel(rows, '灵异', '题材')?.名称, '灵异')
  for (const input of ['惊悚', '恐怖', '青春', '校园', '竞技', '玄幻修仙']) {
    assert.equal(resolveLabel(rows, input, '题材'), null, `${input} 不应自动归一题材`)
  }
})

test('resolveBookKnowledge：主题材/副题材/流派分别归一、去重，兼容只提醒不删除', async () => {
  const result = await resolveBookKnowledge(packageRoot, {
    类型: '修仙',
    副题材: ['末日', '仙侠', '自创副题材'],
    流派: ['系统', '系统流', '明星文'],
  })
  assert.equal(result.题材命中.名称, '仙侠')
  assert.deepEqual(result.副题材命中.map((item) => item.名称), ['末世'])
  assert.deepEqual(result.流派命中.map((item) => item.名称), ['系统流', '娱乐圈'])
  assert.deepEqual(result.未命中, [{ 维度: '副题材', 输入: '自创副题材' }])
  assert.equal(result.兼容提醒.length, 1)
  assert.match(result.兼容提醒[0], /娱乐圈/)
  assert.match(result.题材命中.来源版本, /^题材\/仙侠\.md@sha256:[0-9a-f]{64}$/)
})

test('resolveBookKnowledge：跨维输入如实未命中，保留显式流派选择', async () => {
  const result = await resolveBookKnowledge(packageRoot, { 类型: '快穿', 流派: ['快穿'] })
  assert.equal(result.题材命中, null)
  assert.deepEqual(result.流派命中.map((item) => item.名称), ['快穿流'])
  assert.deepEqual(result.未命中, [{ 维度: '题材', 输入: '快穿' }])
})

test('resolveBookKnowledge：流派兼容范围为空表示无需窄范围提醒', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'wnw-book-route-'))
  try {
    const references = path.join(tmp, 'references')
    await mkdir(references, { recursive: true })
    await writeFile(
      path.join(references, '路由.csv'),
      [
        '名称,维度,题材,条目,别名',
        '玄幻,题材,玄幻,题材/玄幻.md,东方幻想',
        '通用流,流派,,流派/通用流.md,广用流',
      ].join('\n'),
      'utf8'
    )
    const result = await resolveBookKnowledge(tmp, { 类型: '玄幻', 流派: ['通用流'] })
    assert.equal(result.流派命中[0].名称, '通用流')
    assert.deepEqual(result.兼容提醒, [])
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('readEntry 三节切片；文件缺失返回 null', async () => {
  const e = await readEntry(packageRoot, '场景/拍卖会.md')
  assert.ok(e.规划.length > 0)
  assert.ok(e.落笔时.length > 0)
  assert.ok(e.审稿时.length > 0)
  assert.ok(Array.isArray(e.fm.毒点) && e.fm.毒点.length > 0)
  assert.match(e.来源版本, /^场景\/拍卖会\.md@sha256:[0-9a-f]{64}$/)
  assert.equal(await readEntry(packageRoot, '场景/不存在.md'), null)
  assert.equal(await readEntry(packageRoot, '../README.md'), null)
})

test('listKnowledgeEntries：只读十维直接目录，不递归吞治理文档', async () => {
  const beats = await listKnowledgeEntries(packageRoot, '节拍')
  assert.ok(beats.length > 0)
  assert.ok(beats.every((entry) => entry.文件.startsWith('节拍/')))
  assert.deepEqual(await listKnowledgeEntries(packageRoot, '桥段'), [])
  assert.deepEqual(await listKnowledgeEntries(packageRoot, '技法'), [])
})

test('queryKnowledge：按真实问题机械命中、最多三条、近期只软降权提醒', async () => {
  const hits = await queryKnowledge(packageRoot, '场景', {
    问题: '本章要在拍卖会竞价夺宝，竞价后还会有人盯上主角',
    近期: [{ 维度: '场景', 名称: '拍卖会', 章号: 9 }],
    limit: 99,
  })
  assert.ok(hits.length <= 3)
  assert.equal(hits[0].名称, '拍卖会')
  assert.match(hits[0].重复提醒, /软降权/)
  assert.deepEqual(hits[0].近期使用, [{ 章号: 9 }])
  assert.deepEqual(await queryKnowledge(packageRoot, '场景', { 问题: '毫无机械命中' }), [])
  assert.deepEqual(await queryKnowledge(packageRoot, '场景'), [])
})

test('queryKnowledge：每条创意约束都能从真实未决问题首位命中', async () => {
  const cases = [
    ['不可逆代价', '金手指太万能，能力没有代价，想让关键使用真的造成损失'],
    ['条件触发窗口', '能力随时可用，关键手段没有使用窗口，冲突很难成立'],
    ['优势带可利用弱点', '优势只有好处，能力没有弱点，对手没有博弈空间'],
    ['核心优势可竞争', '主角独占外挂，竞争者没有同类筹码，格局太单向'],
    ['信息有限且会失效', '先知信息永远正确，规则知道得太全，主角无需判断'],
    ['知识转化有门槛', '知道答案就能成功，知识可以直接变现，缺少现实阻力'],
    ['成功解法会被适应', '同一招反复通关，对手不会学习，后面的冲突越来越重复'],
    ['不存在无损选择', '所有难题都有无损最优解，守规没有代价，选择没有重量'],
    ['收益同步扩大风险', '成功只带来奖励，变强不会增加压力，成长越来越安全'],
    ['稀缺资源总量守恒', '资源随取随有，增长没有竞争成本，积累没有取舍'],
    ['核心问题不可由优势直接解决', '金手指直接解决主线，核心难题被能力代打'],
  ]
  for (const [name, question] of cases) {
    const hits = await queryKnowledge(packageRoot, '创意约束', { 问题: question })
    assert.equal(hits[0]?.名称, name, `未决问题没有首位命中「${name}」`)
    assert.ok(hits.length <= 3)
  }
})

test('queryKnowledge：对象子类筛选有消费者，缺目录与非法维度空集降级', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'wnw-ten-dim-'))
  try {
    const settingDir = path.join(tmp, 'references', '设定')
    await mkdir(settingDir, { recursive: true })
    await writeFile(
      path.join(settingDir, '能力代价.md'),
      ['---', '名称: 能力代价', '对象类型: 能力', '一句话: 给能力绑定长期代价', '---', '## 设计时', '', '先定代价。'].join('\n'),
      'utf8'
    )
    await writeFile(
      path.join(settingDir, '组织层级.md'),
      ['---', '名称: 组织层级', '对象类型: 组织', '一句话: 设计组织权力层级', '---', '## 设计时', '', '先定权力。'].join('\n'),
      'utf8'
    )
    const hits = await queryKnowledge(tmp, '设定', { 筛选: { 对象类型: '能力' } })
    assert.deepEqual(hits.map((entry) => entry.名称), ['能力代价'])
    assert.deepEqual(await queryKnowledge(tmp, '人物', { 问题: '反派关系' }), [])
    assert.deepEqual(await queryKnowledge(tmp, '桥段', { 问题: '冲突' }), [])
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
