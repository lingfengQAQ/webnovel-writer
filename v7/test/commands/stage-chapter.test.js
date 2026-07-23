import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { run as stageChapterCmd } from '../../src/commands/stage-chapter.js'
import { run as batchStatusCmd } from '../../src/commands/batch-status.js'
import { repoCtx } from './_helper.js'
import { writeReviewArtifacts } from '../staging/_helper.js'

const 定稿章 = (num) =>
  `---\n章号: ${num}\n标题: 第${num}章\n卷: 1\n书内时间: 春月初${num}\n字数: 100\n章定位: 推进\n钩子: 危机钩-强\n情绪定位: 铺垫\n---\n\n第${num}章正文。`

const files = {
  'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n每章目标字数: 3000\n卷规模: 40\n连写批次大小: 3\n',
  '定稿/正文/0001-第1章.md': 定稿章(1),
  '定稿/正文/0002-第2章.md': 定稿章(2),
  '大纲/卷纲/第01卷.md': '# 第01卷\n后三章追查黑影。\n',
}

test('stage-chapter 命令：--payload 文件暂存 + 人话输出；batch-status 出全貌', async () => {
  const { ctx, cleanup } = await repoCtx(null, files)
  try {
    const payload = {
      frontMatter: {
        章号: 3,
        标题: '追影',
        卷: 1,
        书内时间: '春月初三',
        字数: 100,
        章定位: '推进',
        钩子: '危机钩-强',
        情绪定位: '铺垫',
        伏笔: ['推进 伏笔-001'],
      },
      body: '林晚追到后山。',
      workspaceFiles: ['工作区/细纲.md'],
    }
    const reviewIssues = [
      { severity: 'low', category: 'pacing', description: '节奏略慢', blocking: false },
      { severity: 'medium', category: 'structure', description: '转场略硬', blocking: false },
    ]
    await writeReviewArtifacts(ctx.repoPath, 3, reviewIssues, [], payload)
    const payloadPath = path.join(ctx.repoPath, '定稿包-3.json')
    await fs.writeFile(payloadPath, JSON.stringify(payload), 'utf8')

    const r = await stageChapterCmd(['3'], { payload: payloadPath }, ctx)
    assert.equal(r.ok, true, r.error)
    assert.match(r.output, /第 3 章已暂存/)
    assert.match(r.output, /未入档/)
    assert.match(r.output, /可继续写批内下一章/)

    const s = await batchStatusCmd([], {}, ctx)
    assert.equal(s.ok, true, s.error)
    assert.match(s.output, /第 3-3 章，共 1 章/)
    assert.match(s.output, /待审收/)
    assert.match(s.output, /审稿：2 个问题（0 阻断）/)
    assert.match(s.output, /停止条件未命中/)

    const j = await batchStatusCmd([], { json: true }, ctx)
    const data = JSON.parse(j.output)
    assert.equal(data.章[0].章号, 3)
    assert.equal(data.停止.stop, false)
  } finally {
    await cleanup()
  }
})

test('stage-chapter 无细纲时拒绝旧两段式知识选择，且不创建批次', async () => {
  const { ctx, cleanup } = await repoCtx(null, files)
  try {
    const payloadPath = path.join(ctx.repoPath, '定稿包-旧知识格式.json')
    const payload = {
      frontMatter: {
        章号: 3,
        标题: '追影',
        卷: 1,
        书内时间: '春月初三',
        字数: 100,
        章定位: '推进',
        钩子: '危机钩-强',
        情绪定位: '铺垫',
        知识选择: ['场景｜旧两段式'],
      },
      body: '林晚追到后山。',
      workspaceFiles: [],
    }
    await writeReviewArtifacts(ctx.repoPath, 3, [], [], payload)
    await fs.writeFile(payloadPath, JSON.stringify(payload), 'utf8')

    const result = await stageChapterCmd(['3'], { payload: payloadPath }, ctx)
    assert.equal(result.ok, false)
    assert.match(result.error, /章档案知识选择格式不正确/)
    await assert.rejects(() => fs.access(path.join(ctx.repoPath, '工作区', '待定稿', '批次.json')))
  } finally {
    await cleanup()
  }
})

test('stage-chapter 命令：章号不是数字 / 缺 payload / 无批次 status 友好错', async () => {
  const { ctx, cleanup } = await repoCtx(null, files)
  try {
    assert.equal((await stageChapterCmd(['abc'], {}, ctx)).ok, false)
    const noPayload = await stageChapterCmd(['3'], {}, ctx)
    assert.equal(noPayload.ok, false)
    assert.match(noPayload.error, /--payload/)
    const st = await batchStatusCmd([], {}, ctx)
    assert.equal(st.ok, false)
    assert.match(st.error, /没有进行中的待定稿批次/)
  } finally {
    await cleanup()
  }
})
