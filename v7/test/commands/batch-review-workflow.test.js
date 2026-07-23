import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { run as batchReject } from '../../src/commands/batch-reject.js'
import { run as batchStatus } from '../../src/commands/batch-status.js'
import { buildDto } from '../../src/state-machine/dto.js'
import { repoCtx } from './_helper.js'

const draft = (chapterNum, title) =>
  `---\n章号: ${chapterNum}\n标题: ${title}\n卷: 1\n书内时间: 夏月初${chapterNum}\n字数: 100\n章定位: 推进\n钩子: 危机钩-强\n情绪定位: 铺垫\n---\n\n第${chapterNum}章正文。`

const batchRows = [
  { 章号: 3, 标题: '断桥', 状态: '待审收', 目录: '0003-断桥' },
  { 章号: 4, 标题: '回望', 状态: '待审收', 目录: '0004-回望' },
]

const files = {
  'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n连写批次大小: 8\n',
  '工作区/待定稿/批次.json': JSON.stringify({ 章列表: batchRows }, null, 2),
  '工作区/待定稿/0003-断桥/草稿.md': draft(3, '断桥'),
  '工作区/待定稿/0003-断桥/定稿包.json': '{}',
  '工作区/待定稿/0003-断桥/审稿单.md': '# 第 3 章审稿单\n\n> 共 0 个问题：0 阻断。\n',
  '工作区/待定稿/0004-回望/草稿.md': draft(4, '回望'),
  '工作区/待定稿/0004-回望/定稿包.json': '{}',
  '工作区/待定稿/0004-回望/审稿单.md': '# 第 4 章审稿单\n\n> 共 0 个问题：0 阻断。\n',
}

test('batch-reject 后 status 暴露现存暂存草稿，并给严格重审命令', async () => {
  const { ctx, cleanup } = await repoCtx(null, files)
  try {
    const beforeRejectResult = await batchStatus([], { json: true }, ctx)
    assert.equal(beforeRejectResult.ok, true, beforeRejectResult.error)
    const beforeReject = JSON.parse(beforeRejectResult.output)
    assert.equal(
      beforeReject.章.find((row) => row.章号 === 3).草稿路径,
      '工作区/待定稿/0003-断桥/草稿.md'
    )
    assert.equal(
      beforeReject.章.find((row) => row.章号 === 4).草稿路径,
      '工作区/待定稿/0004-回望/草稿.md'
    )

    const rejected = await batchReject(['3'], {}, ctx)
    assert.equal(rejected.ok, true, rejected.error)
    assert.match(rejected.output, /batch-status --json.*草稿路径/)
    assert.match(rejected.output, /review-input <章号> --draft=<草稿路径>/)
    assert.match(rejected.output, /save-review <章号> --file=<json路径> --draft=<草稿路径>/)
    assert.match(rejected.output, /batch-restage <章号>/)

    const jsonResult = await batchStatus([], { json: true }, ctx)
    assert.equal(jsonResult.ok, true, jsonResult.error)
    const data = JSON.parse(jsonResult.output)
    const rejectedRow = data.章.find((row) => row.章号 === 3)
    const affectedRow = data.章.find((row) => row.章号 === 4)
    assert.equal(rejectedRow.状态, '打回')
    assert.equal(rejectedRow.草稿路径, undefined)
    assert.equal(affectedRow.状态, '受影响')
    assert.equal(affectedRow.草稿路径, '工作区/待定稿/0004-回望/草稿.md')
    await fs.access(path.join(ctx.repoPath, ...affectedRow.草稿路径.split('/')))

    const humanResult = await batchStatus([], {}, ctx)
    assert.equal(humanResult.ok, true, humanResult.error)
    assert.match(humanResult.output, /第 4 章《回望》｜受影响.*草稿路径：工作区\/待定稿\/0004-回望\/草稿\.md/)
  } finally {
    await cleanup()
  }
})

test('序 3 批次 DTO 携带受影响章草稿路径，并保留打回与重审两段建议', async () => {
  const { ctx, cleanup } = await repoCtx(null, files)
  try {
    const rejected = await batchReject(['3'], {}, ctx)
    assert.equal(rejected.ok, true, rejected.error)

    const dto = await buildDto(ctx, 3, {
      现存: ['待定稿/'],
      从哪继续: '待定稿批次续跑',
    })
    const rejectedRow = dto.批次.章.find((row) => row.章号 === 3)
    const affectedRow = dto.批次.章.find((row) => row.章号 === 4)
    assert.equal(rejectedRow.草稿路径, undefined)
    assert.equal(affectedRow.草稿路径, '工作区/待定稿/0004-回望/草稿.md')
    assert.match(dto.批次.建议, /重写打回章（第 3 章）/)
    assert.match(dto.批次.建议, /重审受影响章（第 4 章）/)
    assert.match(dto.批次.建议, /review-input <章号> --draft=<草稿路径>/)
    assert.match(dto.批次.建议, /save-review <章号> --file=<json路径> --draft=<草稿路径>/)
    assert.match(dto.批次.建议, /batch-restage <章号>/)
  } finally {
    await cleanup()
  }
})
