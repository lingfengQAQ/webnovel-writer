import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { finalizeChapter } from '../../src/finalize/index.js'
import { createGit } from '../../src/finalize/git.js'
import { gitBookCtx } from '../commands/_helper.js'
import { mechanicalCheck } from '../../src/mechanical-check/index.js'

const execFileAsync = promisify(execFile)

function payload() {
  return {
    chapterNum: 3,
    frontMatter: {
      章号: 3,
      标题: '初露',
      卷: 1,
      视角: '林晚',
      字数: 100,
      章定位: '推进',
      钩子: '危机钩-强',
      情绪定位: '铺垫',
    },
    body: '林晚查到玉佩的第一条线索，心头巨震。\n',
    summary: '林晚查到玉佩的第一条线索。',
    threadUpdates: [
      { id: '伏笔-001', updates: { 最后推进章: 3 }, history: '第3章：推进——林晚查到线索' },
    ],
    characterUpdates: [{ name: '林晚', updates: { 最后变更章: 3 } }],
    timelineRows: [
      { volumeNum: 1, row: { 章: 3, 书内时间: '春月初三', 一句话事件: '查到玉佩线索', 在场: '林晚' } },
    ],
    commitLines: { 条目: '~伏笔-001', 设定: '林晚.最后变更章=3' },
    workspaceFiles: ['细纲.md'],
  }
}

test('finalizeChapter 正常定稿：落档 + git commit + 清工作区', async () => {
  const { ctx, cleanup } = await gitBookCtx()
  try {
    const git = createGit(ctx.repoPath)
    const before = await git.revCount()

    const r = await finalizeChapter(ctx, payload())
    assert.equal(r.ok, true, r.error)

    const ch = await fs.readFile(path.join(ctx.repoPath, '定稿/正文/0003-初露.md'), 'utf8')
    assert.match(ch, /标题: 初露/)
    await fs.access(path.join(ctx.repoPath, '定稿/摘要/章摘要/0003.md'))

    const log = await git.log()
    assert.match(log, /ch\(3\):/)
    assert.equal(await git.revCount(), before + 1)

    await assert.rejects(() => fs.access(path.join(ctx.repoPath, '工作区/细纲.md')))
  } finally {
    await cleanup()
  }
})

test('finalizeChapter 断电注入：无新 commit + 工作区原样 + 定稿净恢复（出口）', async () => {
  const { ctx, cleanup } = await gitBookCtx()
  try {
    const git = createGit(ctx.repoPath)
    const before = await git.revCount()

    const r = await finalizeChapter(ctx, payload(), { faultAfterWrite: true })
    assert.equal(r.ok, false)

    // 无新 commit
    assert.equal(await git.revCount(), before)
    // 工作区草稿原样（细纲还在）
    await fs.access(path.join(ctx.repoPath, '工作区/细纲.md'))
    // 定稿 未残留半成品章
    await assert.rejects(() => fs.access(path.join(ctx.repoPath, '定稿/正文/0003-初露.md')))
    // 定稿/大纲 工作树干净（回滚成功）
    const { stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain', '--', '定稿', '大纲'],
      { cwd: ctx.repoPath, encoding: 'utf8' }
    )
    assert.equal(stdout.trim(), '')
  } finally {
    await cleanup()
  }
})

test('finalizeChapter 定稿后删 .cache 全量重建一致（不变量 2）', async () => {
  const { ctx, cleanup } = await gitBookCtx()
  try {
    const r = await finalizeChapter(ctx, payload())
    assert.equal(r.ok, true, r.error)

    await ctx.cache.rebuildFromSource(ctx.repoPath)
    const rows = await ctx.cache.query('SELECT * FROM chapters WHERE chapter_num = 3')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].title, '初露')
  } finally {
    await cleanup()
  }
})

test('finalizeChapter 断电回滚（P1-7）：不误伤同子树其他章的未提交手改', async () => {
  const { ctx, cleanup } = await gitBookCtx()
  try {
    // 在已跟踪的第1章上手改（不提交）——不在本次 written 集合里
    const ch1 = path.join(ctx.repoPath, '定稿/正文/0001-开局.md')
    await fs.writeFile(ch1, (await fs.readFile(ch1, 'utf8')) + '\n第1章手改。', 'utf8')

    const r = await finalizeChapter(ctx, payload(), { faultAfterWrite: true })
    assert.equal(r.ok, false)

    // 本次新写的第3章被清（未跟踪 → clean）
    await assert.rejects(() => fs.access(path.join(ctx.repoPath, '定稿/正文/0003-初露.md')))
    // 第1章手改保留（回滚范围收窄到 written,不再整棵 定稿/ 子树）
    assert.ok((await fs.readFile(ch1, 'utf8')).includes('第1章手改。'), '第1章手改不应被回滚抹掉')
  } finally {
    await cleanup()
  }
})

