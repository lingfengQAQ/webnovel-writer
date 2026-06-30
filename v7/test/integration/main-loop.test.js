import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CacheManager } from '../../src/cache/index.js'
import { persistCreateBook, persistDraftOutline } from '../../src/state-machine/persist.js'
import { runReviews } from '../../src/review/index.js'
import { finalizeChapter } from '../../src/finalize/index.js'
import { determineNextState } from '../../src/state-machine/index.js'

const exec = promisify(execFile)

// 桩两审：零问题通过，用于驱动主循环不引入真模型
const stubReviewers = {
  factCheck: async () => ({ chapter: 1, issues: [] }),
  editorial: async () => ({ chapter: 1, issues: [] }),
}

const charCard = `---\n姓名: 林晚\n状态: 在世\n位置: 青云宗\n境界: 练气三层\n---\n## 设定\n玉佩线索。`
const timeline = '| 章 | 一句话事件 |\n| --- | --- |\n| 1 | 林晚得玉佩 |\n'

/**
 * 主循环端到端（review 推荐的 P0 锁定测试）：
 * 建书(persistCreateBook 内部 git init) → 备料 → 两审(桩) → 定稿(刷新缓存) → next
 * 期望 next 报序6 且 nextChapter = 已定稿章 + 1（不重抄）。
 * 这条在 P0-1 修复前会红：定稿不刷新缓存 → next 仍说 maxChapter=0 → 起草第 1 章。
 */
test('主循环：建书→备料→两审(桩)→定稿→next 不重抄最新章', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-loop-'))
  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-loop-db-'))
  const cache = new CacheManager(path.join(dbDir, 'index.db'))
  const ctx = { repoPath: root, cache }
  const git = (a) => exec('git', a, { cwd: root })
  try {
    // 1. 建书：persistCreateBook 内部完成 git init + .gitignore + core.quotepath（P0-2）
    const r1 = await persistCreateBook(ctx, {
      book: { spec_version: '7.0', 书名: '测', 卷规模: 40, 体检周期: 50 },
      总纲: '# 总纲\n## 结局\nx',
      卷纲: '# 第1卷\n入门',
    })
    assert.equal(r1.ok, true, r1.error)
    // 建书产物 + 角色卡 + 时间线 一起入档（避免序2 手改误触）
    await fs.mkdir(path.join(root, '定稿/设定/角色'), { recursive: true })
    await fs.writeFile(path.join(root, '定稿/设定/角色/林晚.md'), charCard, 'utf8')
    await fs.mkdir(path.join(root, '定稿/设定/时间线'), { recursive: true })
    await fs.writeFile(path.join(root, '定稿/设定/时间线/第01卷.md'), timeline, 'utf8')
    await git(['config', 'user.email', 't@example.com'])
    await git(['config', 'user.name', 'test'])
    await git(['add', '-A'])
    await git(['commit', '-q', '-m', 'init book'])
    // .gitignore 真的 ignore 了 .cache / 工作区（P0-2 旁证）
    const gi = await fs.readFile(path.join(root, '.gitignore'), 'utf8')
    assert.ok(gi.includes('.cache/') && gi.includes('工作区/'), '.gitignore 应 ignore .cache 与 工作区')

    // 2. next → 序6 起草第 1 章
    await cache.ensureReady(root)
    let s = await determineNextState(ctx)
    assert.equal(s.序, 6, `建书后应序6，实际：${JSON.stringify(s)}`)
    assert.equal(s.dto.nextChapter, 1)

    // 3. 备料：细纲 + 草稿
    await persistDraftOutline(ctx, { 细纲: '## 本章要写到的事\n林晚突破练气四层。\n' })
    await fs.mkdir(path.join(root, '工作区'), { recursive: true })
    await fs.writeFile(path.join(root, '工作区/草稿-1.md'), '林晚运转功法，突破到练气四层。', 'utf8')

    // 4. 两审（桩）→ 落 审稿.md + 评审报告/
    const rv = await runReviews(ctx, {
      chapterNum: 1,
      draftPath: '工作区/草稿-1.md',
      mode: 'complete',
      reviewers: stubReviewers,
      待确认新专名: [],
      章摘要: '林晚突破。',
    })
    assert.equal(rv.ok, true, rv.errors?.join('; '))

    // 5. 定稿第 1 章（P0-1：定稿后刷新缓存）
    const fr = await finalizeChapter(ctx, {
      chapterNum: 1,
      frontMatter: {
        章号: 1, 标题: '初露', 卷: 1, 视角: '林晚', 字数: 100,
        章定位: '推进', 钩子: '危机钩-强', 情绪定位: '铺垫',
      },
      body: '林晚运转功法，突破到练气四层。',
      summary: '林晚突破练气四层。',
      workspaceFiles: ['草稿-1.md', '细纲.md', '审稿.md'],
    })
    assert.equal(fr.ok, true, fr.error)

    // 6. next → 序6 起草第 2 章（P0-1 核心断言：不重抄第 1 章）
    s = await determineNextState(ctx)
    assert.equal(s.序, 6, `定稿后应仍序6，实际：${JSON.stringify(s)}`)
    assert.equal(s.dto.nextChapter, 2, '定稿第1章后 next 应推进到第2章，不应重抄第1章')
  } finally {
    await cache.close()
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(dbDir, { recursive: true, force: true })
  }
})
