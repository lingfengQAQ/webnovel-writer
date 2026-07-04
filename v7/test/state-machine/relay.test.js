import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeGitBook, chapter } from './_helper.js'
import { determineNextState } from '../../src/state-machine/index.js'
import { persistVolumeReview, persistRepair } from '../../src/state-machine/persist.js'
import { gotoChapter } from '../../src/state-machine/flows/goto-chapter.js'
import { retcon } from '../../src/state-machine/flows/retcon.js'
import { run as relinkRun } from '../../src/commands/relink.js'

/**
 * 流程间接力测试（07-03 review 测试盲区）：每个流程自身绿不够，
 * 流程走完之后 next 判定还得对——本文件专测「流程完 → next」的交接。
 */

const BOOK = 'spec_version: "7.0"\n书名: 测\n'

const volEndChapter = (n) =>
  `---\n章号: ${n}\n标题: 第${n}章\n卷: 1\n字数: 100\n章定位: 推进\n钩子: 危机钩-强\n情绪定位: 高潮\n收卷: 是\n---\n大战落幕。`

test('接力（P1-1/P1-2）：卷复盘完 → 产物已入档、新伏笔进缓存、next 直进序6', async () => {
  const { ctx, git, cleanup } = await makeGitBook(
    { 'book.yaml': BOOK },
    { commits: [{ message: 'ch(1): 收卷', files: { '定稿/正文/0001-收.md': volEndChapter(1) } }] }
  )
  try {
    const before = await determineNextState(ctx)
    assert.equal(before.序, 4, '收卷章 + 无卷摘要 → 应触发卷复盘')

    const r = await persistVolumeReview(ctx, {
      卷号: 1,
      卷摘要: '第一卷收束。',
      下卷卷纲: '# 第2卷\n新地图。',
      伏笔条目: [
        {
          id: '伏笔-900',
          frontMatter: { 强度: '中', 状态: '进行', 开启章: 1, 预计收尾: '第2卷', 最后推进章: 1 },
          body: '## 描述\n新卷暗线。\n\n## 履历\n- 第1章：埋下',
        },
      ],
    })
    assert.equal(r.ok, true, r.error)

    const { stdout } = await git(['log', '-1', '--format=%s'])
    assert.match(stdout.trim(), /^vol\(01\): /)

    // P1-2：新伏笔不等下次定稿，立即在缓存可见
    const rows = await ctx.cache.query("SELECT id FROM threads WHERE id = '伏笔-900'")
    assert.equal(rows.length, 1, '复盘产出的伏笔条目应立即进缓存')

    // 接力终点：next 不误触序2（复盘产物已入档），直进序6 起草第2章
    const after = await determineNextState(ctx)
    assert.equal(after.序, 6, `复盘完 next 应进序6，实际序${after.序}：${after.message}`)
    assert.equal(after.dto.nextChapter, 2)
  } finally {
    await cleanup()
  }
})

test('接力（P1-2）：goto 回退完 → 缓存同步刷，next 起草的是正确章号', async () => {
  const { ctx, cleanup } = await makeGitBook(
    { 'book.yaml': BOOK },
    {
      commits: [
        { message: 'ch(1): 起', files: { '定稿/正文/0001-起.md': chapter(1) } },
        { message: 'ch(2): 承', files: { '定稿/正文/0002-承.md': chapter(2) } },
        { message: 'ch(3): 转', files: { '定稿/正文/0003-转.md': chapter(3) } },
      ],
    }
  )
  try {
    const before = await determineNextState(ctx)
    assert.equal(before.dto.nextChapter, 4)

    const r = await gotoChapter(ctx, { chapterNum: 1, confirm: true })
    assert.equal(r.ok, true, r.error)
    assert.equal(r.cacheRefresh?.ok, true, '回退后应同步刷新缓存')

    const after = await determineNextState(ctx)
    assert.equal(after.序, 6)
    assert.equal(after.dto.nextChapter, 2, '回到第1章后应起草第2章（缓存不刷会报第4章）')
  } finally {
    await cleanup()
  }
})

