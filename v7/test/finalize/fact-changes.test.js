import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { finalizeChapter } from '../../src/finalize/index.js'
import { makeGitBook } from '../state-machine/_helper.js'
import { designFixture } from '../knowledge/_design-fixture.js'
import { FACT_PATH, PLAN_PATH, factFixture } from '../knowledge/_fact-fixture.js'

function payload(decision = '无冲突') {
  return {
    chapterNum: 1,
    frontMatter: {
      章号: 1,
      标题: '初见林晚',
      卷: 1,
      字数: 100,
      章定位: '推进',
      钩子: '危机钩-强',
      情绪定位: '铺垫',
    },
    body: '林晚第一次正式登场。',
    factChanges: [{
      planPath: PLAN_PATH,
      factPath: FACT_PATH,
      content: factFixture(),
      decision,
      removePlan: true,
    }],
  }
}

async function repo() {
  return makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n',
    [PLAN_PATH]: designFixture(),
  })
}

test('finalize：章节、事实写入和计划删除进入同一提交', async () => {
  const { ctx, root, git, cleanup } = await repo()
  try {
    const result = await finalizeChapter(ctx, payload())
    assert.equal(result.ok, true, result.error)
    await fs.access(path.join(root, ...FACT_PATH.split('/')))
    await fs.access(path.join(root, '定稿', '正文', '0001-初见林晚.md'))
    await assert.rejects(() => fs.access(path.join(root, ...PLAN_PATH.split('/'))))
    const changed = (
      await git(['-c', 'core.quotepath=false', 'show', '--name-status', '--format='])
    ).stdout.replaceAll('\\', '/')
    assert.match(changed, /大纲\/创作设计\/人物\/CHAR-001-林晚.md/)
    assert.match(changed, /定稿\/设定\/角色\/林晚.md/)
    assert.match(changed, /定稿\/正文\/0001-初见林晚.md/)
  } finally {
    await cleanup()
  }
})

test('finalize：冲突零写入；写入后故障会恢复计划并清掉章节与事实', async () => {
  const conflictRepo = await repo()
  try {
    const blocked = await finalizeChapter(conflictRepo.ctx, payload('冲突'))
    assert.equal(blocked.ok, false)
    assert.match(blocked.error, /作者裁决/)
    await fs.access(path.join(conflictRepo.root, ...PLAN_PATH.split('/')))
    await assert.rejects(() => fs.access(path.join(conflictRepo.root, ...FACT_PATH.split('/'))))
    await assert.rejects(() => fs.access(path.join(conflictRepo.root, '定稿', '正文', '0001-初见林晚.md')))
  } finally {
    await conflictRepo.cleanup()
  }

  const faultRepo = await repo()
  try {
    const failed = await finalizeChapter(faultRepo.ctx, payload(), { faultAfterWrite: true })
    assert.equal(failed.ok, false)
    await fs.access(path.join(faultRepo.root, ...PLAN_PATH.split('/')))
    await assert.rejects(() => fs.access(path.join(faultRepo.root, ...FACT_PATH.split('/'))))
    await assert.rejects(() => fs.access(path.join(faultRepo.root, '定稿', '正文', '0001-初见林晚.md')))
    assert.equal((await faultRepo.git(['status', '--porcelain'])).stdout.trim(), '')
  } finally {
    await faultRepo.cleanup()
  }
})

test('finalize：factChanges 与旧事实写入字段命中同一路径时零写入', async () => {
  const { ctx, root, cleanup } = await repo()
  try {
    const input = payload()
    input.characterUpdates = [{ name: '林晚', updates: { 境界: '练气四层' } }]
    const result = await finalizeChapter(ctx, input)
    assert.equal(result.ok, false)
    assert.match(result.error, /同时出现在 factChanges/)
    await fs.access(path.join(root, ...PLAN_PATH.split('/')))
    await assert.rejects(() => fs.access(path.join(root, ...FACT_PATH.split('/'))))
  } finally {
    await cleanup()
  }
})
