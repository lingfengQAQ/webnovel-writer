import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assembleCharacterContext } from '../../src/dto/character-context.js'
import { makeGitBook } from '../state-machine/_helper.js'

const charCard = `---
姓名: 林晚
别名:
  - 晚晚
状态: 在世
位置: 青云宗
境界: 练气三层
持有:
  - 青霜剑
最后变更章: 1
---
## 设定
外门弟子，心性坚韧。`

test('assembleCharacterContext：从角色卡 front matter 组装 DTO', async () => {
  const { ctx, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n',
    '定稿/设定/角色/林晚.md': charCard,
  })
  try {
    const r = await assembleCharacterContext(ctx, '林晚')
    assert.equal(r.ok, true)
    assert.equal(r.context.正名, '林晚')
    assert.equal(r.context.境界, '练气三层')
    assert.equal(r.context.状态, '在世')
    assert.equal(r.context.位置, '青云宗')
    assert.deepEqual(r.context.别名, ['晚晚'])
    assert.deepEqual(r.context.持有, ['青霜剑'])
  } finally {
    await cleanup()
  }
})

test('assembleCharacterContext：DTO 不泄漏文件路径（不变量:AI 永不见文件结构）', async () => {
  const { ctx, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n',
    '定稿/设定/角色/林晚.md': charCard,
  })
  try {
    const r = await assembleCharacterContext(ctx, '林晚')
    const json = JSON.stringify(r.context)
    assert.ok(!json.includes('定稿'), 'DTO 不应含定稿路径')
    assert.ok(!json.includes('.md'), 'DTO 不应含文件名')
    assert.ok(!json.includes(ctx.repoPath), 'DTO 不应含仓库绝对路径')
  } finally {
    await cleanup()
  }
})

test('assembleCharacterContext：角色不存在 → ok=false 不抛', async () => {
  const { ctx, cleanup } = await makeGitBook({ 'book.yaml': '书名: 测\n' })
  try {
    const r = await assembleCharacterContext(ctx, '查无此人')
    assert.equal(r.ok, false)
    assert.equal(r.context, null)
  } finally {
    await cleanup()
  }
})
