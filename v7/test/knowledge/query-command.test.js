import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
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

test('knowledge-query：故事对象类型筛选使用受控字段并拒绝未知类型', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wnw-object-query-'))
  try {
    for (const dir of ['设定', '人物', '命名']) await mkdir(path.join(root, 'references', dir), { recursive: true })
    await writeFile(path.join(root, 'references', '设定', '能力.md'), ['---', '名称: 能力', '对象类型: 能力', '一句话: 能力有代价', '---', '## 规划时', '', '锁定代价。'].join('\n'), 'utf8')
    await writeFile(path.join(root, 'references', '人物', '关系.md'), ['---', '名称: 关系', '人物类别: 关系', '一句话: 利益变化推动关系', '---', '## 规划时', '', '锁定变化条件。'].join('\n'), 'utf8')
    await writeFile(path.join(root, 'references', '命名', '角色名.md'), ['---', '名称: 角色名', '命名对象:', '  - 角色', '一句话: 名字承担身份辨识', '---', '## 规划时', '', '检查近名冲突。'].join('\n'), 'utf8')
    const person = await run([], { 维度: '人物', 类型: '关系' }, { packageRoot: root })
    assert.equal(person.ok, true, person.error)
    assert.match(person.output, /关系/)
    assert.match(person.output, /规划切片/)
    const naming = await run([], { 维度: '命名', 类型: '角色' }, { packageRoot: root })
    assert.equal(naming.ok, true, naming.error)
    assert.match(naming.output, /角色名/)
    const invalid = await run([], { 维度: '人物', 类型: '反派' }, { packageRoot: root })
    assert.equal(invalid.ok, false)
    assert.match(invalid.error, /角色、关系/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
