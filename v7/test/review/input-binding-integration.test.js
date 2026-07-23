import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { run as persistContract } from '../../src/commands/persist-contract.js'
import { run as reviewInput } from '../../src/commands/review-input.js'
import { run as saveReview } from '../../src/commands/save-review.js'
import { prepareChapterMaterials } from '../../src/prep/index.js'
import { stageChapter } from '../../src/staging/index.js'
import { persistDraftOutline } from '../../src/state-machine/persist.js'
import {
  chapter,
  makeGitBook,
  minimalWorkContract,
} from '../state-machine/_helper.js'

const BOOK = 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n'

test('旧 v1 两审不能在 v2 契约下以相同正文回流，save-review 与 stage 均零写入', async () => {
  const draft = chapter(3, '正文保持完全相同。')
  const payload = {
    chapterNum: 3,
    frontMatter: chapterFrontMatter(3),
    body: '正文保持完全相同。',
    workspaceFiles: [],
  }
  const { ctx, root, cleanup } = await makeGitBook({
    'book.yaml': BOOK,
    '定稿/正文/0001-一.md': chapter(1),
    '定稿/正文/0002-二.md': chapter(2),
    '工作区/细纲.md': '# 第 3 章细纲\n\n## 本章要写到的事\n按旧契约推进。',
    '工作区/草稿-A.md': draft,
  })
  const externalFiles = []
  try {
    const issuedV1 = await issueReviewInput(ctx, root, 3)
    const oldReviewPath = await writeExternalJson(reviewEnvelope(issuedV1))
    externalFiles.push(oldReviewPath)

    const revisionPath = path.join(root, '工作区', '契约修订.json')
    await fs.writeFile(revisionPath, JSON.stringify({
      作品契约: minimalWorkContract({ version: 2, effectiveChapter: 3 }),
      知识选择: [{ 维度: '题材', 名称: '玄幻', 来源: '作者自定义' }],
      证据: '第三章起按新约束推进。',
      影响范围: '第 3 章及后续未定稿工件。',
      作者已确认: true,
    }), 'utf8')
    const updated = await persistContract([], { file: revisionPath }, ctx)
    assert.equal(updated.ok, true, updated.error)

    const outlined = await persistDraftOutline(ctx, {
      细纲: '# 第 3 章细纲\n\n## 本章要写到的事\n按新契约推进。',
    })
    assert.equal(outlined.ok, true, outlined.error)
    const prepared = await prepareChapterMaterials(ctx, { chapterNum: 3 })
    assert.equal(prepared.ok, true, prepared.error)
    await fs.writeFile(path.join(root, '工作区', '草稿-A.md'), draft, 'utf8')
    const issuedV2 = await issueReviewInput(ctx, root, 3)
    assert.equal(issuedV2.作品契约版本, 2)
    assert.notEqual(issuedV2.审稿输入令牌, issuedV1.审稿输入令牌)

    const saved = await saveReview(['3'], { file: oldReviewPath }, ctx)
    assert.equal(saved.ok, false)
    assert.match(saved.error, /令牌|当前审稿输入|重新审查/)
    await assertReviewOutputsMissing(root)

    const staged = await stageChapter(ctx, { chapterNum: 3, payload })
    assert.equal(staged.ok, false)
    assert.match(staged.error, /审稿|契约更新后的新材料/)
    await assert.rejects(() => fs.access(path.join(root, '工作区', '待定稿', '批次.json')))
  } finally {
    await cleanup()
    await Promise.all(externalFiles.map((file) => fs.rm(file, { force: true })))
  }
})

