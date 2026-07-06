import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EntityWriter } from '../../../src/storage/adapters/EntityWriter.js'
import { makeRepo, cleanup, read } from '../_tmprepo.js'

const 角色卡 = `---
姓名: 林晚
状态: 在世
位置: 青云宗
境界: 练气三层
最后变更章: 1
---
## 设定
外门弟子。
`

test('updateCharacter 改 front matter，保留正文', async () => {
  const root = await makeRepo({ '定稿/设定/角色/林晚.md': 角色卡 })
  try {
    const r = await new EntityWriter(root).updateCharacter('林晚', {
      位置: '北境雪原',
      境界: '练气五层',
      最后变更章: 152,
    })
    assert.equal(r.ok, true)
    const c = await read(root, '定稿/设定/角色/林晚.md')
    assert.match(c, /位置: 北境雪原/)
    assert.match(c, /境界: 练气五层/)
    assert.match(c, /最后变更章: 152/)
    assert.match(c, /外门弟子/)
  } finally {
    await cleanup(root)
  }
})

test('updateCharacter 不存在的角色 → ok=false（不崩）', async () => {
  const root = await makeRepo({})
  try {
    const r = await new EntityWriter(root).updateCharacter('查无此人', { 状态: '死亡' })
    assert.equal(r.ok, false)
  } finally {
    await cleanup(root)
  }
})

const 名册 = '| 正名 | 别名 | 类型 | 首现章 |\n|---|---|---|---|\n| 林晚 | 晚晚 | character | 1 |\n'

test('upsertRosterRow 新增名册行', async () => {
  const root = await makeRepo({ '定稿/设定/名册.md': 名册 })
  try {
    const r = await new EntityWriter(root).upsertRosterRow({
      正名: '神秘老者',
      别名: '黑衣人',
      类型: 'character',
      首现章: 1,
    })
    assert.equal(r.ok, true)
    const c = await read(root, '定稿/设定/名册.md')
    assert.match(c, /\| 林晚 \|/)
    assert.match(c, /\| 神秘老者 \| 黑衣人 \| character \| 1 \|/)
  } finally {
    await cleanup(root)
  }
})

test('upsertRosterRow 已存在则更新该行（不重复）', async () => {
  const root = await makeRepo({ '定稿/设定/名册.md': 名册 })
  try {
    const r = await new EntityWriter(root).upsertRosterRow({
      正名: '林晚',
      别名: '晚晚, 林师妹',
      类型: 'character',
      首现章: 1,
    })
    assert.equal(r.ok, true)
    const c = await read(root, '定稿/设定/名册.md')
    assert.match(c, /\| 林晚 \| 晚晚, 林师妹 \| character \| 1 \|/)
    assert.equal((c.match(/\| 林晚 \|/g) || []).length, 1)
  } finally {
    await cleanup(root)
  }
})

test('A11：upsert 更新行时保留作者手加的额外列', async () => {
  const 带备注名册 =
    '| 正名 | 别名 | 类型 | 首现章 | 备注 |\n|---|---|---|---|---|\n| 林晚 | 晚晚 | 角色 | 1 | 主角，勿动 |\n'
  const root = await makeRepo({ '定稿/设定/名册.md': 带备注名册 })
  try {
    const r = await new EntityWriter(root).upsertRosterRow({
      正名: '林晚',
      别名: '晚晚, 小晚',
      类型: '角色',
      首现章: 1,
    })
    assert.equal(r.ok, true)
    const c = await read(root, '定稿/设定/名册.md')
    assert.match(c, /\| 林晚 \| 晚晚, 小晚 \| 角色 \| 1 \| 主角，勿动 \|/, `备注列不能丢：\n${c}`)
  } finally {
    await cleanup(root)
  }
})

