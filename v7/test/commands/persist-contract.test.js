import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { run as persistContract } from '../../src/commands/persist-contract.js'
import { run as finalizeCommand } from '../../src/commands/finalize.js'
import { createGit } from '../../src/finalize/git.js'
import { finalizeChapter } from '../../src/finalize/index.js'
import { validateWorkContract } from '../../src/knowledge/contract.js'
import { prepareChapterMaterials } from '../../src/prep/index.js'
import {
  discardBatch,
  finalizeBatch,
  readBatch,
  rejectFrom,
  restageReview,
  stageChapter,
  stagedFacts,
  章状态,
} from '../../src/staging/index.js'
import { persistDraftOutline, persistWorkContract } from '../../src/state-machine/persist.js'
import { CHAPTER_KNOWLEDGE_SNAPSHOT_PATH } from '../../src/knowledge/chapter.js'
import { reviewedDraftHash } from '../../src/review/outcome.js'
import { makeGitBook, minimalWorkContract, chapter } from '../state-machine/_helper.js'
import { writeReviewArtifacts } from '../staging/_helper.js'

async function stageReviewedChapter(ctx, chapterNum, body = `第 ${chapterNum} 章新正文。`) {
  const confirmed = await persistDraftOutline(ctx, {
    细纲: `# 第 ${chapterNum} 章细纲\n\n## 本章要写到的事\n完成第 ${chapterNum} 章任务。`,
  })
  assert.equal(confirmed.ok, true, confirmed.error)
  const prepared = await prepareChapterMaterials(ctx, { chapterNum })
  assert.equal(prepared.ok, true, prepared.error)
  const payload = {
    chapterNum,
    frontMatter: { 章号: chapterNum, 标题: `第${chapterNum}章新稿` },
    body,
    workspaceFiles: [],
  }
  await writeReviewArtifacts(ctx.repoPath, chapterNum, [], [], payload)
  const staged = await stageChapter(ctx, { chapterNum, payload })
  assert.equal(staged.ok, true, staged.error)
  return staged
}

async function writeContractRevision(root, effectiveChapter = 3) {
  const inputPath = path.join(root, '工作区', '契约修订.json')
  await fs.mkdir(path.dirname(inputPath), { recursive: true })
  await fs.writeFile(inputPath, JSON.stringify({
    作品契约: minimalWorkContract({ version: 2, effectiveChapter }),
    知识选择: [{ 维度: '题材', 名称: '玄幻', 来源: '作者自定义' }],
    证据: '下一未定稿章起调整契约。',
    影响范围: `第 ${effectiveChapter} 章及其后的未定稿工件。`,
    作者已确认: true,
  }), 'utf8')
  return inputPath
}

test('作者确认的契约更新独立提交，并使生效章后的未定稿工件失效', async () => {
  const oldContract = minimalWorkContract()
  const { ctx, root, git, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n',
    '作品契约/作品契约.md': oldContract,
    '作品契约/知识选择记录.md': '# 知识选择记录\n',
    '定稿/正文/0001-一.md': chapter(1),
    '定稿/正文/0002-二.md': chapter(2),
  })
  try {
    const stagedDir = path.join(root, '工作区', '待定稿', '0003-待改')
    await fs.mkdir(stagedDir, { recursive: true })
    await fs.writeFile(path.join(stagedDir, '草稿.md'), '暂存草稿。', 'utf8')
    await fs.writeFile(
      path.join(root, '工作区', '待定稿', '批次.json'),
      JSON.stringify({
        章列表: [{ 章号: 3, 标题: '待改', 状态: 章状态.待审收, 目录: '0003-待改' }],
      }),
      'utf8'
    )
    await fs.writeFile(path.join(root, '工作区', '草稿-A.md'), '当前草稿。', 'utf8')
    await fs.writeFile(path.join(root, '工作区', '本章写作材料.md'), '旧材料。', 'utf8')
    await fs.writeFile(path.join(root, '工作区', '审稿.md'), '旧审稿。', 'utf8')

    const payload = {
      作品契约: minimalWorkContract({ version: 2, effectiveChapter: 3 }),
      知识选择: [{ 维度: '题材', 名称: '玄幻', 来源: '作者自定义' }],
      证据: '第 1—2 章连续出现同一契约误解。',
      影响范围: '第 3 章及其后的未定稿细纲、材料与审稿。',
      作者已确认: true,
    }
    const inputPath = path.join(root, '工作区', '契约修订.json')
    await fs.writeFile(inputPath, JSON.stringify(payload), 'utf8')

    const before = (await git(['rev-list', '--count', 'HEAD'])).stdout.trim()
    const result = await persistContract([], { file: inputPath }, ctx)
    assert.equal(result.ok, true, result.error)
    assert.match(result.output, /v2/)
    assert.match(result.output, /第 3 章起生效/)
    assert.match(await fs.readFile(path.join(root, '作品契约', '作品契约.md'), 'utf8'), /契约版本: 2/)
    const selectionRecord = await fs.readFile(path.join(root, '作品契约', '知识选择记录.md'), 'utf8')
    assert.match(selectionRecord, /契约版本 2/)
    assert.match(selectionRecord, /修订证据：第 1—2 章连续出现同一契约误解/)
    assert.match(selectionRecord, /影响范围：第 3 章及其后的未定稿细纲、材料与审稿/)
    const after = (await git(['rev-list', '--count', 'HEAD'])).stdout.trim()
    assert.equal(Number(after), Number(before) + 1)
    assert.match((await git(['log', '-1', '--format=%s'])).stdout, /^fix\(契约\): v2/)

    const batch = await readBatch(root)
    assert.equal(batch.章列表[0].状态, 章状态.契约变更)
    const blocked = await finalizeBatch(ctx)
    assert.equal(blocked.ok, false)
    assert.match(blocked.error, /不能批量定稿/)
    const restageBlocked = await stageChapter(ctx, {
      chapterNum: 3,
      payload: { frontMatter: { 标题: '仍是旧稿' } },
    })
    assert.equal(restageBlocked.ok, false)
    assert.match(restageBlocked.error, /不能沿用旧工件暂存/)
    await fs.access(path.join(root, '工作区', '契约更新前-草稿-A.md'))
    await assert.rejects(() => fs.access(path.join(root, '工作区', '本章写作材料.md')))
    await assert.rejects(() => fs.access(path.join(root, '工作区', '审稿.md')))
    await fs.access(path.join(root, '工作区', '契约更新待重备料.md'))

    // 受影响批次章完成当前契约下的新备料与新审稿后才能重暂存；当前第 4 章守卫仍保留。
    const confirmed = await persistDraftOutline(ctx, { 细纲: '# 第 3 章细纲\n\n新细纲。' })
    assert.equal(confirmed.ok, true, confirmed.error)
    const freshPrep = await prepareChapterMaterials(ctx, { chapterNum: 3 })
    assert.equal(freshPrep.ok, true, freshPrep.error)
    const freshPayload = {
      chapterNum: 3,
      frontMatter: { 章号: 3, 标题: '重做第三章' },
      body: '新稿。',
      workspaceFiles: [],
    }
    await writeReviewArtifacts(root, 3, [], [], freshPayload)
    const freshStage = await stageChapter(ctx, { chapterNum: 3, payload: freshPayload })
    assert.equal(freshStage.ok, true, freshStage.error)
    const guard = JSON.parse(
      await fs.readFile(path.join(root, '工作区', '契约失效.json'), 'utf8')
    )
    assert.deepEqual(guard.受影响批次章, [])
    assert.deepEqual(guard.当前工作区章, [4])
    assert.equal(guard.待提交章.length, 1)
    assert.equal(guard.待提交章[0].章号, 3)
    assert.match(guard.待提交章[0].定稿包哈希, /^sha256:[0-9a-f]{64}$/)
    await fs.access(path.join(root, '工作区', '契约更新待重备料.md'))

    // 批次目录收口不能顺带删掉保护下一章的仓库级 guard。
    const finalized = await finalizeBatch(ctx)
    assert.equal(finalized.ok, true, finalized.error)
    await fs.access(path.join(root, '工作区', '契约失效.json'))
    const chapter4StillBlocked = await stageChapter(ctx, {
      chapterNum: 4,
      payload: { frontMatter: { 标题: '第四章旧稿' } },
    })
    assert.equal(chapter4StillBlocked.ok, false)
    assert.match(chapter4StillBlocked.error, /不能沿用旧工件暂存/)
  } finally {
    await cleanup()
  }
})

