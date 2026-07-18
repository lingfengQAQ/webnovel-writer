import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { prepareChapterMaterials } from '../../src/prep/index.js'
import { assembleReviewInput } from '../../src/review/index.js'
import { tempBookCtx } from '../commands/_helper.js'
import { designFixture } from './_design-fixture.js'
import { PLAN_PATH } from './_fact-fixture.js'

test('本章对象声明只加载命中计划，并明确计划不等于事实；缺失只提醒', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    const planFile = path.join(ctx.repoPath, ...PLAN_PATH.split('/'))
    await fs.mkdir(path.dirname(planFile), { recursive: true })
    await fs.writeFile(planFile, designFixture(), 'utf8')
    await fs.writeFile(
      path.join(ctx.repoPath, '工作区', '细纲.md'),
      '## 本章提案\n本章对象：CHAR-001、临时路人\n## 本章要写到的事\n林晚初次登场。\n',
      'utf8'
    )

    const materials = await prepareChapterMaterials(ctx, { chapterNum: 3 })
    assert.equal(materials.ok, true, materials.error)
    assert.match(materials.content, /## 本章计划对象（尚未转正）/)
    assert.match(materials.content, /CHAR-001 林晚/)
    assert.match(materials.content, /外怯内韧/)
    assert.match(materials.content, /未找到计划对象：临时路人/)

    const draft = path.join(ctx.repoPath, '工作区', '草稿-A.md')
    await fs.writeFile(draft, '林晚推门而入。', 'utf8')
    const review = await assembleReviewInput(ctx, { chapterNum: 3, draftPath: draft })
    assert.equal(review.ok, true, review.error)
    assert.equal(review.input.本章计划对象.length, 1)
    assert.equal(review.input.本章计划对象[0].计划路径, PLAN_PATH)
    assert.match(review.input.本章计划对象[0].提醒, /不是已经成立/)
    assert.match(review.input.计划对象缺失提醒, /临时路人/)
  } finally {
    await cleanup()
  }
})

test('细纲未声明本章对象时不扫描或全量注入计划目录', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    const broken = path.join(ctx.repoPath, '大纲', '创作设计', '人物', '坏对象.md')
    await fs.mkdir(path.dirname(broken), { recursive: true })
    await fs.writeFile(broken, '不是合法计划对象。', 'utf8')
    await fs.writeFile(
      path.join(ctx.repoPath, '工作区', '细纲.md'),
      '## 本章要写到的事\n一次性路人递来一封信。\n',
      'utf8'
    )
    const materials = await prepareChapterMaterials(ctx, { chapterNum: 3 })
    assert.equal(materials.ok, true, materials.error)
    assert.doesNotMatch(materials.content, /本章计划对象/)

    const draft = path.join(ctx.repoPath, '工作区', '草稿-A.md')
    await fs.writeFile(draft, '路人递来信件后离开。', 'utf8')
    const review = await assembleReviewInput(ctx, { chapterNum: 3, draftPath: draft })
    assert.equal(review.ok, true, review.error)
    assert.deepEqual(review.input.本章计划对象, [])
    assert.equal(review.input.计划对象缺失提醒, undefined)
  } finally {
    await cleanup()
  }
})
