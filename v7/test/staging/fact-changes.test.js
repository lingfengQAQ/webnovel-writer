import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { prepareChapterMaterials } from '../../src/prep/index.js'
import { assembleReviewInput } from '../../src/review/index.js'
import { finalizeBatch, readBatch, stageChapter, stagedFacts } from '../../src/staging/index.js'
import { factContentHash } from '../../src/knowledge/fact-changes.js'
import { makeGitBook, chapter } from '../state-machine/_helper.js'
import { writeReviewArtifacts } from './_helper.js'
import { designFixture } from '../knowledge/_design-fixture.js'
import { FACT_PATH, PLAN_PATH, factFixture } from '../knowledge/_fact-fixture.js'
import { persistDraftOutline } from '../../src/state-machine/persist.js'

const DECISION_DETAILS = {
  difference: '计划仍是练气三层，批内草稿写成练气四层。',
  impact: '接受变化会改变后续批内章节使用的战力事实。',
  options: [
    { optionId: 'revise-draft', label: '修改草稿', applyChange: false },
    { optionId: 'accept-change', label: '接受突破', applyChange: true },
  ],
}

function chapterPayload(num, factChanges) {
  return {
    frontMatter: {
      章号: num,
      标题: `第${num}章`,
      卷: 1,
      书内时间: `春月初${num}`,
      字数: 100,
      章定位: '推进',
      钩子: '危机钩-强',
      情绪定位: '铺垫',
      伏笔: ['推进 伏笔-001'],
    },
    body: `第${num}章正文。`,
    factChanges,
    workspaceFiles: [],
  }
}

test('批内事实叠加：后章看到前章待转正事实，并可按前章哈希继续更新', async () => {
  const initialFact = factFixture()
  const updatedFact = factFixture('练气四层')
  const { ctx, root, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n连写批次大小: 8\n',
    '定稿/正文/0001-一.md': chapter(1),
    '定稿/正文/0002-二.md': chapter(2),
    '大纲/卷纲/第01卷.md': '# 第01卷\n林晚登场并突破。\n',
    [PLAN_PATH]: designFixture(),
  })
  try {
    const factChanges3 = [{
      planPath: PLAN_PATH,
      factPath: FACT_PATH,
      content: initialFact,
      decision: '无冲突',
      removePlan: true,
    }]
    await writeReviewArtifacts(root, 3, [], factChanges3, chapterPayload(3, factChanges3))
    const staged3 = await stageChapter(ctx, {
      chapterNum: 3,
      payload: chapterPayload(3, factChanges3),
    })
    assert.equal(staged3.ok, true, staged3.error)

    const overlay = await stagedFacts(root, { before: 4 })
    assert.equal(overlay.factChanges.get(FACT_PATH).content, initialFact)
    assert.ok(overlay.removedPlans.has(PLAN_PATH))

    const confirmed = await persistDraftOutline(ctx, {
      细纲: '## 本章提案\n本章对象：CHAR-001\n## 本章要写到的事\n林晚突破。\n',
    })
    assert.equal(confirmed.ok, true, confirmed.error)
    const materials = await prepareChapterMaterials(ctx, { chapterNum: 4 })
    assert.equal(materials.ok, true, materials.error)
    assert.match(materials.content, /## 批内待转正事实/)
    assert.match(materials.content, /练气三层/)
    assert.match(materials.content, /未找到计划对象：CHAR-001/)
    assert.doesNotMatch(materials.content, /外怯内韧/)

    const draftPath = path.join(root, '工作区', '草稿-A.md')
    await fs.writeFile(draftPath, '---\n标题: 突破\n---\n林晚突破到练气四层。', 'utf8')
    const review = await assembleReviewInput(ctx, { chapterNum: 4, draftPath })
    assert.equal(review.ok, true, review.error)
    assert.equal(review.input.批内待转正事实[0].事实路径, FACT_PATH)
    assert.match(review.input.计划对象缺失提醒, /CHAR-001/)

    const factChanges4 = [{
      planPath: PLAN_PATH,
      factPath: FACT_PATH,
      content: updatedFact,
      decision: '无冲突',
      expectedHash: factContentHash(initialFact),
      removePlan: false,
    }]
    await writeReviewArtifacts(root, 4, [], factChanges4, chapterPayload(4, factChanges4))
    const staged4 = await stageChapter(ctx, {
      chapterNum: 4,
      payload: chapterPayload(4, factChanges4),
    })
    assert.equal(staged4.ok, true, staged4.error)

    const finalized = await finalizeBatch(ctx)
    assert.equal(finalized.ok, true, finalized.error)
    assert.deepEqual(finalized.已入档.map((item) => item.章号), [3, 4])
    assert.match(await fs.readFile(path.join(root, ...FACT_PATH.split('/')), 'utf8'), /练气四层/)
    await assert.rejects(() => fs.access(path.join(root, ...PLAN_PATH.split('/'))))
  } finally {
    await cleanup()
  }
})