test('无 guard 的畸形契约 marker 令暂存、叠加、批量定稿和二次更新全部 fail closed', async () => {
  const { ctx, root, git, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n',
    '定稿/正文/0001-一.md': chapter(1),
    '定稿/正文/0002-二.md': chapter(2),
  })
  try {
    await stageReviewedChapter(ctx, 3, '第三章批内正文。')
    const guardPath = path.join(root, '工作区', '契约失效.json')
    await assert.rejects(() => fs.access(guardPath))
    await fs.writeFile(
      path.join(root, '工作区', '契约更新待重备料.md'),
      '# 契约更新待重备料\n\n生效章已损坏。\n',
      'utf8'
    )

    const overlay = await stagedFacts(root)
    assert.equal(overlay.exists, false)
    assert.deepEqual(overlay.chapters, [])
    assert.equal(overlay.factChanges.size, 0)
    assert.ok(overlay.warnings.some((warning) => /重备料标记损坏/.test(warning)))

    const staged = await stageChapter(ctx, {
      chapterNum: 3,
      payload: {
        chapterNum: 3,
        frontMatter: { 章号: 3, 标题: '不能覆盖' },
        body: '不能覆盖批内正文。',
      },
    })
    assert.equal(staged.ok, false)
    assert.match(staged.error, /契约失效记录损坏/)

    const before = Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim())
    const finalized = await finalizeBatch(ctx)
    assert.equal(finalized.ok, false)
    assert.match(finalized.error, /重备料标记损坏/)
    assert.equal(Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim()), before)

    const revision = await writeContractRevision(root)
    const updated = await persistContract([], { file: revision }, ctx)
    assert.equal(updated.ok, false)
    assert.match(updated.error, /重备料标记损坏/)
    assert.equal(Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim()), before)
    assert.match(
      await fs.readFile(path.join(root, '作品契约', '作品契约.md'), 'utf8'),
      /契约版本: 1/
    )
    assert.equal((await readBatch(root, { heal: false })).章列表.length, 1)
  } finally {
    await cleanup()
  }
})

