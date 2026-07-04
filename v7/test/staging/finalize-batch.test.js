import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  stageChapter,
  finalizeBatch,
  rejectFrom,
  restageReview,
  discardBatch,
  readBatch,
  章状态,
} from '../../src/staging/index.js'
import { finalizeChapter } from '../../src/finalize/index.js'
import { determineNextState } from '../../src/state-machine/index.js'
import { createGit } from '../../src/finalize/git.js'
import { gitBookCtx } from '../commands/_helper.js'

const execFileAsync = promisify(execFile)

function chapterPayload(num, { body, 钩子 = '危机钩-强' } = {}) {
  return {
    chapterNum: num,
    frontMatter: {
      章号: num,
      标题: `连写${num}`,
      卷: 1,
      视角: '林晚',
      书内时间: `夏月初${num}`,
      字数: 100,
      章定位: '推进',
      钩子,
      情绪定位: '铺垫',
      伏笔: ['推进 伏笔-001'],
    },
    body: body ?? `第${num}章正文：林晚继续追查，步步逼近真相。`,
    summary: `第${num}章摘要。`,
    threadUpdates: [{ id: '伏笔-001', updates: { 最后推进章: num }, history: `第${num}章：推进` }],
    timelineRows: [
      { volumeNum: 1, row: { 章: num, 书内时间: `夏月初${num}`, 一句话事件: `第${num}章事件`, 在场: '林晚' } },
    ],
    commitLines: { 条目: '~伏笔-001' },
    workspaceFiles: [],
  }
}

async function stage(ctx, num, opts) {
  await fs.mkdir(path.join(ctx.repoPath, '工作区'), { recursive: true })
  await fs.writeFile(
    path.join(ctx.repoPath, '工作区', '审稿.md'),
    `# 第 ${num} 章审稿单\n\n> 完整两审模式。\n> 共 0 个问题：0 阻断。\n`,
    'utf8'
  )
  const r = await stageChapter(ctx, { chapterNum: num, payload: chapterPayload(num, opts) })
  assert.equal(r.ok, true, r.error)
  return r
}

// 定稿/大纲 全树快照（相对路径 → 内容），批次转正 vs 手动定稿逐字段对比
async function snapshotTree(repoPath) {
  const map = {}
  async function walk(dir) {
    let entries = []
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await walk(full)
      else {
        map[path.relative(repoPath, full).replace(/\\/g, '/')] = (
          await fs.readFile(full, 'utf8')
        ).replace(/\r\n/g, '\n')
      }
    }
  }
  await walk(path.join(repoPath, '定稿'))
  await walk(path.join(repoPath, '大纲'))
  return map
}

test('AC1 批次端到端：stage×3 → finalize-batch 逐章 commit，入档与手动定稿逐字段一致', async () => {
  const batchRepo = await gitBookCtx()
  const manualRepo = await gitBookCtx()
  try {
    for (const n of [3, 4, 5]) await stage(batchRepo.ctx, n)

    // AC7 后半：批内期间 fingerprints/meta 零 staged 污染
    assert.equal(
      (await batchRepo.ctx.cache.query('SELECT COUNT(*) AS c FROM fingerprints'))[0].c,
      0
    )
    assert.equal(
      (await batchRepo.ctx.cache.query("SELECT COUNT(*) AS c FROM meta WHERE key = 'imagery_top'"))[0].c,
      0
    )

    const git = createGit(batchRepo.ctx.repoPath)
    const before = await git.revCount()
    const r = await finalizeBatch(batchRepo.ctx)
    assert.equal(r.ok, true, r.error)
    assert.deepEqual(r.已入档.map((x) => x.章号), [3, 4, 5])
    assert.equal(await git.revCount(), before + 3, '每章一个独立 commit')
    const log = await git.log()
    const [i5, i4, i3] = [log.indexOf('ch(5)'), log.indexOf('ch(4)'), log.indexOf('ch(3)')]
    assert.ok(i5 !== -1 && i4 !== -1 && i3 !== -1 && i5 < i4 && i4 < i3, '按章号升序逐章 commit')
    assert.equal((await readBatch(batchRepo.ctx.repoPath)).exists, false, '批次目录清空')
    assert.match(r.体检, /体检/)

    const nx = await determineNextState(batchRepo.ctx)
    assert.equal(nx.序, 6, JSON.stringify(nx))
    assert.match(nx.message, /第 6 章/)

    // 手动模式同 payload 逐章定稿 → 定稿/大纲 全树逐字段一致
    for (const n of [3, 4, 5]) {
      const m = await finalizeChapter(manualRepo.ctx, chapterPayload(n))
      assert.equal(m.ok, true, m.error)
    }
    assert.deepEqual(
      await snapshotTree(batchRepo.ctx.repoPath),
      await snapshotTree(manualRepo.ctx.repoPath)
    )
  } finally {
    await batchRepo.cleanup()
    await manualRepo.cleanup()
  }
})

