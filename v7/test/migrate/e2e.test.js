import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { migrateV6 } from '../../src/migrate/index.js'
import { run as migrateCmd } from '../../src/commands/migrate.js'
import { CacheManager } from '../../src/cache/index.js'
import { determineNextState } from '../../src/state-machine/index.js'
import { loadBooks } from '../../src/session/index.js'
import { tempV6, tempV6Sqlite, inlineFixture } from './_v6.js'

const execFileAsync = promisify(execFile)

async function tempWorkdir() {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-workdir-'))
  await fs.mkdir(path.join(workdir, '.webnovel'), { recursive: true })
  return { ctx: { workdir, packageRoot: null }, cleanup: () => fs.rm(workdir, { recursive: true, force: true }) }
}

/** 目录树指纹：相对路径 → 内容长度（源只读断言用）。 */
async function treeFingerprint(root) {
  const map = new Map()
  async function walk(dir) {
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) await walk(full)
      else map.set(path.relative(root, full), (await fs.readFile(full)).length)
    }
  }
  await walk(root)
  return map
}

async function readTree(root) {
  const parts = []
  async function walk(dir) {
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
      if (ent.name === '.git' || ent.name === '.cache') continue
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) await walk(full)
      else parts.push(await fs.readFile(full, 'utf8'))
    }
  }
  await walk(root)
  return parts.join('\n')
}

test('AC2 端到端（inline）：迁移落位、git 单 commit、缓存可删重建、next 进正常写章流程', async () => {
  const { ctx, cleanup } = await tempWorkdir()
  const v6 = await tempV6(inlineFixture)
  try {
    const r = await migrateV6(ctx, v6.v6Path)
    assert.equal(r.ok, true, r.error)
    const repo = path.join(ctx.workdir, '剑碎虚空')

    // 结构合规：正文/摘要/条目/名册/时间线/卷纲/工程件
    for (const p of [
      '定稿/正文/0001-残剑出鞘.md', '定稿/正文/0002-第2章.md', '定稿/正文/0003-剑灵初醒.md',
      '定稿/摘要/章摘要/0001.md', '大纲/伏笔/伏笔-001-残剑剑柄内藏半张古.md',
      '定稿/设定/名册.md', '定稿/设定/角色/陆沉.md', '定稿/设定/时间线/第01卷.md',
      '大纲/总纲.md', '大纲/卷纲/第01卷.md', 'book.yaml', 'AGENTS.md', '.gitignore',
      '工作区/迁移报告.md',
    ]) {
      await fs.access(path.join(repo, p))
    }

    // git：提交链压成单个 init commit，工作树净（工作区被 ignore）
    const { stdout: cnt } = await execFileAsync('git', ['rev-list', '--count', 'HEAD'], { cwd: repo })
    assert.equal(cnt.trim(), '1')
    const { stdout: st } = await execFileAsync('git', ['status', '--porcelain'], { cwd: repo })
    assert.equal(st.trim(), '')

    // 删缓存全量重建一致（不变量 2）
    await fs.rm(path.join(repo, '.cache'), { recursive: true, force: true })
    const cache = new CacheManager(path.join(repo, '.cache', 'index.db'))
    try {
      await cache.ensureReady(repo)
      const rows = await cache.query('SELECT COUNT(*) AS n FROM chapters', [])
      assert.equal(rows[0].n, 3)
      // AC7 口径顺检：迁移不产生指纹（体检才产）
      assert.equal((await cache.query('SELECT COUNT(*) AS n FROM fingerprints', []))[0].n, 0)

      // next 直接进正常流程：序 6 起草第 4 章
      const next = await determineNextState({ repoPath: repo, cache, workdir: ctx.workdir })
      assert.equal(next.序, 6, JSON.stringify(next))
      assert.equal(next.dto.nextChapter, 4)
    } finally {
      await cache.close()
    }

    // books.jsonl 登记 + 当前书
    const books = await loadBooks(ctx.workdir)
    assert.ok(books.books.some((b) => b.书名 === '剑碎虚空'))
  } finally {
    await v6.cleanup()
    await cleanup()
  }
})