test('只有批次章受影响时也持久化失效守卫，旧 payload 不能洗回待审收', async () => {
  const { ctx, root, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n',
    '定稿/正文/0001-一.md': chapter(1),
    '定稿/正文/0002-二.md': chapter(2),
  })
  try {
    const batchDir = path.join(root, '工作区', '待定稿', '0003-批内旧稿')
    await fs.mkdir(batchDir, { recursive: true })
    await fs.writeFile(path.join(batchDir, '草稿.md'), chapter(3, '旧稿。'), 'utf8')
    const batchPath = path.join(root, '工作区', '待定稿', '批次.json')
    const waitingBatch = JSON.stringify({
      章列表: [{ 章号: 3, 标题: '批内旧稿', 状态: 章状态.待审收, 目录: '0003-批内旧稿' }],
    })
    await fs.writeFile(batchPath, waitingBatch, 'utf8')
    const inputPath = path.join(root, '工作区', '契约修订.json')
    await fs.writeFile(inputPath, JSON.stringify({
      作品契约: minimalWorkContract({ version: 2, effectiveChapter: 3 }),
      知识选择: [{ 维度: '题材', 名称: '玄幻', 来源: '作者自定义' }],
      证据: '第三章起调整。',
      影响范围: '第 3 章及其后的批内工件。',
      作者已确认: true,
    }), 'utf8')

    const result = await persistContract([], { file: inputPath }, ctx)
    assert.equal(result.ok, true, result.error)
    await fs.access(path.join(root, '工作区', '契约失效.json'))
    await fs.access(path.join(root, '工作区', '契约更新待重备料.md'))

    const oldPayload = await stageChapter(ctx, {
      chapterNum: 3,
      payload: { frontMatter: { 标题: '批内旧稿' } },
    })
    assert.equal(oldPayload.ok, false)
    assert.match(oldPayload.error, /不能沿用旧工件暂存/)

    // 即使外部把状态强行洗回「待审收」，durable guard 仍须挡住 finalize-batch。
    await fs.writeFile(batchPath, waitingBatch, 'utf8')
    const finalize = await finalizeBatch(ctx)
    assert.equal(finalize.ok, false)
    assert.match(finalize.error, /尚未完成新备料与审查/)

    const markerPath = path.join(root, '工作区', '契约更新待重备料.md')
    const validMarker = await fs.readFile(markerPath, 'utf8')
    await fs.writeFile(markerPath, '# 契约更新待重备料\n\n生效章已损坏。\n', 'utf8')
    const corruptMarkerStage = await stageChapter(ctx, {
      chapterNum: 3,
      payload: { frontMatter: { 标题: '仍是旧稿' } },
    })
    assert.equal(corruptMarkerStage.ok, false)
    assert.match(corruptMarkerStage.error, /契约失效记录损坏/)
    const corruptMarkerFinalize = await finalizeBatch(ctx)
    assert.equal(corruptMarkerFinalize.ok, false)
    assert.match(corruptMarkerFinalize.error, /契约失效记录损坏/)
    const corruptMarkerOverlay = await stagedFacts(root)
    assert.equal(corruptMarkerOverlay.exists, false)
    assert.deepEqual(corruptMarkerOverlay.chapters, [])
    assert.ok(corruptMarkerOverlay.warnings.some((warning) => /契约失效记录损坏/.test(warning)))
    await fs.writeFile(markerPath, validMarker, 'utf8')

    for (const malformedGuard of [
      { 生效起章: 3 },
      { 契约版本: 2, 生效起章: 3, 受影响批次章: '3', 当前工作区章: [] },
      { 契约版本: 2, 生效起章: 3, 受影响批次章: [0], 当前工作区章: [] },
      {
        契约版本: 2,
        生效起章: 3,
        受影响批次章: [],
        当前工作区章: [],
        待提交章: [{
          章号: 3,
          契约版本: 2,
          批次目录: '0003-批内旧稿',
          定稿包哈希: 'sha256:BAD',
        }],
      },
    ]) {
      await fs.writeFile(
        path.join(root, '工作区', '契约失效.json'),
        JSON.stringify(malformedGuard),
        'utf8'
      )
      const corruptStage = await stageChapter(ctx, {
        chapterNum: 3,
        payload: { frontMatter: { 标题: '仍是旧稿' } },
      })
      assert.equal(corruptStage.ok, false)
      assert.match(corruptStage.error, /契约失效记录损坏/)
      const corruptFinalize = await finalizeBatch(ctx)
      assert.equal(corruptFinalize.ok, false)
      assert.match(corruptFinalize.error, /契约失效记录损坏/)
    }

    await fs.writeFile(
      path.join(root, '工作区', '契约失效.json'),
      JSON.stringify({
        契约版本: 2,
        生效起章: 3,
        受影响批次章: [],
        当前工作区章: [],
        待提交章: [],
      }),
      'utf8'
    )
    const markerFallbackStage = await stageChapter(ctx, {
      chapterNum: 3,
      payload: { frontMatter: { 标题: '仍是旧稿' } },
    })
    assert.equal(markerFallbackStage.ok, false)
    assert.match(markerFallbackStage.error, /备料/)
    const markerFallbackFinalize = await finalizeBatch(ctx)
    assert.equal(markerFallbackFinalize.ok, false)
    assert.match(markerFallbackFinalize.error, /重备料标记/)
  } finally {
    await cleanup()
  }
})

test('Git 已提交但随后报错时保留契约与失效状态，不回滚成可定稿旧批次', async () => {
  const { ctx, root, git, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n',
    '定稿/正文/0001-一.md': chapter(1),
    '定稿/正文/0002-二.md': chapter(2),
  })
  try {
    const nextContract = minimalWorkContract({ version: 2, effectiveChapter: 3 })
    const parsed = validateWorkContract(nextContract)
    const batchPath = path.join('工作区', '待定稿', '批次.json')
    const markerPath = path.join('工作区', '契约更新待重备料.md')
    const invalidatedBatch = JSON.stringify({
      章列表: [{ 章号: 3, 标题: '待改', 状态: 章状态.契约变更, 目录: '0003-待改' }],
    })
    const realGit = createGit(root)
    let rollbackCalled = false
    const beforeCommits = Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim())

    const result = await persistWorkContract(
      ctx,
      {
        book: { spec_version: '7.0', 书名: '测', 类型: '玄幻', 副题材: [], 流派: [] },
        作品契约: nextContract,
        contract: parsed.data,
        selections: [{ 维度: '题材', 名称: '玄幻', 来源: '作者自定义' }],
      },
      {
        git: {
          ...realGit,
          async commit(message) {
            await realGit.commit(message)
            throw new Error('提交后读取 hash 失败')
          },
        },
        additionalWrites: [
          { path: batchPath, content: invalidatedBatch },
          { path: markerPath, content: '# 契约更新待重备料\n' },
        ],
        rollbackAdditionalWrites: async () => {
          rollbackCalled = true
        },
      }
    )

    assert.equal(result.ok, true, result.error)
    assert.equal(rollbackCalled, false)
    assert.match(await fs.readFile(path.join(root, '作品契约', '作品契约.md'), 'utf8'), /契约版本: 2/)
    assert.equal(await fs.readFile(path.join(root, batchPath), 'utf8'), invalidatedBatch)
    await fs.access(path.join(root, markerPath))
    const afterCommits = Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim())
    assert.equal(afterCommits, beforeCommits + 1)
  } finally {
    await cleanup()
  }
})

