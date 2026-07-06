import { test } from 'node:test'
import assert from 'node:assert/strict'
import { serializeYAML } from '../../../src/storage/serializers/yaml-dialect.js'
import { serializeFrontMatter } from '../../../src/storage/serializers/front-matter.js'
import { parseFrontMatter } from '../../../src/storage/parsers/front-matter.js'

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

// —— R7/R8 往返回归表：写出的 front matter 必须原样读得回 ——
// 每个值都是第三轮 review 复现过 DRIFT（类型漂移/被裁）或 PARSEFAIL（整文件读不回）的案例。
const 往返用例 = [
  ['空串', ''],
  ['前后空格', '  甲  '],
  ['中间制表符', 'a\tb'],
  ['十六进制形态', '0x1F'],
  ['八进制形态', '0o17'],
  ['二进制形态', '0b101'],
  ['科学计数', '1e3'],
  ['带符号整数', '+5'],
  ['带符号科学计数', '-2.5E-3'],
  ['波浪线', '~'],
  ['inf 字面值', '.inf'],
  ['nan 字面值', '.NaN'],
  ['方括号起首', '[快穿]反派'],
  ['星号起首', '*追读'],
  ['锚点起首', '&a'],
  ['双引号起首', '"引号"书'],
  ['单引号起首', "'单引'"],
  ['横杠空格起首', '- 开局'],
  ['反斜杠加冒号', 'C:\\Users\\x'],
  ['纯反斜杠路径', '路径\\子目录\\文件'],
  ['折叠符起首', '|折叠'],
  ['引用符起首', '>引用'],
  ['叹号起首', '!标签'],
  ['百分号起首', '%指令'],
  ['逗号起首', ',逗号'],
  ['问号加空格起首', '? 问'],
  ['行内注释', '前半 #后半'],
  ['花括号起首', '{流式}'],
  ['换行值', '第一行\n第二行'],
]

for (const [名称, 值] of 往返用例) {
  test(`往返保真：${名称}`, () => {
    const content = serializeFrontMatter({ 标题: '往返', 值 }, '正文\n')
    const parsed = parseFrontMatter(content)
    assert.equal(parsed.ok, true, `解析失败：${parsed.error}`)
    assert.equal(parsed.data.值, 值, `往返漂移：${JSON.stringify(parsed.data.值)} !== ${JSON.stringify(值)}`)
  })
}

test('往返保真：数组项含危险值', () => {
  const content = serializeFrontMatter({ 标题: '往返', 本章要写到的事: ['[伏笔] 埋线', '*重点*', '1e3'] }, '')
  const parsed = parseFrontMatter(content)
  assert.equal(parsed.ok, true, `解析失败：${parsed.error}`)
  assert.deepEqual(parsed.data.本章要写到的事, ['[伏笔] 埋线', '*重点*', '1e3'])
})
