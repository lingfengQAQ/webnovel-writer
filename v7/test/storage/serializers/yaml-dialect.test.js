import { test } from 'node:test'
import assert from 'node:assert/strict'
import { serializeYAML } from '../../../src/storage/serializers/yaml-dialect.js'

test('列表输出块格式', () => {
  const data = { 伏笔: ['伏笔-001', '伏笔-002'] }
  const yaml = serializeYAML(data)
  assert.ok(yaml.includes('伏笔:\n  - 伏笔-001\n  - 伏笔-002'))
  assert.ok(!yaml.includes('[伏笔-001, 伏笔-002]'))
})

test('危险值加引号：数字串', () => {
  const data = { 章号: '123' }
  const yaml = serializeYAML(data)
  assert.ok(yaml.includes('章号: "123"'))
})

test('危险值加引号：布尔字面值', () => {
  const data = { 开关: 'true', 标志: 'false' }
  const yaml = serializeYAML(data)
  assert.ok(yaml.includes('开关: "true"'))
  assert.ok(yaml.includes('标志: "false"'))
})

test('危险值加引号：null 字面值', () => {
  const data = { 值: 'null' }
  const yaml = serializeYAML(data)
  assert.ok(yaml.includes('值: "null"'))
})

test('危险值加引号：含冒号', () => {
  const data = { 标题: '包含:冒号' }
  const yaml = serializeYAML(data)
  assert.ok(yaml.includes('标题: "包含:冒号"'))
})

test('危险值加引号：以 # 或 - 开头', () => {
  const data = { 注释: '#comment', 项: '-item' }
  const yaml = serializeYAML(data)
  assert.ok(yaml.includes('注释: "#comment"'))
  assert.ok(yaml.includes('项: "-item"'))
})

test('正常字符串不加引号', () => {
  const data = { 标题: '测试章节', 视角: '林晚' }
  const yaml = serializeYAML(data)
  assert.ok(yaml.includes('标题: 测试章节'))
  assert.ok(yaml.includes('视角: 林晚'))
})

test('数字和布尔值正常输出', () => {
  const data = { 章号: 1, 字数: 3000, 开关: true }
  const yaml = serializeYAML(data)
  assert.ok(yaml.includes('章号: 1'))
  assert.ok(yaml.includes('字数: 3000'))
  assert.ok(yaml.includes('开关: true'))
})

test('嵌套映射抛错', () => {
  const data = { 外层: { 内层: '值' } }
  assert.throws(() => {
    serializeYAML(data)
  }, /禁止嵌套映射/)
})

test('空数组', () => {
  const data = { 列表: [] }
  const yaml = serializeYAML(data)
  assert.equal(yaml, '列表:')
})

test('混合字段', () => {
  const data = {
    章号: 1,
    标题: '测试',
    伏笔: ['伏笔-001', '伏笔-002'],
    危险数字: '123',
  }
  const yaml = serializeYAML(data)
  assert.ok(yaml.includes('章号: 1'))
  assert.ok(yaml.includes('标题: 测试'))
  assert.ok(yaml.includes('伏笔:\n  - 伏笔-001'))
  assert.ok(yaml.includes('危险数字: "123"'))
})