test('契约从下一未定稿章立即生效，备料不删除标记，丢批只清批次守卫', async () => {
  const finalized1 = chapter(1, '第一章定稿。')
  const finalized2 = chapter(2, '第二章定稿。')
  const { ctx, root, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n',
    '定稿/正文/0001-一.md': finalized1,
    '定稿/正文/0002-二.md': finalized2,
  })
  try {
    const batchDir = path.join(root, '工作区', '待定稿', '0003-批内三')
    await fs.mkdir(batchDir, { recursive: true })
    await fs.writeFile(path.join(batchDir, '草稿.md'), chapter(3, '批内第三章。'), 'utf8')
    await fs.writeFile(path.join(batchDir, '定稿包.json'), '{}', 'utf8')
    await fs.writeFile(path.join(batchDir, '审稿单.md'), '# 第 3 章审稿单', 'utf8')
    await fs.writeFile(
      path.join(root, '工作区', '待定稿', '批次.json'),
      JSON.stringify({
        章列表: [{ 章号: 3, 标题: '批内三', 状态: 章状态.待审收, 目录: '0003-批内三' }],
      }),
      'utf8'
    )

    const oldConfirmed = await persistDraftOutline(ctx, { 细纲: '# 第 4 章细纲\n\n旧细纲。' })
    assert.equal(oldConfirmed.ok, true, oldConfirmed.error)
    await fs.access(path.join(root, CHAPTER_KNOWLEDGE_SNAPSHOT_PATH))
    await fs.writeFile(path.join(root, '工作区', '草稿-A.md'), chapter(4, '第四章旧草稿。'), 'utf8')
    await fs.writeFile(path.join(root, '工作区', '草稿-B.md'), chapter(5, '第五章旧草稿。'), 'utf8')
    const earlyDraft = chapter(3, '无关的早期草稿。')
    await fs.writeFile(path.join(root, '工作区', '草稿-早期.md'), earlyDraft, 'utf8')
    await fs.writeFile(
      path.join(root, '工作区', '本章写作材料.md'),
      '# 第 4 章写作材料\n\n旧材料。',
      'utf8'
    )
    await fs.writeFile(path.join(root, '工作区', '审稿.md'), '# 第 4 章审稿单\n\n旧审稿。', 'utf8')
    await fs.writeFile(
      path.join(root, '工作区', '审稿输入.json'),
      JSON.stringify({ 章号: 4, 草稿全文: '第四章旧草稿。', 作品契约: '旧契约上下文。' }),
      'utf8'
    )
    await fs.mkdir(path.join(root, '工作区', '评审报告'), { recursive: true })
    await fs.writeFile(
      path.join(root, '工作区', '评审报告', '审稿结果.json'),
      JSON.stringify({
        章号: 4,
        issues: [],
        草稿哈希: reviewedDraftHash('第四章新正文。'),
      }),
      'utf8'
    )

    const inputPath = path.join(root, '工作区', '契约修订.json')
    await fs.writeFile(inputPath, JSON.stringify({
      作品契约: minimalWorkContract({ version: 2, effectiveChapter: 3 }),
      知识选择: [{ 维度: '题材', 名称: '玄幻', 来源: '作者自定义' }],
      证据: '下一未定稿章起调整冲突结算方式。',
      影响范围: '第 3 章及其后的未定稿工件。',
      作者已确认: true,
    }), 'utf8')

    const result = await persistContract([], { file: inputPath }, ctx)
    assert.equal(result.ok, true, result.error)
    assert.match(result.output, /第 3 章起生效/)
    assert.match(result.output, /当前未定稿工件已标记为受影响/)

    const batch = await readBatch(root)
    assert.deepEqual(
      batch.章列表.map(({ 章号, 状态 }) => ({ 章号, 状态 })),
      [{ 章号: 3, 状态: 章状态.契约变更 }]
    )
    assert.equal(
      await fs.readFile(path.join(root, '工作区', '契约更新前-草稿-早期.md'), 'utf8'),
      earlyDraft
    )
    await fs.access(path.join(root, '工作区', '契约更新前-细纲.md'))
    await fs.access(path.join(root, '工作区', '契约更新前-草稿-A.md'))
    await fs.access(path.join(root, '工作区', '契约更新前-草稿-B.md'))
    await assert.rejects(() => fs.access(path.join(root, '工作区', '细纲.md')))
    await assert.rejects(() => fs.access(path.join(root, CHAPTER_KNOWLEDGE_SNAPSHOT_PATH)))
    await assert.rejects(() => fs.access(path.join(root, '工作区', '本章写作材料.md')))
    await assert.rejects(() => fs.access(path.join(root, '工作区', '审稿输入.json')))
    await assert.rejects(() => fs.access(path.join(root, '工作区', '审稿.md')))
    await assert.rejects(() => fs.access(path.join(root, '工作区', '评审报告')))
    assert.equal(await fs.readFile(path.join(root, '定稿', '正文', '0001-一.md'), 'utf8'), finalized1)
    assert.equal(await fs.readFile(path.join(root, '定稿', '正文', '0002-二.md'), 'utf8'), finalized2)

    const newConfirmed = await persistDraftOutline(ctx, {
      细纲: '# 第 3 章细纲\n\n第三章新细纲。',
    })
    assert.equal(newConfirmed.ok, true, newConfirmed.error)
    const earlyPrep = await prepareChapterMaterials(ctx, { chapterNum: 3 })
    assert.equal(earlyPrep.ok, true, earlyPrep.error)
    await fs.access(path.join(root, '工作区', '契约更新待重备料.md'))
    await fs.access(path.join(root, '工作区', '契约失效.json'))
    const oldChapter4 = await stageChapter(ctx, {
      chapterNum: 4,
      payload: { frontMatter: { 标题: '第四章旧稿' } },
    })
    assert.equal(oldChapter4.ok, false)
    assert.match(oldChapter4.error, /不能沿用旧工件暂存/)

    const freshChapter3Payload = {
      chapterNum: 3,
      frontMatter: { 章号: 3, 标题: '第三章新稿' },
      body: '第三章新正文。',
      workspaceFiles: [
        '工作区/.',
        '工作区/待定稿',
        '工作区/./契约失效.json',
        '工作区/./契约更新待重备料.md',
      ],
    }
    await writeReviewArtifacts(root, 3, [], [], freshChapter3Payload)
    const freshChapter3 = await stageChapter(ctx, {
      chapterNum: 3,
      payload: freshChapter3Payload,
    })
    assert.equal(freshChapter3.ok, true, freshChapter3.error)
    await assert.rejects(() => fs.access(path.join(root, '工作区', '审稿输入.json')))
    const chapter5Guard = JSON.parse(
      await fs.readFile(path.join(root, '工作区', '契约失效.json'), 'utf8')
    )
    assert.deepEqual(chapter5Guard.当前工作区章, [4, 5])
    assert.equal(chapter5Guard.待提交章[0].章号, 3)

    const discarded = await discardBatch(root)
    assert.equal(discarded.ok, true, discarded.error)
    const guardAfterDiscard = JSON.parse(
      await fs.readFile(path.join(root, '工作区', '契约失效.json'), 'utf8')
    )
    assert.deepEqual(guardAfterDiscard.受影响批次章, [])
    assert.deepEqual(guardAfterDiscard.当前工作区章, [4, 5])
    assert.deepEqual(guardAfterDiscard.待提交章, [])
    const oldChapter5 = await stageChapter(ctx, {
      chapterNum: 5,
      payload: { frontMatter: { 标题: '第五章旧稿' } },
    })
    assert.equal(oldChapter5.ok, false)
    assert.match(oldChapter5.error, /不能沿用旧工件暂存/)
  } finally {
    await cleanup()
  }
})

