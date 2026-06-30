import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMarkdownTable } from '../../../src/storage/parsers/markdown-table.js'

test('正常解析时间线表格', () => {
  const content = `| 章 | 书内时间 | 一句话事件 | 在场 |
|----|----------|------------|------|
| 1 | 1023春月初一 | 林晚入宗门 | 林晚 |
| 2 | 1023春月初二 | 初遇神秘老者 | 林晚, 神秘老者 |`

  const result = parseMarkdownTable(content)
  assert.equal(result.ok, true)
  assert.deepEqual(result.headers, ['章', '书内时间', '一句话事件', '在场'])
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0].章, '1')
  assert.equal(result.rows[0].书内时间, '1023春月初一')
  assert.equal(result.rows[1].在场, '林晚, 神秘老者')
})

test('正常解析名册表格', () => {
  const content = `| 正名 | 别名 | 类型 | 首现章 |
|------|------|------|---------|
| 林晚 | 晚晚, 林师妹 | character | 1 |
| 神秘老者 | 黑衣人 | character | 1 |`

  const result = parseMarkdownTable(content)
  assert.equal(result.ok, true)
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0].正名, '林晚')
  assert.equal(result.rows[0].别名, '晚晚, 林师妹')
})

test('容错：跳过空行', () => {
  const content = `| 章 | 事件 |
|----|------|

| 1 | 事件1 |

| 2 | 事件2 |`

  const result = parseMarkdownTable(content)
  assert.equal(result.ok, true)
  assert.equal(result.rows.length, 2)
})

test('容错：单元格数量不匹配（补空）', () => {
  const content = `| A | B | C |
|---|---|---|
| 1 | 2 |`

  const result = parseMarkdownTable(content)
  assert.equal(result.ok, true)
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].A, '1')
  assert.equal(result.rows[0].B, '2')
  assert.equal(result.rows[0].C, '')
})

test('边界：少于两行', () => {
  const content = `| A | B |`
  const result = parseMarkdownTable(content)
  assert.equal(result.ok, false)
  assert.ok(result.error.includes('至少需要两行'))
})

test('边界：表头格式错误', () => {
  const content = `A | B
|---|---|`
  const result = parseMarkdownTable(content)
  assert.equal(result.ok, false)
  assert.ok(result.error.includes('必须以 | 开头'))
})

test('单字符分隔符 |-| 也要接受（GFM 合法）', () => {
  const content = `| 正名 | 别名 | 类型 | 首现章 |
|--|--|--|--|
| 林晚 | 晚晚 | character | 1 |`
  const result = parseMarkdownTable(content)
  assert.equal(result.ok, true, result.error)
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].正名, '林晚')
  assert.equal(result.rows[0].别名, '晚晚')
})

test('对齐分隔符 |:--:|--:|:--| 也要接受', () => {
  const content = `| A | B | C |
|:--|--:|:--:|
| 1 | 2 | 3 |`
  const result = parseMarkdownTable(content)
  assert.equal(result.ok, true, result.error)
  assert.equal(result.rows[0].B, '2')
})

test('分隔符格数与表头不一致 → 报错', () => {
  const content = `| A | B | C |
|---|---|
| 1 | 2 | 3 |`
  const result = parseMarkdownTable(content)
  assert.equal(result.ok, false)
  assert.ok(result.error.includes('分隔符'))
})

test('分隔符含非 -: 字符 → 报错', () => {
  const content = `| A | B |
|--x--|---|
| 1 | 2 |`
  const result = parseMarkdownTable(content)
  assert.equal(result.ok, false)
  assert.ok(result.error.includes('分隔符'))
})
