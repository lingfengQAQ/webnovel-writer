import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFrontMatter } from '../../../src/storage/parsers/front-matter.js'

test('正常路径：含 front matter 的章节文件', () => {
  const content = `---
章号: 1
标题: 测试章节
---
这是正文内容。`

  const result = parseFrontMatter(content)
  assert.equal(result.ok, true)
  assert.equal(result.data.章号, 1)
  assert.equal(result.data.标题, '测试章节')
  assert.equal(result.body, '这是正文内容。')
  assert.equal(result.error, '')
})

test('边界：无 front matter', () => {
  const content = '直接是正文，没有 front matter'
  const result = parseFrontMatter(content)
  assert.equal(result.ok, false)
  assert.ok(result.error.includes('缺少 front matter 分隔符'))
  assert.equal(result.body, content)
})

test('边界：单个 --- 不配对', () => {
  const content = `---
章号: 1
标题: 测试`

  const result = parseFrontMatter(content)
  assert.equal(result.ok, false)
  assert.ok(result.error.includes('不配对'))
})

test('边界：YAML 语法错误', () => {
  const content = `---
章号: 1
标题: 测试
错误缩进
  子项
---
正文`

  const result = parseFrontMatter(content)
  assert.equal(result.ok, false)
  assert.ok(result.error.includes('YAML 解析失败'))
})

test('容错：前面有空行', () => {
  const content = `

---
章号: 1
---
正文`

  const result = parseFrontMatter(content)
  assert.equal(result.ok, true)
  assert.equal(result.data.章号, 1)
})

test('容错：非字符串输入', () => {
  const result = parseFrontMatter(null)
  assert.equal(result.ok, false)
  assert.ok(result.error.includes('必须是字符串'))
})