test('手动定稿拒绝契约更新前旧工件，提交后取 hash 失败仍只解除本章守卫', async () => {
  const { ctx, root, git, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n',
    '作品契约/作品契约.md': minimalWorkContract(),
    '作品契约/知识选择记录.md': '# 知识选择记录\n',
    '定稿/正文/0001-一.md': chapter(1),
    '定稿/正文/0002-二.md': chapter(2),
    '定稿/正文/0003-三.md': chapter(3),
  })
  try {
    await fs.mkdir(path.join(root, '工作区'), { recursive: true })
    await fs.writeFile(path.join(root, '工作区', '草稿-A.md'), chapter(4, '第四章旧稿。'), 'utf8')
    await fs.writeFile(path.join(root, '工作区', '草稿-B.md'), chapter(5, '第五章旧稿。'), 'utf8')
    const inputPath = path.join(root, '工作区', '契约修订.json')
    await fs.writeFile(inputPath, JSON.stringify({
      作品契约: minimalWorkContract({ version: 2, effectiveChapter: 4 }),
      知识选择: [{ 维度: '题材', 名称: '玄幻', 来源: '作者自定义' }],
      证据: '第四章起调整长期冲突规则。',
      影响范围: '第 4 章及其后的未定稿章节。',
      作者已确认: true,
    }), 'utf8')

    const updated = await persistContract([], { file: inputPath }, ctx)
    assert.equal(updated.ok, true, updated.error)
    const guardPath = path.join(root, '工作区', '契约失效.json')
    const markerPath = path.join(root, '工作区', '契约更新待重备料.md')
    const initialGuard = JSON.parse(await fs.readFile(guardPath, 'utf8'))
    assert.deepEqual(initialGuard.当前工作区章, [4, 5])

    const oldPayload = {
      chapterNum: 4,
      frontMatter: { 章号: 4, 标题: '第四章旧稿' },
      body: '仍沿用更新前工件。',
    }
    const before = Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim())
    const blocked = await finalizeChapter(ctx, oldPayload)
    assert.equal(blocked.ok, false)
    assert.match(blocked.error, /不能沿用旧工件定稿/)
    assert.equal(Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim()), before)
    await assert.rejects(() => fs.access(path.join(root, '定稿', '正文', '0004-第四章旧稿.md')))

    const confirmed = await persistDraftOutline(ctx, {
      细纲: '# 第 4 章细纲\n\n第四章新细纲。',
    })
    assert.equal(confirmed.ok, true, confirmed.error)
    const prepared = await prepareChapterMaterials(ctx, { chapterNum: 4 })
    assert.equal(prepared.ok, true, prepared.error)
    const freshChapter4Payload = {
      chapterNum: 4,
      frontMatter: { 章号: 4, 标题: '第四章新稿' },
      body: '采用更新后的契约完成第四章。',
      workspaceFiles: [
        '工作区/.',
        '工作区/待定稿',
        '工作区/./契约失效.json',
        '工作区/./契约更新待重备料.md',
        '细纲.md',
        '本章写作材料.md',
        '审稿.md',
        '评审报告',
      ],
    }
    await writeReviewArtifacts(root, 4, [], [], freshChapter4Payload)
    const batchSentinel = path.join(root, '工作区', '待定稿', '保留.txt')
    await fs.mkdir(path.dirname(batchSentinel), { recursive: true })
    await fs.writeFile(batchSentinel, '不能由定稿包清理。', 'utf8')
    await fs.writeFile(
      markerPath,
      '# 契约更新待重备料\n\n作品契约从第 4 章起更新，请逐章重做。\n',
      'utf8'
    )

    const realFinalizeGit = createGit(root)
    const finalized = await finalizeChapter(
      ctx,
      freshChapter4Payload,
      {
        git: {
          ...realFinalizeGit,
          async commit(message) {
            await realFinalizeGit.commit(message)
            throw new Error('提交后读取 hash 失败')
          },
        },
      }
    )
    assert.equal(finalized.ok, true, finalized.error)
    assert.equal(Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim()), before + 1)
    assert.ok(finalized.warnings.some((warning) => warning.includes('系统状态路径')))
    await fs.access(path.join(root, '定稿', '正文', '0004-第四章新稿.md'))
    await fs.access(batchSentinel)
    await fs.access(markerPath)
    const remainingGuard = JSON.parse(await fs.readFile(guardPath, 'utf8'))
    assert.deepEqual(remainingGuard.受影响批次章, [])
    assert.deepEqual(remainingGuard.当前工作区章, [5])

    const chapter5Before = Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim())
    const chapter5Blocked = await finalizeChapter(ctx, {
      chapterNum: 5,
      frontMatter: { 章号: 5, 标题: '第五章旧稿' },
      body: '第五章仍是旧稿。',
    })
    assert.equal(chapter5Blocked.ok, false)
    assert.match(chapter5Blocked.error, /不能沿用旧工件定稿/)
    assert.equal(Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim()), chapter5Before)
  } finally {
    await cleanup()
  }
})

test('契约与失效状态同批写入失败时全部保持原样', async () => {
  const oldContract = minimalWorkContract()
  const oldRecord = '# 知识选择记录\n\n旧记录。\n'
  const oldBook = 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n'
  const { ctx, root, git, cleanup } = await makeGitBook({
    'book.yaml': oldBook,
    '作品契约/作品契约.md': oldContract,
    '作品契约/知识选择记录.md': oldRecord,
    '定稿/正文/0001-一.md': chapter(1),
    '定稿/正文/0002-二.md': chapter(2),
  })
  try {
    const batchDir = path.join(root, '工作区', '待定稿', '0003-待改')
    await fs.mkdir(batchDir, { recursive: true })
    await fs.writeFile(path.join(batchDir, '草稿.md'), chapter(3), 'utf8')
    const batchPath = path.join(root, '工作区', '待定稿', '批次.json')
    await fs.mkdir(batchPath)
    await fs.writeFile(path.join(root, '工作区', '草稿-A.md'), chapter(4), 'utf8')

    const markerPath = path.join(root, '工作区', '契约更新待重备料.md')
    const inputPath = path.join(root, '工作区', '契约修订.json')
    await fs.writeFile(inputPath, JSON.stringify({
      作品契约: minimalWorkContract({ version: 2, effectiveChapter: 3 }),
      知识选择: [{ 维度: '题材', 名称: '玄幻', 来源: '作者自定义' }],
      证据: '第三章起需调整。',
      影响范围: '第 3 章及其后的未定稿工件。',
      作者已确认: true,
    }), 'utf8')
    const beforeCommits = (await git(['rev-list', '--count', 'HEAD'])).stdout.trim()

    const result = await persistContract([], { file: inputPath }, ctx)
    assert.equal(result.ok, false)
    assert.match(result.error, /目标路径是目录/)
    assert.equal(await fs.readFile(path.join(root, 'book.yaml'), 'utf8'), oldBook)
    assert.equal(await fs.readFile(path.join(root, '作品契约', '作品契约.md'), 'utf8'), oldContract)
    assert.equal(await fs.readFile(path.join(root, '作品契约', '知识选择记录.md'), 'utf8'), oldRecord)
    assert.equal((await fs.stat(batchPath)).isDirectory(), true)
    await assert.rejects(() => fs.access(markerPath))
    await assert.rejects(() => fs.access(path.join(root, '工作区', '契约失效.json')))
    assert.equal((await git(['rev-list', '--count', 'HEAD'])).stdout.trim(), beforeCommits)
    assert.deepEqual(
      (await readBatch(root, { heal: false })).章列表.map((row) => row.状态),
      [章状态.受影响]
    )
  } finally {
    await cleanup()
  }
})

