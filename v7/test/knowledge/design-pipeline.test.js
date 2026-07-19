import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { prepareChapterMaterials } from '../../src/prep/index.js'
import { assembleReviewInput } from '../../src/review/index.js'
import { queryKnowledge } from '../../src/knowledge/index.js'
import { validateFactChanges } from '../../src/knowledge/fact-changes.js'
import { run as persistDesign } from '../../src/commands/persist-design.js'
import { gitBookCtx, tempBookCtx } from '../commands/_helper.js'
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

test('故事对象候选只在规划阶段本书化；prep/review 不回读通用条目，事实转正仍走计划边界', async () => {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-object-reference-'))
  const { ctx, cleanup } = await gitBookCtx()
  try {
    ctx.packageRoot = packageRoot
    const referenceDir = path.join(packageRoot, 'references', '人物')
    await fs.mkdir(referenceDir, { recursive: true })
    const referencePath = path.join(referenceDir, '价值自洽反派与现实代价.md')
    await fs.writeFile(
      referencePath,
      [
        '---',
        '名称: 价值自洽反派与现实代价',
        '人物类别: 角色',
        '一句话: 反派只因邪恶行动,理念没有内部逻辑',
        '---',
        '## 规划时',
        '',
        '锁定价值排序与现实代价。',
      ].join('\n'),
      'utf8'
    )
    const candidates = await queryKnowledge(packageRoot, '人物', {
      问题: '反派只因邪恶行动，理念没有内部逻辑',
    })
    assert.equal(candidates[0]?.名称, '价值自洽反派与现实代价')

    const planContent = [
      '---',
      'ID: CHAR-900',
      '名称: 对手计划',
      '对象类型: 角色',
      '正名: 顾衡',
      '---',
      '## 本书设计',
      '顾衡要保护证人，但不能替证人做选择。',
      '## 一致性边界',
      '顾衡不会用牺牲无辜换取胜利。',
      '## 知识依据',
      `${candidates[0].来源版本}`,
      '只采用价值排序检查，不采用固定反派身份。',
    ].join('\n')
    const payloadPath = path.join(ctx.repoPath, '工作区', '对象设计.json')
    await fs.writeFile(payloadPath, JSON.stringify({ 作者已确认: true, 对象: [{ 分类: '人物', 内容: planContent }] }), 'utf8')
    const saved = await persistDesign([], { file: payloadPath }, ctx)
    assert.equal(saved.ok, true, saved.error)
    await fs.writeFile(
      referencePath,
      [
        '---',
        '名称: 价值自洽反派与现实代价',
        '人物类别: 角色',
        '一句话: 通用条目后来发生漂移',
        '---',
        '## 规划时',
        '',
        '通用条目后来发生漂移。',
      ].join('\\n'),
      'utf8'
    )
    await fs.writeFile(
      path.join(ctx.repoPath, '工作区', '细纲.md'),
      '## 本章提案\n本章对象：CHAR-900\n## 本章要写到的事\n保护证人。\n',
      'utf8'
    )

    const materials = await prepareChapterMaterials(ctx, { chapterNum: 3 })
    assert.equal(materials.ok, true, materials.error)
    assert.match(materials.content, /顾衡要保护证人/)
    assert.doesNotMatch(materials.content, /通用条目后来发生漂移|反派只因邪恶行动/)
    const draft = path.join(ctx.repoPath, '工作区', '草稿-A.md')
    await fs.writeFile(draft, '顾衡保护证人。', 'utf8')
    const review = await assembleReviewInput(ctx, { chapterNum: 3, draftPath: draft })
    assert.equal(review.ok, true, review.error)
    assert.equal(review.input.本章计划对象.length, 1)
    assert.doesNotMatch(JSON.stringify(review.input), /通用条目后来发生漂移/)

    const fact = await validateFactChanges(ctx.repoPath, [{
      planPath: '大纲/创作设计/人物/CHAR-900-顾衡.md',
      factPath: '定稿/设定/角色/顾衡.md',
      content: '---\n姓名: 顾衡\n---\n## 设定\n已在正文成立。\n',
      decision: '无冲突',
      removePlan: true,
    }])
    assert.equal(fact.ok, true, fact.errors.join('；'))
  } finally {
    await cleanup()
    await fs.rm(packageRoot, { recursive: true, force: true })
  }
})