test('同版本细纲变化后，旧 sidecar 与旧两审不能保存', async () => {
  const { ctx, root, cleanup } = await makeGitBook({
    'book.yaml': BOOK,
    '定稿/正文/0001-一.md': chapter(1),
    '工作区/细纲.md': '# 第 2 章细纲\n\n## 本章要写到的事\n先查旧线索。',
    '工作区/草稿-A.md': chapter(2, '正文没有变化。'),
  })
  let reviewPath = ''
  try {
    const issued = await issueReviewInput(ctx, root, 2)
    reviewPath = await writeExternalJson(reviewEnvelope(issued))
    const changed = await persistDraftOutline(ctx, {
      细纲: '# 第 2 章细纲\n\n## 本章要写到的事\n改查另一条线索。',
    })
    assert.equal(changed.ok, true, changed.error)

    const saved = await saveReview(['2'], { file: reviewPath }, ctx)
    assert.equal(saved.ok, false)
    assert.match(saved.error, /审稿上下文|重新审查/)
    await assertReviewOutputsMissing(root)
  } finally {
    await cleanup()
    if (reviewPath) await fs.rm(reviewPath, { force: true })
  }
})

test('同版本批内上下文变化后，旧两审拒绝且既有批次字节不变', async () => {
  const { ctx, root, cleanup } = await makeGitBook({
    'book.yaml': BOOK,
    '定稿/正文/0001-一.md': chapter(1),
    '定稿/正文/0002-二.md': chapter(2),
    '工作区/细纲.md': '# 第 4 章细纲\n\n## 本章要写到的事\n承接前章。',
    '工作区/草稿-A.md': chapter(4, '第四章正文。'),
  })
  let reviewPath = ''
  try {
    const issued = await issueReviewInput(ctx, root, 4)
    reviewPath = await writeExternalJson(reviewEnvelope(issued))

    const batchRoot = path.join(root, '工作区', '待定稿')
    const chapterDir = path.join(batchRoot, '0003-前章')
    await fs.mkdir(chapterDir, { recursive: true })
    await Promise.all([
      fs.writeFile(path.join(chapterDir, '草稿.md'), chapter(3, '新增的批内前章。'), 'utf8'),
      fs.writeFile(path.join(chapterDir, '定稿包.json'), JSON.stringify({
        chapterNum: 3,
        frontMatter: chapterFrontMatter(3),
        body: '新增的批内前章。',
      }), 'utf8'),
      fs.writeFile(path.join(chapterDir, '审稿单.md'), '# 第 3 章审稿单\n', 'utf8'),
      fs.writeFile(path.join(batchRoot, '批次.json'), JSON.stringify({
        章列表: [{ 章号: 3, 标题: '前章', 状态: '待审收', 目录: '0003-前章' }],
      }, null, 2), 'utf8'),
    ])
    const metaPath = path.join(batchRoot, '批次.json')
    const before = await fs.readFile(metaPath)

    const saved = await saveReview(['4'], { file: reviewPath }, ctx)
    assert.equal(saved.ok, false)
    assert.match(saved.error, /审稿上下文|重新审查/)
    assert.deepEqual(await fs.readFile(metaPath), before)
    await assertReviewOutputsMissing(root)
  } finally {
    await cleanup()
    if (reviewPath) await fs.rm(reviewPath, { force: true })
  }
})

async function issueReviewInput(ctx, root, chapterNum) {
  const issued = await reviewInput([String(chapterNum)], {}, ctx)
  assert.equal(issued.ok, true, issued.error)
  return JSON.parse(await fs.readFile(path.join(root, '工作区', '审稿输入.json'), 'utf8'))
}

function reviewEnvelope(input) {
  const token = input.审稿输入令牌
  return {
    审稿输入令牌: token,
    事实审查: { 审稿输入令牌: token, chapter: input.章号, issues: [] },
    编辑审: { 审稿输入令牌: token, chapter: input.章号, issues: [] },
  }
}

async function writeExternalJson(value) {
  const file = path.join(
    os.tmpdir(),
    `wnw-review-binding-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  )
  await fs.writeFile(file, JSON.stringify(value), 'utf8')
  return file
}

function chapterFrontMatter(chapterNum) {
  return {
    章号: chapterNum,
    标题: `第${chapterNum}章`,
    卷: 1,
    字数: 100,
    章定位: '推进',
    钩子: '危机钩-强',
    情绪定位: '铺垫',
  }
}

async function assertReviewOutputsMissing(root) {
  await assert.rejects(() => fs.access(path.join(root, '工作区', '审稿.md')))
  await assert.rejects(() => fs.access(path.join(root, '工作区', '评审报告')))
}
