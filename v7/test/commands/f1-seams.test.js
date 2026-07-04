import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { makeGitBook, chapter } from '../state-machine/_helper.js'
import { run as nextRun } from '../../src/commands/next.js'
import { run as persistOutline } from '../../src/commands/persist-outline.js'
import { run as persistVolumeReview } from '../../src/commands/persist-volume-review.js'
import { run as persistRepair } from '../../src/commands/persist-repair.js'
import { run as persistBook } from '../../src/commands/persist-book.js'
import { run as reviewInput } from '../../src/commands/review-input.js'
import { run as saveReview } from '../../src/commands/save-review.js'
import { run as finalizeCmd } from '../../src/commands/finalize.js'
import { readBooksRegistry } from '../../src/session/index.js'

const BOOK = 'spec_version: "7.0"\n书名: 测\n卷规模: 40\n体检周期: 50\n'

async function jsonFile(dir, name, data) {
  const p = path.join(dir, name)
  await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf8')
  return p
}

test('next --json：输出完整状态机 DTO（F1 C1）', async () => {
  const { ctx, cleanup } = await makeGitBook({ 'book.yaml': BOOK, '定稿/正文/0001-起.md': chapter(1) })
  try {
    const r = await nextRun([], { json: true }, ctx)
    assert.equal(r.ok, true)
    const dto = JSON.parse(r.output)
    for (const key of ['ok', 'gitHealth', '序', 'state', 'needsAI', 'message', 'dto']) {
      assert.ok(key in dto, `缺字段 ${key}`)
    }
    assert.equal(typeof dto.序, 'number')
    // 缺省输出仍是人读
    const human = await nextRun([], {}, ctx)
    assert.ok(human.output.includes('【当前状态】'))
  } finally {
    await cleanup()
  }
})

test('persist-outline：--file 落细纲;缺文件/坏 JSON/缺字段人话报错', async () => {
  const { root, ctx, cleanup } = await makeGitBook({ 'book.yaml': BOOK })
  try {
    const p = await jsonFile(os.tmpdir(), `wnw-ol-${process.pid}.json`, { 细纲: '## 本章要写到的事\n突破。' })
    const r = await persistOutline([], { file: p }, ctx)
    assert.equal(r.ok, true)
    const content = await fs.readFile(path.join(root, '工作区', '细纲.md'), 'utf8')
    assert.ok(content.includes('突破'))

    const miss = await persistOutline([], {}, ctx)
    assert.equal(miss.ok, false)
    assert.ok(miss.error.includes('--file'))

    const gone = await persistOutline([], { file: path.join(os.tmpdir(), '不存在.json') }, ctx)
    assert.equal(gone.ok, false)
    assert.ok(gone.error.includes('读不到'))

    const badPath = path.join(os.tmpdir(), `wnw-bad-${process.pid}.json`)
    await fs.writeFile(badPath, '{坏的', 'utf8')
    const bad = await persistOutline([], { file: badPath }, ctx)
    assert.equal(bad.ok, false)
    assert.ok(bad.error.includes('JSON'))

    const empty = await jsonFile(os.tmpdir(), `wnw-empty-${process.pid}.json`, {})
    const noField = await persistOutline([], { file: empty }, ctx)
    assert.equal(noField.ok, false)
    assert.ok(noField.error.includes('细纲'))
  } finally {
    await cleanup()
  }
})

test('persist-volume-review：卷摘要+下卷卷纲落盘;坏卷号报错', async () => {
  const { root, ctx, cleanup } = await makeGitBook({ 'book.yaml': BOOK })
  try {
    const p = await jsonFile(os.tmpdir(), `wnw-vr-${process.pid}.json`, {
      卷号: 1,
      卷摘要: '# 第一卷\n入门完毕。',
      下卷卷纲: '# 第2卷\n出山。',
    })
    const r = await persistVolumeReview([], { file: p }, ctx)
    assert.equal(r.ok, true)
    await fs.access(path.join(root, '定稿', '摘要', '卷摘要', '第01卷.md'))
    await fs.access(path.join(root, '大纲', '卷纲', '第02卷.md'))

    const bad = await jsonFile(os.tmpdir(), `wnw-vr-bad-${process.pid}.json`, { 卷号: 0, 卷摘要: 'x' })
    const rb = await persistVolumeReview([], { file: bad }, ctx)
    assert.equal(rb.ok, false)
    assert.ok(rb.error.includes('卷号'))
  } finally {
    await cleanup()
  }
})

