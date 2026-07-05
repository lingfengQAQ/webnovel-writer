import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { determineNextState } from '../../src/state-machine/index.js'
import { stageChapter, rejectFrom } from '../../src/staging/index.js'
import { gitBookCtx } from '../commands/_helper.js'

// 开关矩阵（PRD #14）：自动确认细纲 × 连写。全关=既有回归（router.test.js 全量）；
// 本文件测：单开细纲自动确认的序 6 标志、批次进行中的序 3 明细。全开端到端见 finalize-batch.test.js AC1。

async function reachOutline(ctx) {
  // sample-book 工作区自带细纲 → 会命中序 3，清掉以到达序 6
  await fs.rm(path.join(ctx.repoPath, '工作区', '细纲.md'), { force: true })
}

async function setBookYaml(ctx, key, value) {
  const p = path.join(ctx.repoPath, 'book.yaml')
  const src = await fs.readFile(p, 'utf8')
  const line = `${key}: ${value}`
  const re = new RegExp(`^${key}:.*$`, 'm')
  await fs.writeFile(p, re.test(src) ? src.replace(re, line) : `${src}${line}\n`, 'utf8')
}

async function stage3(ctx) {
  await fs.mkdir(path.join(ctx.repoPath, '工作区'), { recursive: true })
  await fs.writeFile(
    path.join(ctx.repoPath, '工作区', '审稿.md'),
    '# 第 3 章审稿单\n\n> 完整两审模式。\n> 共 0 个问题：0 阻断。\n',
    'utf8'
  )
  const r = await stageChapter(ctx, {
    chapterNum: 3,
    payload: {
      frontMatter: {
        章号: 3,
        标题: '连写3',
        卷: 1,
        书内时间: '夏月初三',
        字数: 100,
        章定位: '推进',
        钩子: '危机钩-强',
        情绪定位: '铺垫',
        伏笔: ['推进 伏笔-001'],
      },
      body: '第3章正文。',
      workspaceFiles: [],
    },
  })
  assert.equal(r.ok, true, r.error)
}

test('开关矩阵：全关 → 序 6 dto.自动确认细纲=false，行为与既有一致', async () => {
  const { ctx, cleanup } = await gitBookCtx()
  try {
    await reachOutline(ctx)
    const r = await determineNextState(ctx)
    assert.equal(r.序, 6, JSON.stringify(r))
    assert.equal(r.dto.自动确认细纲, false)
    assert.match(r.dto.期望产物, /作者确认/)
  } finally {
    await cleanup()
  }
})

test('开关矩阵：自动确认细纲开 → 序 6 dto 标志与提案直接生效指引', async () => {
  const { ctx, cleanup } = await gitBookCtx()
  try {
    await reachOutline(ctx)
    await setBookYaml(ctx, '自动确认细纲', 'true')
    const r = await determineNextState(ctx)
    assert.equal(r.序, 6, JSON.stringify(r))
    assert.equal(r.dto.自动确认细纲, true)
    assert.match(r.dto.期望产物, /不再问作者/)
  } finally {
    await cleanup()
  }
})

test('批次进行中：序 3 dto.批次 带章清单与「继续下一章」建议；打回后建议重写', async () => {
  const { ctx, cleanup } = await gitBookCtx()
  try {
    await reachOutline(ctx)
    await stage3(ctx)
    const r = await determineNextState(ctx)
    assert.equal(r.序, 3, JSON.stringify(r))
    assert.equal(r.state, 'resume')
    assert.equal(r.dto.从哪继续, '待定稿批次续跑')
    assert.equal(r.dto.批次.章数, 1)
    assert.deepEqual(r.dto.批次.章, [{ 章号: 3, 标题: '连写3', 状态: '待审收' }])
    assert.match(r.dto.批次.建议, /继续批内下一章（第 4 章）/)

    const rej = await rejectFrom(ctx.repoPath, 3)
    assert.equal(rej.ok, true, rej.error)
    const r2 = await determineNextState(ctx)
    assert.equal(r2.序, 3)
    assert.match(r2.dto.批次.建议, /重写打回章（第 3 章）/)
  } finally {
    await cleanup()
  }
})

test('批次进行中：停止命中（写满）→ 序 3 建议批量过稿', async () => {
  const { ctx, cleanup } = await gitBookCtx()
  try {
    await reachOutline(ctx)
    await setBookYaml(ctx, '连写批次大小', '1')
    await stage3(ctx)
    const r = await determineNextState(ctx)
    assert.equal(r.序, 3, JSON.stringify(r))
    assert.equal(r.dto.批次.停止.stop, true)
    assert.match(r.dto.批次.建议, /批量过稿/)
  } finally {
    await cleanup()
  }
})