test('契约更新不会静默接受未确认、倒退版本或影响已定稿章', async () => {
  const { ctx, root, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n',
    '定稿/正文/0001-一.md': chapter(1),
  })
  try {
    const inputPath = path.join(root, '工作区', '坏修订.json')
    await fs.mkdir(path.dirname(inputPath), { recursive: true })
    await fs.writeFile(
      inputPath,
      JSON.stringify({
        作品契约: minimalWorkContract({ version: 1, effectiveChapter: 1 }),
        知识选择: [{ 维度: '题材', 名称: '玄幻', 来源: '作者自定义' }],
        证据: '作者要求调整。',
        影响范围: '下一未定稿章。',
        作者已确认: false,
      }),
      'utf8'
    )
    const result = await persistContract([], { file: inputPath }, ctx)
    assert.equal(result.ok, false)
    assert.match(result.error, /作者确认/)
    assert.match(result.error, /严格递增/)
    assert.match(result.error, /第 2 章/)
    assert.doesNotMatch(await fs.readFile(path.join(root, '作品契约', '作品契约.md'), 'utf8'), /契约版本: 2/)
  } finally {
    await cleanup()
  }
})

test('契约更新无法确认下一未定稿章时阻断，不把缓存故障降级成第 1 章', async () => {
  const { ctx, root, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n',
    '定稿/正文/0001-一.md': chapter(1),
  })
  try {
    const inputPath = path.join(root, '工作区', '契约修订.json')
    await fs.mkdir(path.dirname(inputPath), { recursive: true })
    await fs.writeFile(inputPath, JSON.stringify({
      作品契约: minimalWorkContract({ version: 2, effectiveChapter: 2 }),
      知识选择: [{ 维度: '题材', 名称: '玄幻', 来源: '作者自定义' }],
      证据: '作者要求调整未来章节。',
      影响范围: '第 2 章起的未定稿内容。',
      作者已确认: true,
    }), 'utf8')
    ctx.cache = { async query() { throw new Error('cache unavailable') } }

    const result = await persistContract([], { file: inputPath }, ctx)
    assert.equal(result.ok, false)
    assert.match(result.error, /无法确认下一未定稿章/)
    assert.match(result.error, /缓存.*重建/)
    assert.doesNotMatch(
      await fs.readFile(path.join(root, '作品契约', '作品契约.md'), 'utf8'),
      /契约版本: 2/
    )
  } finally {
    await cleanup()
  }
})

test('rejectFrom 持久撤销 K..N 全部 proof，批次状态洗回也不泄漏下游正文', async () => {
  const { ctx, root, git, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n',
    '定稿/正文/0001-一.md': chapter(1),
    '定稿/正文/0002-二.md': chapter(2),
  })
  try {
    await stageReviewedChapter(ctx, 3, '第三章旧正文。')
    await stageReviewedChapter(ctx, 4, '第四章旧正文。')
    const revision = await writeContractRevision(root)
    const updated = await persistContract([], { file: revision }, ctx)
    assert.equal(updated.ok, true, updated.error)

    await stageReviewedChapter(ctx, 3, '第三章更新后正文。')
    await stageReviewedChapter(ctx, 4, '第四章更新后正文，不得在打回后泄漏。')
    const guardPath = path.join(root, '工作区', '契约失效.json')
    const readyGuard = JSON.parse(await fs.readFile(guardPath, 'utf8'))
    assert.deepEqual(readyGuard.待提交章.map((proof) => proof.章号), [3, 4])

    const readyBatch = await readBatch(root)
    const row4 = readyBatch.章列表.find((item) => item.章号 === 4)
    const payload4 = JSON.parse(await fs.readFile(
      path.join(root, '工作区', '待定稿', row4.目录, '定稿包.json'),
      'utf8'
    ))
    await writeReviewArtifacts(root, 4, [{
      severity: 'medium',
      category: 'pacing',
      location: '结尾',
      description: '更新后契约的兑现方式需要记录。',
      evidence: '第四章结尾。',
      fix_hint: '保留为契约问题记录。',
      blocking: false,
      contract_clause: '节奏与兑现参数',
    }], [], payload4)
    const proofBeforeRestage = readyGuard.待提交章.find((proof) => proof.章号 === 4)
    const restaged = await restageReview(root, 4)
    assert.equal(restaged.ok, true, restaged.error)
    const restagedGuard = JSON.parse(await fs.readFile(guardPath, 'utf8'))
    const proofAfterRestage = restagedGuard.待提交章.find((proof) => proof.章号 === 4)
    assert.notEqual(proofAfterRestage.定稿包哈希, proofBeforeRestage.定稿包哈希)

    const rejected = await rejectFrom(root, 3)
    assert.equal(rejected.ok, true, rejected.error)
    const rejectedGuard = JSON.parse(await fs.readFile(guardPath, 'utf8'))
    assert.deepEqual(rejectedGuard.待提交章, [])
    assert.deepEqual(rejectedGuard.受影响批次章, [3, 4])

    const batchPath = path.join(root, '工作区', '待定稿', '批次.json')
    const currentBatch = await readBatch(root)
    const washedRows = currentBatch.章列表.map((row) =>
      row.章号 === 4 ? { ...row, 状态: 章状态.待审收 } : row
    )
    for (const mode of ['delete', 'corrupt', 'wash']) {
      if (mode === 'delete') await fs.rm(batchPath, { force: true })
      else if (mode === 'corrupt') await fs.writeFile(batchPath, '{{{', 'utf8')
      else {
        await fs.writeFile(
          batchPath,
          JSON.stringify({ 起章: 3, 章列表: washedRows }, null, 2),
          'utf8'
        )
      }
      const overlay = await stagedFacts(root)
      assert.deepEqual(overlay.chapters.map((item) => item.章号), [], mode)
      assert.equal(overlay.factChanges.size, 0, mode)
    }

    const before = Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim())
    const finalized = await finalizeBatch(ctx)
    assert.equal(finalized.ok, false)
    assert.equal(Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim()), before)
  } finally {
    await cleanup()
  }
})

