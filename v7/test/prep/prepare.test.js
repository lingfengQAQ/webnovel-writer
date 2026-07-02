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
    // 边界行注入 短题/知情人/关键词/内容首句（AC7）——只给编号等于没给
    assert.match(
      c,
      /- 信息差-001（灭门真凶）：知情人=林晚；关键词=玉佩\/宗门；内容：玉佩乃前代掌门封印邪灵之物，外人不可知。——读者未知，除知情人的对话与视角外不得出现/
    )
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