test('AC3 注入错误恢复演练：打回传染 → 拒绝定稿 → 重写重审 → 成功且旧内容零入档', async () => {
  const { ctx, cleanup } = await gitBookCtx()
  try {
    const badPhrase = '这段写崩了的旧版本'
    await stage(ctx, 3)
    await stage(ctx, 4, { body: `第4章正文：${badPhrase}。` })
    await stage(ctx, 5)

    const rej = await rejectFrom(ctx.repoPath, 4)
    assert.equal(rej.ok, true, rej.error)
    assert.deepEqual(rej.受影响, [5])

    const git = createGit(ctx.repoPath)
    const before = await git.revCount()
    const blocked = await finalizeBatch(ctx)
    assert.equal(blocked.ok, false)
    assert.match(blocked.error, /打回/)
    assert.match(blocked.error, /受影响/)
    assert.equal(await git.revCount(), before, '拒绝时零 commit')

    // 重写打回章 → stage 覆盖；受影响章重审 → batch-restage 通道
    await stage(ctx, 4, { body: '第4章正文：重写后的干净版本。' })
    await fs.writeFile(
      path.join(ctx.repoPath, '工作区', '审稿.md'),
      '# 第 5 章审稿单\n\n> 完整两审模式。\n> 共 0 个问题：0 阻断。\n',
      'utf8'
    )
    const rs = await restageReview(ctx.repoPath, 5)
    assert.equal(rs.ok, true, rs.error)

    const done = await finalizeBatch(ctx)
    assert.equal(done.ok, true, done.error)
    assert.deepEqual(done.已入档.map((x) => x.章号), [3, 4, 5])

    const ch4 = await fs.readFile(path.join(ctx.repoPath, '定稿', '正文', '0004-连写4.md'), 'utf8')
    assert.match(ch4, /重写后的干净版本/)
    // 打回章的旧预登记内容不出现在任何 commit（批内污染不出批次）
    const { stdout } = await execFileAsync('git', ['log', '-p', '--all'], {
      cwd: ctx.repoPath,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
    assert.ok(!stdout.includes(badPhrase), '旧版本内容泄漏进了 git 历史')
  } finally {
    await cleanup()
  }
})

test('中途失败按章保留：坏定稿包停在该章，已入档保留、剩余原样可续跑', async () => {
  const { ctx, cleanup } = await gitBookCtx()
  try {
    await stage(ctx, 3)
    await stage(ctx, 4)
    const batch = await readBatch(ctx.repoPath)
    const dir4 = batch.章列表.find((x) => x.章号 === 4).目录
    await fs.writeFile(path.join(ctx.repoPath, '工作区', '待定稿', dir4, '定稿包.json'), '{{{', 'utf8')

    const r = await finalizeBatch(ctx)
    assert.equal(r.ok, false)
    assert.deepEqual(r.已入档.map((x) => x.章号), [3])
    assert.match(r.error, /第 4 章/)
    assert.match(r.error, /已入档保留/)

    const rows = await ctx.cache.query('SELECT MAX(chapter_num) AS m FROM chapters')
    assert.equal(rows[0].m, 3, '第 3 章已入档并刷新缓存')
    const after = await readBatch(ctx.repoPath)
    assert.deepEqual(after.章列表.map((x) => x.章号), [4], '失败章留在批次里')
  } finally {
    await cleanup()
  }
})

test('AC6 整批丢弃：定稿零变化、批次消失、next 回起草细纲', async () => {
  const { ctx, cleanup } = await gitBookCtx()
  try {
    await stage(ctx, 3)
    const git = createGit(ctx.repoPath)
    const before = await git.revCount()

    const r = await discardBatch(ctx.repoPath)
    assert.equal(r.ok, true, r.error)
    assert.equal(r.章数, 1)

    assert.equal(await git.revCount(), before)
    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '--', '定稿', '大纲'], {
      cwd: ctx.repoPath,
      encoding: 'utf8',
    })
    assert.equal(stdout.trim(), '', '定稿/大纲 工作树零变化')
    assert.equal((await readBatch(ctx.repoPath)).exists, false)

    const nx = await determineNextState(ctx)
    assert.equal(nx.序, 6, JSON.stringify(nx))
    assert.match(nx.message, /第 3 章/)
  } finally {
    await cleanup()
  }
})

test('finalize-batch --until：只转正前段，剩余待审收、next 报批次续跑', async () => {
  const { ctx, cleanup } = await gitBookCtx()
  try {
    for (const n of [3, 4, 5]) await stage(ctx, n)
    const r = await finalizeBatch(ctx, { until: 4 })
    assert.equal(r.ok, true, r.error)
    assert.deepEqual(r.已入档.map((x) => x.章号), [3, 4])
    assert.equal(r.剩余, 1)

    const batch = await readBatch(ctx.repoPath)
    assert.deepEqual(
      batch.章列表.map((x) => [x.章号, x.状态]),
      [[5, 章状态.待审收]]
    )
    const nx = await determineNextState(ctx)
    assert.equal(nx.序, 3, JSON.stringify(nx))
  } finally {
    await cleanup()
  }
})