test('作品契约更新持锁时，stage/finalize/确认细纲/备料不能交错写入旧契约工件', async () => {
  const { ctx, root, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n',
    '定稿/正文/0001-一.md': chapter(1),
    '定稿/正文/0002-二.md': chapter(2),
  })
  let releaseUpdate
  try {
    const revision = await writeContractRevision(root)
    const realQuery = ctx.cache.query.bind(ctx.cache)
    let enteredResolve
    const entered = new Promise((resolve) => { enteredResolve = resolve })
    const held = new Promise((resolve) => { releaseUpdate = resolve })
    let firstQuery = true
    ctx.cache.query = async (...args) => {
      if (firstQuery) {
        firstQuery = false
        enteredResolve()
        await held
      }
      return realQuery(...args)
    }

    const updating = persistContract([], { file: revision }, ctx)
    await entered
    let blocked
    try {
      blocked = await Promise.all([
        stageChapter(ctx, {
          chapterNum: 3,
          payload: { chapterNum: 3, frontMatter: { 章号: 3, 标题: '竞态旧稿' } },
        }),
        finalizeChapter(ctx, {
          chapterNum: 3,
          frontMatter: { 章号: 3, 标题: '竞态旧稿' },
          body: '不能入档。',
        }),
        persistDraftOutline(ctx, { 细纲: '# 第 3 章细纲\n\n竞态旧细纲。' }),
        prepareChapterMaterials(ctx, { chapterNum: 3 }),
        rejectFrom(root, 3),
        restageReview(root, 3),
        discardBatch(root),
        finalizeBatch(ctx),
      ])
    } finally {
      releaseUpdate()
      releaseUpdate = null
    }
    for (const result of blocked) {
      assert.equal(result.ok, false)
      assert.match(result.error, /不能并发执行/)
    }
    const updated = await updating
    assert.equal(updated.ok, true, updated.error)
    assert.equal((await readBatch(root, { heal: false })).exists, false)
    await assert.rejects(() => fs.access(path.join(root, '工作区', '细纲.md')))
    await assert.rejects(() => fs.access(path.join(root, '工作区', '本章写作材料.md')))
    await assert.rejects(() => fs.access(path.join(root, '定稿', '正文', '0003-竞态旧稿.md')))
    await assert.rejects(() => fs.access(path.join(root, '工作区', '契约更新处理中.lock')))
  } finally {
    if (releaseUpdate) releaseUpdate()
    await cleanup()
  }
})

test('persistWorkContract 不把同消息的无关 commit 当成本次契约提交', async () => {
  const { ctx, root, git, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n',
  })
  try {
    const nextContract = minimalWorkContract({ version: 2, effectiveChapter: 1 })
    const parsed = validateWorkContract(nextContract)
    assert.equal(parsed.ok, true, parsed.errors?.join('；'))
    const realGit = createGit(root)
    let rollbackCalled = false
    const result = await persistWorkContract(
      ctx,
      {
        book: { spec_version: '7.0', 书名: '测', 类型: '玄幻', 副题材: [], 流派: [] },
        作品契约: nextContract,
        contract: parsed.data,
        selections: [{ 维度: '题材', 名称: '玄幻', 来源: '作者自定义' }],
      },
      {
        git: {
          ...realGit,
          async commit(message) {
            await git(['reset', '--quiet'])
            await git(['commit', '--allow-empty', '-q', '-m', message])
            throw new Error('本次契约提交失败，但仓库出现无关提交')
          },
        },
        additionalWrites: [
          { path: path.join('工作区', '契约失效.json'), content: '保留失效状态' },
        ],
        rollbackAdditionalWrites: async () => { rollbackCalled = true },
      }
    )
    assert.equal(result.ok, false)
    assert.match(result.error, /提交结果无法确认/)
    assert.equal(rollbackCalled, false)
    assert.equal(
      await fs.readFile(path.join(root, '工作区', '契约失效.json'), 'utf8'),
      '保留失效状态'
    )
    assert.match(await fs.readFile(path.join(root, '作品契约', '作品契约.md'), 'utf8'), /契约版本: 2/)
  } finally {
    await cleanup()
  }
})

test('finalize 不把同 parent/tree/subject 但不同完整 message 的 commit 当成本章提交', async () => {
  const { ctx, root, git, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n',
    '定稿/正文/0001-一.md': chapter(1),
    '定稿/正文/0002-二.md': chapter(2),
  })
  try {
    await stageReviewedChapter(ctx, 3, '第三章旧正文。')
    const revision = await writeContractRevision(root)
    const updated = await persistContract([], { file: revision }, ctx)
    assert.equal(updated.ok, true, updated.error)
    await stageReviewedChapter(ctx, 3, '第三章更新后正文。')

    const secondRevision = path.join(root, '工作区', '契约二次修订.json')
    await fs.writeFile(secondRevision, JSON.stringify({
      作品契约: minimalWorkContract({ version: 3, effectiveChapter: 3 }),
      知识选择: [{ 维度: '题材', 名称: '玄幻', 来源: '作者自定义' }],
      证据: '再次调整契约。',
      影响范围: '第 3 章及其后的未定稿工件。',
      作者已确认: true,
    }), 'utf8')
    const secondUpdate = await persistContract([], { file: secondRevision }, ctx)
    assert.equal(secondUpdate.ok, false)
    assert.match(secondUpdate.error, /尚未收口|待提交|失效守卫/)
    assert.match(
      await fs.readFile(path.join(root, '作品契约', '作品契约.md'), 'utf8'),
      /契约版本: 2/
    )

    const batch = await readBatch(root)
    const row = batch.章列表.find((item) => item.章号 === 3)
    const packagePath = path.join(root, '工作区', '待定稿', row.目录, '定稿包.json')
    const payload = JSON.parse(await fs.readFile(packagePath, 'utf8'))
    const guardPath = path.join(root, '工作区', '契约失效.json')
    const guard = JSON.parse(await fs.readFile(guardPath, 'utf8'))
    const proof = guard.待提交章.find((item) => item.章号 === 3)
    const realGit = createGit(root)
    const before = Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim())

    const result = await finalizeChapter(ctx, payload, {
      archiveOutline: false,
      fromBatch: true,
      contractCommitProof: proof,
      git: {
        ...realGit,
        async commit(message) {
          const subject = String(message).split(/\r?\n/, 1)[0]
          await realGit.commit(`${subject}\n\n不是本次定稿要求的提交正文`)
          throw new Error('出现相同标题的另一份提交')
        },
      },
    })
    assert.equal(result.ok, false)
    assert.match(result.error, /提交结果无法确认/)
    assert.equal(Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim()), before + 1)
    const retainedGuard = JSON.parse(await fs.readFile(guardPath, 'utf8'))
    assert.deepEqual(retainedGuard.待提交章, [proof])
    await fs.access(path.join(root, '工作区', '契约更新待重备料.md'))
    await fs.access(packagePath)
  } finally {
    await cleanup()
  }
})