test('persist-repair：修检测失败清单内文件;清单外拒绝', async () => {
  const { root, ctx, cleanup } = await makeGitBook({ 'book.yaml': BOOK })
  try {
    // 造一个解析失败的伏笔条目（检测后进入 allowedFiles）
    const brokenRel = '大纲/伏笔/伏笔-001-试.md'
    await fs.mkdir(path.join(root, '大纲', '伏笔'), { recursive: true })
    await fs.writeFile(path.join(root, brokenRel), '---\na: [未闭合\n---\n正文', 'utf8')

    const fixed = '---\nid: 伏笔-001\n短题: 试\n状态: 进行\n---\n正文'
    const p = await jsonFile(os.tmpdir(), `wnw-rp-${process.pid}.json`, {
      repairs: [{ file: brokenRel, content: fixed }],
    })
    const r = await persistRepair([], { file: p }, ctx)
    assert.equal(r.ok, true, r.error)
    const after = await fs.readFile(path.join(root, brokenRel), 'utf8')
    assert.ok(after.includes('id: 伏笔-001'))

    // 清单外文件（book.yaml 好好的）→ 拒绝
    const evil = await jsonFile(os.tmpdir(), `wnw-rp-evil-${process.pid}.json`, {
      repairs: [{ file: 'book.yaml', content: '---\nx: 1\n---\n' }],
    })
    const re = await persistRepair([], { file: evil }, ctx)
    assert.equal(re.ok, false)
    assert.ok(re.error.includes('拒绝'))
  } finally {
    await cleanup()
  }
})

test('persist-book：工作目录模式建书+指路 AGENTS.md+登记置当前;同名防覆盖', async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-pb-'))
  try {
    await fs.mkdir(path.join(workdir, '.webnovel'), { recursive: true })
    const p = await jsonFile(os.tmpdir(), `wnw-pb-${process.pid}.json`, {
      book: { spec_version: '7.0', 书名: '剑起青云', 卷规模: 40 },
      总纲: '# 总纲\n## 结局\n登顶。',
      卷纲: '# 第1卷\n入门。',
    })
    const ctx = { workdir, repoPath: null }
    const r = await persistBook([], { file: p }, ctx)
    assert.equal(r.ok, true, r.error)
    const repo = path.join(workdir, '剑起青云')
    await fs.access(path.join(repo, 'book.yaml'))
    const agents = await fs.readFile(path.join(repo, 'AGENTS.md'), 'utf8')
    assert.ok(agents.includes('工作目录') && agents.includes('剑起青云'), '指路 AGENTS.md 应指回工作目录')
    const reg = await readBooksRegistry(workdir)
    assert.equal(reg.books.length, 1)
    assert.equal(reg.books[0].当前, true)

    // 同名再建 → 防覆盖
    const again = await persistBook([], { file: p }, ctx)
    assert.equal(again.ok, false)
    assert.ok(again.error.includes('不覆盖'))

    // 目录名不合法
    const badDir = await persistBook([], { file: p, dir: '../逃逸' }, ctx)
    assert.equal(badDir.ok, false)
    assert.ok(badDir.error.includes('不合法'))

    // 书名含 Windows 非法字符 → 前置拦截并指路 --dir（P2-4）
    const badName = await jsonFile(os.tmpdir(), `wnw-pb-bad-${process.pid}.json`, {
      book: { spec_version: '7.0', 书名: '冒险:开始' },
      总纲: '# 总纲\nx',
      卷纲: '# 第1卷\ny',
    })
    const rBad = await persistBook([], { file: badName }, ctx)
    assert.equal(rBad.ok, false)
    assert.ok(rBad.error.includes('--dir'), '报错应指路 --dir 而不是 mkdir 深处报天书')
    const rDir = await persistBook([], { file: badName, dir: '冒险开始' }, ctx)
    assert.equal(rDir.ok, true, rDir.error)
  } finally {
    await fs.rm(workdir, { recursive: true, force: true })
  }
})

test('persist-book：书仓库直启落 cwd,不登记（开发/测试兼容）', async () => {
  const { root, ctx, cleanup } = await makeGitBook({ 'book.yaml': BOOK })
  try {
    const p = await jsonFile(os.tmpdir(), `wnw-pb2-${process.pid}.json`, {
      book: { spec_version: '7.0', 书名: '测' },
      总纲: '# 总纲\nx',
      卷纲: '# 第1卷\ny',
    })
    const r = await persistBook([], { file: p }, ctx)
    assert.equal(r.ok, true, r.error)
    await fs.access(path.join(root, 'AGENTS.md'))
  } finally {
    await cleanup()
  }
})

const charCard = `---\n姓名: 林晚\n状态: 在世\n位置: 青云宗\n境界: 练气三层\n---\n## 设定\n玉佩线索。`