test('finalizeChapter 改同章标题后断电：旧章恢复，新章不残留', async () => {
  const { ctx, cleanup } = await gitBookCtx()
  try {
    const oldPath = path.join(ctx.repoPath, '定稿/正文/0001-开局.md')
    const oldContent = await fs.readFile(oldPath, 'utf8')
    const r = await finalizeChapter(ctx, {
      chapterNum: 1,
      frontMatter: {
        章号: 1,
        标题: '改名',
        卷: 1,
        字数: 100,
        章定位: '推进',
      },
      body: '新正文',
    }, { faultAfterWrite: true })
    assert.equal(r.ok, false)

    assert.equal(
      (await fs.readFile(oldPath, 'utf8')).replace(/\r\n/g, '\n'),
      oldContent.replace(/\r\n/g, '\n'),
      '旧标题章文件必须恢复同一内容'
    )
    await assert.rejects(() => fs.access(path.join(ctx.repoPath, '定稿/正文/0001-改名.md')))
    const { stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain', '--', '定稿/正文'],
      { cwd: ctx.repoPath, encoding: 'utf8' }
    )
    assert.equal(stdout.trim(), '')
  } finally {
    await cleanup()
  }
})

// —— 新开条目入档（M6 P1.0：threadCreates，补 M2 起「埋下」无入档通道的缺口）——

const 新条目 = () => ({
  id: '伏笔-002',
  短题: '黑影来历',
  frontMatter: { 强度: '中', 状态: '进行', 开启章: 3, 最后推进章: 3 },
  body: '## 描述\n黑影的来历。\n\n## 收尾计划\n第二卷揭晓。\n\n## 履历\n- 第3章：埋下——黑影首次现身\n',
})

test('finalizeChapter threadCreates：埋下建档→缓存可见→下一章推进机检零误报（接力）', async () => {
  const { ctx, cleanup } = await gitBookCtx()
  try {
    const p = payload()
    p.frontMatter.伏笔 = ['推进 伏笔-001', '埋下 伏笔-002']
    p.threadCreates = [新条目()]
    const r = await finalizeChapter(ctx, p)
    assert.equal(r.ok, true, r.error)

    const f = await fs.readFile(path.join(ctx.repoPath, '大纲/伏笔/伏笔-002-黑影来历.md'), 'utf8')
    assert.match(f, /状态: 进行/)
    assert.match(f, /## 履历/)
    const rows = await ctx.cache.query("SELECT id, status FROM threads WHERE id = '伏笔-002'")
    assert.equal(rows.length, 1, '定稿刷缓存后新条目必须可见')

    // 接力：下一章草稿声明「推进 伏笔-002」，机检不得误判「不存在」
    const draft = [
      '---',
      '章号: 4',
      '标题: 追影',
      '卷: 1',
      '字数: 40',
      '章定位: 推进',
      '钩子: 危机钩-强',
      '情绪定位: 铺垫',
      '伏笔:',
      '  - 推进 伏笔-002',
      '---',
      '林晚循着黑影的踪迹一路追到后山，夜风里那道身影再次出现，她悄悄握紧了袖中的短刀。',
    ].join('\n')
    const draftPath = path.join(ctx.repoPath, '工作区', '草稿-A.md')
    await fs.mkdir(path.dirname(draftPath), { recursive: true })
    await fs.writeFile(draftPath, draft, 'utf8')
    const mc = await mechanicalCheck(ctx, { chapterNum: 4, draftPath })
    assert.equal(mc.ok, true, mc.error)
    assert.deepEqual(
      mc.issues.filter((i) => i.check === '条目变动'),
      [],
      JSON.stringify(mc.issues)
    )
  } finally {
    await cleanup()
  }
})

test('finalizeChapter threadCreates 撞已有编号 → 整体失败并干净回滚', async () => {
  const { ctx, cleanup } = await gitBookCtx()
  try {
    const git = createGit(ctx.repoPath)
    const before = await git.revCount()
    const p = payload()
    p.threadCreates = [{ ...新条目(), id: '伏笔-001' }] // sample-book 已有
    const r = await finalizeChapter(ctx, p)
    assert.equal(r.ok, false)
    assert.match(r.error, /已存在/)
    assert.equal(await git.revCount(), before)
    const { stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain', '--', '定稿', '大纲'],
      { cwd: ctx.repoPath, encoding: 'utf8' }
    )
    assert.equal(stdout.trim(), '')
  } finally {
    await cleanup()
  }
})

test('finalizeChapter threadCreates 断电回滚：新条目文件不残留', async () => {
  const { ctx, cleanup } = await gitBookCtx()
  try {
    const p = payload()
    p.threadCreates = [新条目()]
    const r = await finalizeChapter(ctx, p, { faultAfterWrite: true })
    assert.equal(r.ok, false)
    await assert.rejects(() => fs.access(path.join(ctx.repoPath, '大纲/伏笔/伏笔-002-黑影来历.md')))
  } finally {
    await cleanup()
  }
})