test('待提交定稿包被替换后整批零 commit，并保留 guard/marker/原包现场', async () => {
  const { ctx, root, git, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n',
    '定稿/正文/0001-一.md': chapter(1),
    '定稿/正文/0002-二.md': chapter(2),
  })
  try {
    await stageReviewedChapter(ctx, 3, '第三章旧正文。')
    const revision = await writeContractRevision(root)
    const updated = await persistContract([], { file: revision }, ctx)
    assert.equal(updated.ok, true, updated.error)
    await stageReviewedChapter(ctx, 3, '第三章更新后正文。')

    const batch = await readBatch(root)
    const row = batch.章列表.find((item) => item.章号 === 3)
    const packagePath = path.join(root, '工作区', '待定稿', row.目录, '定稿包.json')
    const tampered = JSON.parse(await fs.readFile(packagePath, 'utf8'))
    tampered.body = '替换后的恶意正文。'
    await fs.writeFile(packagePath, JSON.stringify(tampered, null, 2), 'utf8')
    const guardPath = path.join(root, '工作区', '契约失效.json')
    const markerPath = path.join(root, '工作区', '契约更新待重备料.md')
    const guardBefore = await fs.readFile(guardPath, 'utf8')
    const before = Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim())

    const result = await finalizeBatch(ctx)
    assert.equal(result.ok, false)
    assert.match(result.error, /待提交证据失效|定稿包已变化/)
    assert.equal(Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim()), before)
    assert.equal(await fs.readFile(guardPath, 'utf8'), guardBefore)
    await fs.access(markerPath)
    assert.match(await fs.readFile(packagePath, 'utf8'), /替换后的恶意正文/)
    assert.equal((await readBatch(root)).章列表.length, 1)
  } finally {
    await cleanup()
  }
})

test('新鲜审稿 sidecar 不能授权另一份旧正文，stage 与手动 finalize 均零写入', async () => {
  const { ctx, root, git, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n',
    '定稿/正文/0001-一.md': chapter(1),
    '定稿/正文/0002-二.md': chapter(2),
  })
  try {
    const confirmed = await persistDraftOutline(ctx, {
      细纲: '# 第 3 章细纲\n\n## 本章要写到的事\n完成第三章任务。',
    })
    assert.equal(confirmed.ok, true, confirmed.error)
    const reviewedPayload = {
      chapterNum: 3,
      frontMatter: { 章号: 3, 标题: '第三章' },
      body: '刚刚完成两审的新正文。',
      workspaceFiles: [],
    }
    const oldPayload = { ...reviewedPayload, body: '另一份未经两审的旧正文。' }
    await writeReviewArtifacts(root, 3, [], [], reviewedPayload)

    const staged = await stageChapter(ctx, { chapterNum: 3, payload: oldPayload })
    assert.equal(staged.ok, false)
    assert.match(staged.error, /当前审稿输入与这份正文不一致/)
    assert.equal((await readBatch(root, { heal: false })).exists, false)

    const payloadPath = path.join(root, '工作区', '旧定稿包.json')
    await fs.writeFile(payloadPath, JSON.stringify(oldPayload), 'utf8')
    const before = Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim())
    const finalized = await finalizeCommand(['3'], { payload: payloadPath }, ctx)
    assert.equal(finalized.ok, false)
    assert.match(finalized.error, /当前审稿输入与这份正文不一致/)
    assert.equal(Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim()), before)
    await assert.rejects(() => fs.access(path.join(root, '定稿', '正文', '0003-第三章.md')))
  } finally {
    await cleanup()
  }
})

test('逆序完成较晚章只释放本章，较早章 guard 与 marker 继续保留', async () => {
  const { ctx, root, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n',
    '定稿/正文/0001-一.md': chapter(1),
    '定稿/正文/0002-二.md': chapter(2),
    '定稿/正文/0003-三.md': chapter(3),
    '工作区/草稿-A.md': chapter(4, '第四章旧正文。'),
    '工作区/草稿-B.md': chapter(5, '第五章旧正文。'),
  })
  try {
    const revision = await writeContractRevision(root, 4)
    const updated = await persistContract([], { file: revision }, ctx)
    assert.equal(updated.ok, true, updated.error)

    const confirmed = await persistDraftOutline(ctx, {
      细纲: '# 第 5 章细纲\n\n## 本章要写到的事\n先完成第五章。',
    })
    assert.equal(confirmed.ok, true, confirmed.error)
    const prepared = await prepareChapterMaterials(ctx, { chapterNum: 5 })
    assert.equal(prepared.ok, true, prepared.error)
    const payload5 = {
      chapterNum: 5,
      frontMatter: { 章号: 5, 标题: '第五章新稿' },
      body: '第五章采用更新后契约完成。',
      workspaceFiles: [],
    }
    await writeReviewArtifacts(root, 5, [], [], payload5)
    const finalized5 = await finalizeChapter(ctx, payload5)
    assert.equal(finalized5.ok, true, finalized5.error)

    const guardPath = path.join(root, '工作区', '契约失效.json')
    const remainingGuard = JSON.parse(await fs.readFile(guardPath, 'utf8'))
    assert.deepEqual(remainingGuard.当前工作区章, [4])
    assert.deepEqual(remainingGuard.待提交章, [])
    await fs.access(path.join(root, '工作区', '契约更新待重备料.md'))

    const blocked4 = await finalizeChapter(ctx, {
      chapterNum: 4,
      frontMatter: { 章号: 4, 标题: '第四章旧稿' },
      body: '第四章仍沿用旧契约。',
    })
    assert.equal(blocked4.ok, false)
    assert.match(blocked4.error, /不能沿用旧工件定稿/)
    await assert.rejects(() => fs.access(path.join(root, '定稿', '正文', '0004-第四章旧稿.md')))
  } finally {
    await cleanup()
  }
})
