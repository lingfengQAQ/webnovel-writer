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
