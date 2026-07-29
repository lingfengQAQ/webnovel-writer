import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBookConfig } from '../../../src/storage/parsers/book-config.js'

test('正常解析 book.yaml', () => {
  const yaml = `spec_version: "7.0"
书名: 测试书
类型: 玄幻
每章目标字数: 3000
卷规模: 40
文体基线起: 1
文体基线止: 30
伏笔悬了太久章数: 10
悬念悬了太久章数: 10
感情线悬了太久章数: 30
连续弱钩上限: 3
关键章稿数: 3
自动确认细纲: false
连写批次大小: 8`

  const result = parseBookConfig(yaml)
  assert.equal(result.ok, true)
  assert.equal(result.data.书名, '测试书')
  assert.equal(result.data.每章目标字数, 3000)
  assert.equal(result.data.伏笔悬了太久章数, 10)
})

test('缺字段时使用默认值', () => {
  const yaml = `spec_version: "7.0"
书名: 最小配置
类型: 玄幻
每章目标字数: 3000
卷规模: 40`

  const result = parseBookConfig(yaml)
  assert.equal(result.ok, true)
  assert.equal(result.data.书名, '最小配置')
  assert.equal(result.data.文体基线起, 1) // 默认值
  assert.equal(result.data.伏笔悬了太久章数, 10) // 默认值
  assert.equal(result.data.连写批次大小, 8) // 默认值
})

test('空块列表统一为数组', () => {
  const result = parseBookConfig('书名: 最小配置\n副题材:\n流派:\n')
  assert.equal(result.ok, true)
  assert.deepEqual(result.data.副题材, [])
  assert.deepEqual(result.data.流派, [])
})

test('文体基线起止必须是正整数', () => {
  for (const [field, value] of [
    ['文体基线起', 0],
    ['文体基线起', -1],
    ['文体基线起', 1.5],
    ['文体基线止', 0],
    ['文体基线止', -1],
    ['文体基线止', 2.5],
  ]) {
    const result = parseBookConfig(`${field}: ${value}\n`)
    assert.equal(result.ok, false, `${field}: ${value}`)
    assert.equal(result.data, null)
    assert.match(result.error, new RegExp(field))
    assert.match(result.error, /正整数/)
  }

  const quoted = parseBookConfig('文体基线起: "1"\n')
  assert.equal(quoted.ok, false)
  assert.match(quoted.error, /文体基线起.*正整数/)
})

test('文体基线起不能大于文体基线止', () => {
  const result = parseBookConfig('文体基线起: 31\n文体基线止: 30\n')
  assert.equal(result.ok, false)
  assert.equal(result.data, null)
  assert.match(result.error, /文体基线起.*不能大于.*文体基线止/)
})

test('边界：YAML 语法错误', () => {
  const yaml = `书名: "未闭合`

  const result = parseBookConfig(yaml)
  assert.equal(result.ok, false)
  assert.ok(result.error.includes('解析失败'))
})

test('边界：空 YAML', () => {
  const yaml = ``

  const result = parseBookConfig(yaml)
  assert.equal(result.ok, true)
  assert.equal(result.data.书名, '未命名') // 全部默认值
  assert.equal(result.data.每章目标字数, 3000)
})