test('review-input：落 工作区/审稿输入.json（含草稿全文与章号）', async () => {
  const { root, ctx, cleanup } = await makeGitBook({
    'book.yaml': BOOK,
    '定稿/设定/角色/林晚.md': charCard,
    '工作区/草稿-A.md': '林晚握紧玉佩。',
  })
  try {
    const r = await reviewInput(['1'], {}, ctx)
    assert.equal(r.ok, true, r.error)
    const raw = await fs.readFile(path.join(root, '工作区', '审稿输入.json'), 'utf8')
    const input = JSON.parse(raw)
    assert.equal(input.章号, 1)
    assert.ok(input.草稿全文.includes('玉佩'))
    assert.ok(input.相关角色.some((c) => c.姓名 === '林晚' || c.正名 === '林晚'))

    const gone = await reviewInput(['1'], { draft: '工作区/没有.md' }, ctx)
    assert.equal(gone.ok, false)

    // --draft 传绝对路径也要能读（P2-2：resolve 而非 join）
    const abs = await reviewInput(['1'], { draft: path.join(root, '工作区', '草稿-A.md') }, ctx)
    assert.equal(abs.ok, true, abs.error)
  } finally {
    await cleanup()
  }
})

test('save-review：两审 JSON 入库落审稿单;schema 不过人话报错', async () => {
  const { root, ctx, cleanup } = await makeGitBook({
    'book.yaml': BOOK,
    '工作区/草稿-A.md': '林晚握紧玉佩。',
  })
  try {
    const good = await jsonFile(os.tmpdir(), `wnw-sr-${process.pid}.json`, {
      事实审查: { chapter: 1, issues: [] },
      编辑审: {
        chapter: 1,
        issues: [
          {
            severity: 'high',
            category: 'pacing',
            location: '第1段',
            description: '开头太平',
            evidence: '首段无钩子',
            fix_hint: '前移冲突',
            blocking: false,
          },
        ],
      },
      章摘要: '林晚得玉佩。',
    })
    const r = await saveReview(['1'], { file: good }, ctx)
    assert.equal(r.ok, true, r.error)
    assert.ok(r.output.includes('1 个问题'))
    const md = await fs.readFile(path.join(root, '工作区', '审稿.md'), 'utf8')
    assert.ok(md.includes('开头太平') && md.includes('林晚得玉佩'))
    await fs.access(path.join(root, '工作区', '评审报告', '事实审查.json'))

    const bad = await jsonFile(os.tmpdir(), `wnw-sr-bad-${process.pid}.json`, {
      事实审查: { chapter: 1, issues: [{ severity: '不存在的级别' }] },
      编辑审: { chapter: 1, issues: [] },
    })
    const rb = await saveReview(['1'], { file: bad }, ctx)
    assert.equal(rb.ok, false)
    assert.ok(rb.error.includes('schema'))

    const noDraft = await saveReview(['1'], { file: good, draft: '工作区/无.md' }, ctx)
    assert.equal(noDraft.ok, false)
    assert.ok(noDraft.error.includes('草稿'))

    // --draft 传绝对路径也要能读（P2-2：resolve 而非 join）
    const absDraft = await saveReview(
      ['1'],
      { file: good, draft: path.join(root, '工作区', '草稿-A.md') },
      ctx
    )
    assert.equal(absDraft.ok, true, absDraft.error)
  } finally {
    await cleanup()
  }
})

test('finalize：--payload 定稿入档 + commit;章号不一致防呆', async () => {
  const { root, ctx, cleanup } = await makeGitBook({
    'book.yaml': BOOK,
    '工作区/草稿-A.md': '林晚突破。',
  })
  try {
    const payload = await jsonFile(os.tmpdir(), `wnw-fz-${process.pid}.json`, {
      frontMatter: { 章号: 1, 标题: '突破', 卷: 1, 字数: 5, 章定位: '推进' },
      body: '林晚突破。',
      summary: '林晚突破练气四层。',
      commitLines: {},
      workspaceFiles: ['工作区/草稿-A.md'],
    })
    const r = await finalizeCmd(['1'], { payload }, ctx)
    assert.equal(r.ok, true, r.error)
    assert.ok(r.output.includes('已定稿'))
    await fs.access(path.join(root, '定稿', '正文', '0001-突破.md'))

    const mismatch = await jsonFile(os.tmpdir(), `wnw-fz-mm-${process.pid}.json`, {
      chapterNum: 2,
      frontMatter: { 章号: 2, 标题: 'x' },
    })
    const rm = await finalizeCmd(['1'], { payload: mismatch }, ctx)
    assert.equal(rm.ok, false)
    assert.ok(rm.error.includes('不一致'))
  } finally {
    await cleanup()
  }
})