test('AC2 端到端（sqlite 形态）+ AC5 报告三节', async () => {
  const { ctx, cleanup } = await tempWorkdir()
  const v6 = await tempV6Sqlite()
  try {
    const r = await migrateV6(ctx, v6.v6Path)
    assert.equal(r.ok, true, r.error)
    const report = await fs.readFile(path.join(ctx.workdir, '潮汐之下', '工作区', '迁移报告.md'), 'utf8')
    assert.match(report, /## 迁了什么/)
    assert.match(report, /- 章数：2/)
    assert.match(report, /## 待校对/)
    assert.match(report, /## 如实丢弃/)
    assert.match(report, /index\.db 实体已转正文件/)
    assert.match(report, /数据形态：state\.json 精简 \+ index\.db/)
  } finally {
    await v6.cleanup()
    await cleanup()
  }
})

test('AC3 不丢字：v6 每类文本在 v7 产物或待校对区可寻回', async () => {
  const { ctx, cleanup } = await tempWorkdir()
  const v6 = await tempV6(inlineFixture)
  try {
    const r = await migrateV6(ctx, v6.v6Path)
    assert.equal(r.ok, true, r.error)
    const tree = await readTree(path.join(ctx.workdir, '剑碎虚空'))
    for (const text of [
      '晨雾未散，陆沉背着那柄锈迹斑斑的残剑走进演武场', // 正文（平坦带标题）
      '藏经阁的木梯吱呀作响', // 正文（遗留无标题）
      '淤塞多年的气海竟被撕开一道细缝', // 正文（卷内 3 位）
      '陆沉携残剑入演武场受三长老盘问', // 章摘要
      '残剑剑柄内藏半张古图', // 伏笔 content
      '外门大比', // active_threads → 卷纲
      '三长老着人盯梢陆沉，尚未收线', // scratchpad open_loops → 待校对
      '陆家灭门夜唯一遗物', // scratchpad story_facts → 待校对
      '战斗段落短句连用，收在动作定格', // patterns → 文风候选
      '剑灵反哺', // state_changes → 实体变更史
      '藏经阁初见，苏素予其残卷', // structured_relationships → 角色卡关系
      '外门三千弟子，藏经阁七层', // 设定集
      '陆沉集齐古图，于虚空裂隙斩落伪天道', // 总纲
      '剑灵初醒，破至练气五层', // 时间线事件
    ]) {
      assert.ok(tree.includes(text), `丢字：找不到「${text}」`)
    }
  } finally {
    await v6.cleanup()
    await cleanup()
  }
})

test('AC4 回退演练：中途失败工作目录零残留、源 v6 未被改动；残留临时目录会被清扫', async () => {
  const { ctx, cleanup } = await tempWorkdir()
  const v6 = await tempV6(inlineFixture)
  try {
    const before = await treeFingerprint(v6.v6Path)
    // 预埋一个上次中断的残留临时目录
    await fs.mkdir(path.join(ctx.workdir, '.migrate-tmp-99999', '定稿'), { recursive: true })

    const r = await migrateV6(ctx, v6.v6Path, { _faultBeforeRename: true })
    assert.equal(r.ok, false)
    assert.match(r.error, /工作目录已恢复原样/)

    const left = await fs.readdir(ctx.workdir)
    assert.ok(!left.some((n) => n.startsWith('.migrate-tmp-')), `残留：${left}`)
    assert.ok(!left.includes('剑碎虚空'))
    assert.deepEqual(await treeFingerprint(v6.v6Path), before) // 源逐文件未动
  } finally {
    await v6.cleanup()
    await cleanup()
  }
})

test('目标目录已存在拒绝（--dir 另起名可走）；命令壳用法提示', async () => {
  const { ctx, cleanup } = await tempWorkdir()
  const v6 = await tempV6(inlineFixture)
  try {
    await fs.mkdir(path.join(ctx.workdir, '剑碎虚空'))
    const clash = await migrateV6(ctx, v6.v6Path)
    assert.equal(clash.ok, false)
    assert.match(clash.error, /已有「剑碎虚空」/)

    const alt = await migrateCmd([v6.v6Path], { dir: '剑碎虚空-旧稿' }, ctx)
    assert.equal(alt.ok, true, alt.error)
    await fs.access(path.join(ctx.workdir, '剑碎虚空-旧稿', 'book.yaml'))

    const noArg = await migrateCmd([], {}, ctx)
    assert.equal(noArg.ok, false)
    assert.match(noArg.error, /用法/)
  } finally {
    await v6.cleanup()
    await cleanup()
  }
})