test('接力（P1-2/P1-3）：修复完缓存即时可见，序2 给清单，relink 补登后 next 进正事', async () => {
  const { ctx, git, cleanup } = await makeGitBook({
    'book.yaml': BOOK,
    '定稿/正文/0001-起.md': '---\n坏: yaml: :\n---\n正文',
  })
  try {
    const s0 = await determineNextState(ctx)
    assert.equal(s0.序, 0, '解析失败应先进修复确认')

    const target = '定稿/正文/0001-起.md'
    const r = await persistRepair(
      ctx,
      { repairs: [{ file: target, content: chapter(1) }] },
      { allowedFiles: [target] }
    )
    assert.equal(r.ok, true, r.error)

    // P1-2：修复件不等下次定稿，立即进缓存
    const rows = await ctx.cache.query('SELECT chapter_num FROM chapters')
    assert.equal(rows.length, 1, '修复件应立即进缓存')

    // 序2：修复件未入档 → 手改补登，dto 带变更清单（P1-3）
    const s2 = await determineNextState(ctx)
    assert.equal(s2.序, 2)
    assert.deepEqual(s2.dto.变更文件, [target])
    assert.ok(s2.message.includes('relink'), '序2 message 应指路 relink 命令')

    // relink：补登通道（此前是死胡同——检测得到、没命令可执行）
    const rl = await relinkRun([], { message: '修复解析失败的第1章' }, ctx)
    assert.equal(rl.ok, true, rl.error)
    const { stdout } = await git(['log', '-1', '--format=%s'])
    assert.match(stdout.trim(), /^fix\(手改\): 修复解析失败的第1章$/)

    // 接力终点：next 进正事
    const s6 = await determineNextState(ctx)
    assert.equal(s6.序, 6, `补登完 next 应进序6，实际序${s6.序}：${s6.message}`)
    assert.equal(s6.dto.nextChapter, 2)
  } finally {
    await cleanup()
  }
})

test('接力（P1-2）：retcon 完 → threads 缓存即时更新', async () => {
  const { ctx, cleanup } = await makeGitBook({
    'book.yaml': BOOK,
    '大纲/伏笔/伏笔-001-暗线.md':
      '---\n强度: 高\n状态: 进行\n开启章: 1\n预计收尾: 第2卷\n最后推进章: 1\n---\n## 描述\n暗线。\n\n## 履历\n- 第1章：埋下',
  })
  try {
    const r = await retcon(ctx, {
      chapterNum: 1,
      原因: '这条线提前收掉',
      threadUpdates: [{ id: '伏笔-001', updates: { 状态: '回收' } }],
    })
    assert.equal(r.ok, true, r.error)
    const rows = await ctx.cache.query("SELECT status FROM threads WHERE id = '伏笔-001'")
    assert.equal(rows[0]?.status, '回收', '吃书后缓存应立即反映条目新状态')
  } finally {
    await cleanup()
  }
})

test('relink：缺 --message 报错；无手改时明说无需补登', async () => {
  const { ctx, cleanup } = await makeGitBook({ 'book.yaml': BOOK })
  try {
    const noMsg = await relinkRun([], {}, ctx)
    assert.equal(noMsg.ok, false)
    assert.ok(noMsg.error.includes('--message'))

    const clean = await relinkRun([], { message: '没改什么' }, ctx)
    assert.equal(clean.ok, true)
    assert.ok(clean.output.includes('无需补登'))
  } finally {
    await cleanup()
  }
})

test('序3 resume：dto 带工作区现存与从哪继续（P2-5）', async () => {
  const { ctx, cleanup } = await makeGitBook({
    'book.yaml': BOOK,
    '工作区/细纲.md': '## 本章要写到的事\nx',
    '工作区/草稿-A.md': '草稿',
  })
  try {
    const s = await determineNextState(ctx)
    assert.equal(s.序, 3)
    assert.ok(s.dto.工作区现存.includes('细纲.md'))
    assert.ok(s.dto.工作区现存.includes('草稿-A.md'))
    assert.equal(s.dto.从哪继续, '机检与两审', '最深工件是草稿 → 从机检/两审继续')
  } finally {
    await cleanup()
  }
})
