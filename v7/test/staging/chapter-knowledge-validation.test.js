import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { createGit } from '../../src/finalize/git.js'
import { finalizeBatch, readBatch, stageChapter } from '../../src/staging/index.js'
import { persistDraftOutline } from '../../src/state-machine/persist.js'
import { gitBookCtx } from '../commands/_helper.js'
import { writeReviewArtifacts } from './_helper.js'

function payload() {
  return {
    frontMatter: {
      章号: 3,
      标题: '追影',
      卷: 1,
      书内时间: '春月初三',
      字数: 100,
      章定位: '推进',
      钩子: '危机钩-强',
      情绪定位: '铺垫',
    },
    body: '林晚追到后山。',
    workspaceFiles: [],
  }
}

test('finalize-batch 重验暂存章档案，拒绝被篡改的旧两段式且零提交', async () => {
  const { ctx, cleanup } = await gitBookCtx()
  try {
    const confirmed = await persistDraftOutline(ctx, {
      细纲: '# 第 3 章细纲\n\n本章场景：拍卖会',
    })
    assert.equal(confirmed.ok, true, confirmed.error)
    await writeReviewArtifacts(ctx.repoPath, 3, [], [], payload())
    const staged = await stageChapter(ctx, { chapterNum: 3, payload: payload() })
    assert.equal(staged.ok, true, staged.error)

    const batch = await readBatch(ctx.repoPath)
    const dir = batch.章列表.find((chapter) => chapter.章号 === 3).目录
    const packagePath = path.join(ctx.repoPath, '工作区', '待定稿', dir, '定稿包.json')
    const packageData = JSON.parse(await fs.readFile(packagePath, 'utf8'))
    packageData.frontMatter.知识选择 = ['场景｜旧两段式']
    await fs.writeFile(packagePath, JSON.stringify(packageData, null, 2), 'utf8')

    const git = createGit(ctx.repoPath)
    const before = await git.revCount()
    const result = await finalizeBatch(ctx)
    assert.equal(result.ok, false)
    assert.match(result.error, /章档案知识选择格式不正确/)
    assert.equal(await git.revCount(), before)
    await assert.rejects(() => fs.access(path.join(ctx.repoPath, '定稿', '正文', '0003-追影.md')))
    assert.equal((await readBatch(ctx.repoPath)).章列表.length, 1)
  } finally {
    await cleanup()
  }
})