test('自动暂存：待裁决事实返回差异、影响和处理选项，且不创建批次文件', async () => {
  const { ctx, root, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n连写批次大小: 8\n',
    '定稿/正文/0001-一.md': chapter(1),
    '定稿/正文/0002-二.md': chapter(2),
    '大纲/卷纲/第01卷.md': '# 第01卷\n林晚登场并突破。\n',
    [PLAN_PATH]: designFixture(),
  })
  try {
    const pending = {
      planPath: PLAN_PATH,
      factPath: FACT_PATH,
      content: factFixture('练气四层'),
      decision: '歧义',
      ...DECISION_DETAILS,
      removePlan: true,
    }
    await writeReviewArtifacts(root, 3, [], [pending], chapterPayload(3))
    const result = await stageChapter(ctx, {
      chapterNum: 3,
      payload: chapterPayload(3),
    })
    assert.equal(result.ok, false)
    assert.match(result.error, /计划仍是练气三层/)
    assert.match(result.error, /改变后续批内章节使用的战力事实/)
    assert.match(result.error, /revise-draft：修改草稿/)
    assert.match(result.error, /accept-change：接受突破/)
    await fs.access(path.join(root, ...PLAN_PATH.split('/')))
    await assert.rejects(() => fs.access(path.join(root, ...FACT_PATH.split('/'))))
    await assert.rejects(() => fs.access(path.join(root, '工作区', '待定稿', '批次.json')))
  } finally {
    await cleanup()
  }
})

test('自动暂存：false 裁决不进入批内事实叠加，批量定稿后仍保留计划', async () => {
  const { ctx, root, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n连写批次大小: 8\n',
    '定稿/正文/0001-一.md': chapter(1),
    '定稿/正文/0002-二.md': chapter(2),
    '大纲/卷纲/第01卷.md': '# 第01卷\n林晚维持原境界。\n',
    [PLAN_PATH]: designFixture(),
  })
  try {
    const pending = {
      planPath: PLAN_PATH,
      factPath: FACT_PATH,
      content: factFixture('练气四层'),
      decision: '冲突',
      ...DECISION_DETAILS,
      removePlan: true,
    }
    const resolvedPayload = chapterPayload(3, [{
      ...pending,
      decision: '作者已裁决',
      resolution: '作者决定保留练气三层，本章不转正突破事实。',
      optionId: 'revise-draft',
    }])
    await writeReviewArtifacts(root, 3, [], [pending], resolvedPayload)
    const staged = await stageChapter(ctx, {
      chapterNum: 3,
      payload: resolvedPayload,
    })
    assert.equal(staged.ok, true, staged.error)

    const overlay = await stagedFacts(root)
    assert.equal(overlay.factChanges.size, 0)
    assert.equal(overlay.removedPlans.has(PLAN_PATH), false)
    const batch = await readBatch(root)
    const payloadPath = path.join(
      root,
      '工作区',
      '待定稿',
      batch.章列表[0].目录,
      '定稿包.json'
    )
    const stored = JSON.parse(await fs.readFile(payloadPath, 'utf8'))
    assert.equal(stored.factChanges, undefined)

    const finalized = await finalizeBatch(ctx)
    assert.equal(finalized.ok, true, finalized.error)
    await fs.access(path.join(root, ...PLAN_PATH.split('/')))
    await assert.rejects(() => fs.access(path.join(root, ...FACT_PATH.split('/'))))
  } finally {
    await cleanup()
  }
})
