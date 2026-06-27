import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareChapterMaterials } from '../../src/prep/index.js'
import { tempBookCtx } from '../commands/_helper.js'
import { read } from '../storage/_tmprepo.js'

test('prepareChapterMaterials 组装本章写作材料（八组件锚点）并写出', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    const r = await prepareChapterMaterials(ctx, { chapterNum: 3 })
    assert.equal(r.ok, true)
    const c = r.content
    assert.match(c, /全书近况/)
    assert.match(c, /第\s*1\s*卷/)
    assert.match(c, /本章要写到的事/)
    assert.match(c, /查到玉佩/) // 来自细纲
    assert.match(c, /信息差边界/)
    assert.match(c, /信息差-001/) // 未揭晓信息差，勿泄
    assert.match(c, /文风锚点/)
    assert.match(c, /节奏/) // 来自文风铁律
    assert.match(c, /反和解/)
    assert.match(c, /反派恶意/) // 来自文风铁律反和解段

    const onDisk = await read(ctx.repoPath, '工作区/本章写作材料.md')
    assert.match(onDisk, /第 3 章写作材料/)
  } finally {
    await cleanup()
  }
})
