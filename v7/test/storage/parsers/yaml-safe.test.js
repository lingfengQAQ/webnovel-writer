import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseYAML } from '../../../src/storage/parsers/yaml-safe.js'

test('正常 YAML 解析', () => {
  const yaml = `章号: 1
标题: 测试章节
列表:
  - 项1
  - 项2`

  const result = parseYAML(yaml)
  assert.equal(result.ok, true)
  assert.equal(result.data.章号, 1)
  assert.equal(result.data.标题, '测试章节')
  assert.deepEqual(result.data.列表, ['项1', '项2'])
})

test('边界：YAML 语法错误', () => {
  const yaml = `章号: 1
标题: "未闭合引号`

  const result = parseYAML(yaml)
  assert.equal(result.ok, false)
  assert.ok(result.error.length > 0)
})

test('边界：空字符串', () => {
  const result = parseYAML('')
  assert.equal(result.ok, true)
  assert.deepEqual(result.data, {})
})

test('边界：根节点是数组', () => {
  const yaml = `- 项1
- 项2`

  const result = parseYAML(yaml)
  assert.equal(result.ok, false)
  assert.ok(result.error.includes('必须是对象'))
})

test('边界：根节点是标量', () => {
  const yaml = `just a string`

  const result = parseYAML(yaml)
  assert.equal(result.ok, false)
  assert.ok(result.error.includes('必须是对象'))
})

test('容错：null 文档', () => {
  const yaml = `---
null`

  const result = parseYAML(yaml)
  assert.equal(result.ok, true)
  assert.deepEqual(result.data, {})
})

test('保留原始 YAML 字符串', () => {
  const yaml = `章号: 1
自定义字段: 自定义值`

  const result = parseYAML(yaml)
  assert.equal(result.ok, true)
  assert.equal(result.raw, yaml)
  assert.equal(result.data.自定义字段, '自定义值')
})

test('容错读取保留未知字段：解析→修改→序列化', async () => {
  // 导入需要的模块
  const { parseFrontMatter } = await import('../../../src/storage/parsers/front-matter.js')
  const { serializeFrontMatter } = await import('../../../src/storage/serializers/front-matter.js')

  const original = `---
章号: 1
标题: 测试
自定义字段: 自定义值
---
正文内容`

  // 解析
  const parsed = parseFrontMatter(original)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.data.自定义字段, '自定义值')

  // 修改已知字段
  parsed.data.标题 = '新标题'

  // 写回（未知字段的保留由 data 展开达成——parseFrontMatter 把全部键放进 data）
  const serialized = serializeFrontMatter(parsed.data, parsed.body)

  assert.ok(serialized.includes('自定义字段: 自定义值'), '未知字段应被保留')
  assert.ok(serialized.includes('标题: 新标题'), '已知字段应被更新')
  assert.ok(serialized.includes('正文内容'), '正文应被保留')
})

