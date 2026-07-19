import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '../../src/commands/knowledge-query.js'

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('knowledge-query：只给少量材料并明确允许拒绝、自定义', async () => {
  const result = await run([], { 维度: '场景', 问题: '拍卖会竞价夺宝' }, { packageRoot })
  assert.equal(result.ok, true, result.error)
  assert.match(result.output, /拍卖会/)
  assert.match(result.output, /来源：场景\/拍卖会\.md@sha256:/)
  assert.match(result.output, /选择、组合、修改、拒绝或自定义/)
})

test('knowledge-query：无命中不回退全量菜单；非法维度前置拒绝', async () => {
  const empty = await run([], { 维度: '技法', 问题: '未知写法' }, { packageRoot })
  assert.equal(empty.ok, true)
  assert.match(empty.output, /没有按名称、编号或现有索引命中/)
  assert.match(empty.output, /不要为了凑候选改用全量菜单/)

  const invalid = await run([], { 维度: '桥段', 问题: '冲突' }, { packageRoot })
  assert.equal(invalid.ok, false)
  assert.match(invalid.error, /维度/)
})

test('knowledge-query：创意约束按未决问题给材料，不按题材固定选择', async () => {
  const result = await run(
    [],
    { 维度: '创意约束', 问题: '知道答案就能成功，知识可以直接变现，缺少现实阻力' },
    { packageRoot }
  )
  assert.equal(result.ok, true)
  assert.match(result.output, /知识转化有门槛/)
  assert.match(result.output, /选择、组合、修改、拒绝或自定义/)
})
