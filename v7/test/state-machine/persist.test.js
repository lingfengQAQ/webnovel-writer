import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  persistRepair,
  persistCreateBook,
  persistDesignChanges,
  persistWorkContract,
  persistVolumeReview,
  persistDraftOutline,
} from '../../src/state-machine/persist.js'
import { makeGitBook, minimalCreateBookPayload, minimalWorkContract } from './_helper.js'
import { validateWorkContract } from '../../src/knowledge/contract.js'
import { designFixture } from '../knowledge/_design-fixture.js'
import { buildDesignChangePlan, validateDesignContent } from '../../src/knowledge/design.js'
import { CHAPTER_KNOWLEDGE_SNAPSHOT_PATH } from '../../src/knowledge/chapter.js'

async function tmpRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-persist-'))
  return { ctx: { repoPath: root }, root, cleanup: () => fs.rm(root, { recursive: true, force: true }) }
}
const read = (root, rel) => fs.readFile(path.join(root, rel), 'utf8')
const exec = promisify(execFile)

test('persistCreateBook（P0-2）→ git init + core.quotepath=false + .gitignore（书仓库工程化）', async () => {
  const { ctx, root, cleanup } = await tmpRepo()
  try {
    const r = await persistCreateBook(ctx, minimalCreateBookPayload({ book: { 书名: '测' } }))
    assert.equal(r.ok, true, r.error)
    const { stdout: inside } = await exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root })
    assert.equal(inside.trim(), 'true', '建书应 git init 出一个仓库')
    const { stdout: qp } = await exec('git', ['config', 'core.quotepath'], { cwd: root })
    assert.equal(qp.trim(), 'false', '应设 core.quotepath=false（spec quality §3.3）')
    const gi = await read(root, '.gitignore')
    assert.ok(gi.includes('.cache/') && gi.includes('工作区/'), '.gitignore 应 ignore .cache 与 工作区')
  } finally { await cleanup() }
})

test('persistCreateBook（P0-2）→ 已有 .gitignore 追加不覆盖', async () => {
  const { ctx, root, cleanup } = await tmpRepo()
  try {
    await fs.writeFile(path.join(root, '.gitignore'), 'node_modules/\n', 'utf8')
    const r = await persistCreateBook(ctx, minimalCreateBookPayload({ book: { 书名: '测' } }))
    assert.equal(r.ok, true, r.error)
    const gi = await read(root, '.gitignore')
    assert.ok(gi.includes('node_modules/'), '不应覆盖既有条目')
    assert.ok(gi.includes('.cache/') && gi.includes('工作区/'))
  } finally { await cleanup() }
})

test('persistDraftOutline（序6）→ 契约校验后原子写细纲与知识来源快照', async () => {
  const { ctx, root, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n',
  })
  try {
    const outline = '## 本章提案\n本章场景：拍卖会\n## 本章要写到的事\n林晚突破。\n'
    const r = await persistDraftOutline(ctx, { 细纲: outline })
    assert.equal(r.ok, true)
    assert.match(await read(root, '工作区/细纲.md'), /林晚突破/)
    const snapshot = JSON.parse(await read(root, CHAPTER_KNOWLEDGE_SNAPSHOT_PATH))
    assert.equal(snapshot.schemaVersion, 1)
    assert.match(snapshot.outlineSha256, /^[0-9a-f]{64}$/)
    assert.ok(snapshot.知识选择.some((item) =>
      /^场景｜拍卖会｜场景\/.+@sha256:[0-9a-f]{64}$/.test(item)
    ))
  } finally { await cleanup() }
})

test('persistDraftOutline：作品契约缺失或损坏时细纲与快照零写入', async () => {
  const cases = [
    { name: '缺失', options: { includeContract: false }, contract: null },
    { name: '损坏', options: {}, contract: '---\n类型: 玄幻\n---\n坏契约' },
  ]
  for (const item of cases) {
    const files = {
      'book.yaml': 'spec_version: "7.0"\n书名: 测\n',
      '工作区/细纲.md': '原细纲。',
      [CHAPTER_KNOWLEDGE_SNAPSHOT_PATH]: '原快照。',
      ...(item.contract ? { '作品契约/作品契约.md': item.contract } : {}),
    }
    const { ctx, root, cleanup } = await makeGitBook(files, item.options)
    try {
      const result = await persistDraftOutline(ctx, { 细纲: `${item.name}时不应落盘。` })
      assert.equal(result.ok, false)
      assert.deepEqual(result.written, [])
      assert.match(result.error, /起草细纲停止：作品契约/)
      assert.equal(await read(root, '工作区/细纲.md'), '原细纲。')
      assert.equal(await read(root, CHAPTER_KNOWLEDGE_SNAPSHOT_PATH), '原快照。')
    } finally {
      await cleanup()
    }
  }
})

test('persistCreateBook（序1）→ 写 book.yaml + 总纲 + 第一卷卷纲', async () => {
  const { ctx, root, cleanup } = await tmpRepo()
  try {
    const r = await persistCreateBook(ctx, minimalCreateBookPayload({
      book: { 书名: '剑起青云' },
      总纲: '# 总纲\n主角逆袭。',
      卷纲: '# 第1卷\n入门。',
    }))
    assert.equal(r.ok, true)
    assert.match(await read(root, 'book.yaml'), /剑起青云/)
    assert.match(await read(root, '大纲/总纲.md'), /逆袭/)
    assert.match(await read(root, '大纲/卷纲/第01卷.md'), /入门/)
    assert.match(await read(root, '作品契约/作品契约.md'), /## 核心读者承诺/)
    assert.match(await read(root, '作品契约/知识选择记录.md'), /题材：玄幻/)
  } finally { await cleanup() }
})

test('persistWorkContract：提交失败时三份源文件精确回滚', async () => {
  const oldContract = minimalWorkContract()
  const { ctx, root, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n类型: 玄幻\n副题材:\n流派:\n',
    '作品契约/作品契约.md': oldContract,
    '作品契约/知识选择记录.md': '# 知识选择记录\n\n旧记录。\n',
  })
  try {
    const nextContract = minimalWorkContract({ version: 2, effectiveChapter: 1 })
    const parsed = validateWorkContract(nextContract)
    const realGit = (await import('../../src/finalize/git.js')).createGit(root)
    const failingGit = {
      ...realGit,
      async commit() { throw new Error('测试提交失败') },
    }
    const result = await persistWorkContract(
      ctx,
      {
        book: { spec_version: '7.0', 书名: '测', 类型: '玄幻', 副题材: [], 流派: [] },
        作品契约: nextContract,
        contract: parsed.data,
        selections: [{ 维度: '题材', 名称: '玄幻', 来源: '作者自定义' }],
      },
      { git: failingGit }
    )
    assert.equal(result.ok, false)
    assert.equal((await read(root, '作品契约/作品契约.md')).replaceAll('\r\n', '\n'), oldContract)
    assert.equal(
      (await read(root, '作品契约/知识选择记录.md')).replaceAll('\r\n', '\n'),
      '# 知识选择记录\n\n旧记录。\n'
    )
    const { stdout } = await exec('git', ['status', '--porcelain'], { cwd: root })
    assert.equal(stdout.trim(), '')
  } finally { await cleanup() }
})

test('persistDesignChanges：改名提交失败时旧计划恢复、新路径清除', async () => {
  const oldPath = '大纲/创作设计/人物/CHAR-001-林晚.md'
  const oldContent = designFixture()
  const { ctx, root, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n',
    [oldPath]: oldContent,
  })
  try {
    const existing = {
      ...validateDesignContent(oldContent, { classification: '人物' }).data,
      path: oldPath,
    }
    const nextContent = designFixture({ canonical: '林晚舟' })
    const next = validateDesignContent(nextContent, { classification: '人物' }).data
    const plan = buildDesignChangePlan([existing], [next], [], [])
    const realGit = (await import('../../src/finalize/git.js')).createGit(root)
    const result = await persistDesignChanges(ctx, plan, {
      git: { ...realGit, async commit() { throw new Error('测试提交失败') } },
    })
    assert.equal(result.ok, false)
    assert.equal((await read(root, oldPath)).replaceAll('\r\n', '\n'), oldContent)
    await assert.rejects(() => read(root, next.path))
    const { stdout } = await exec('git', ['status', '--porcelain'], { cwd: root })
    assert.equal(stdout.trim(), '')
  } finally {
    await cleanup()
  }
})

test('persistVolumeReview（序4）→ 写卷摘要 + 下卷卷纲 + vol commit（P1-1）', async () => {
  const { ctx, root, git, cleanup } = await makeGitBook({ 'book.yaml': 'spec_version: "7.0"\n书名: 测\n' })
  try {
    const r = await persistVolumeReview(ctx, { 卷号: 1, 卷摘要: '第一卷收束。', 下卷卷纲: '# 第2卷\n新地图。' })
    assert.equal(r.ok, true, r.error)
    assert.match(await read(root, '定稿/摘要/卷摘要/第01卷.md'), /收束/)
    assert.match(await read(root, '大纲/卷纲/第02卷.md'), /新地图/)
    const { stdout } = await git(['log', '-1', '--format=%s'])
    assert.match(stdout.trim(), /^vol\(01\): /, '复盘产物应随手 commit（否则 next 误触序2）')
  } finally { await cleanup() }
})

test('persistVolumeReview（序4）：作品契约缺失或损坏时零写入、零提交', async () => {
  const cases = [
    {
      name: '缺失',
      files: {
        'book.yaml': 'spec_version: "7.0"\n书名: 测\n',
        '文风/题材流派指导.md': '旧路径内容。',
      },
      options: { includeContract: false },
      error: /作品契约.*不存在/,
    },
    {
      name: '损坏',
      files: {
        'book.yaml': 'spec_version: "7.0"\n书名: 测\n',
        '作品契约/作品契约.md': '---\n类型: 玄幻\n---\n坏契约',
      },
      options: {},
      error: /作品契约结构不完整/,
    },
  ]
  for (const item of cases) {
    const { ctx, root, git, cleanup } = await makeGitBook(item.files, item.options)
    try {
      const { stdout: before } = await git(['rev-list', '--count', 'HEAD'])
      const result = await persistVolumeReview(ctx, {
        卷号: 1,
        卷摘要: `${item.name}契约不应写入。`,
        下卷卷纲: '# 第2卷\n不应写入。',
      })
      assert.equal(result.ok, false)
      assert.deepEqual(result.written, [])
      assert.match(result.error, item.error)
      await assert.rejects(() => read(root, '定稿/摘要/卷摘要/第01卷.md'))
      await assert.rejects(() => read(root, '大纲/卷纲/第02卷.md'))
      const { stdout: after } = await git(['rev-list', '--count', 'HEAD'])
      assert.equal(after.trim(), before.trim(), `${item.name}契约不得产生 commit`)
    } finally {
      await cleanup()
    }
  }
})

test('persistRepair（序0）→ 仅写失败清单内的文件,内容须能解析', async () => {
  const { ctx, root, cleanup } = await tmpRepo()
  try {
    const target = '定稿/正文/0001-起.md'
    await fs.mkdir(path.join(root, '定稿/正文'), { recursive: true })
    await fs.writeFile(path.join(root, target), '---\n坏: yaml: :\n---\n正文', 'utf8')
    const good = '---\n章号: 1\n标题: 起\n---\n正文'
    const r = await persistRepair(ctx, { repairs: [{ file: target, content: good }] }, { allowedFiles: [target] })
    assert.equal(r.ok, true)
    assert.deepEqual(r.written, [target])
    assert.match(await read(root, target), /章号: 1/)
  } finally { await cleanup() }
})

test('persistRepair：拒绝写不在失败清单内的文件（安全网,防 AI 任意写）', async () => {
  const { ctx, root, cleanup } = await tmpRepo()
  try {
    const r = await persistRepair(
      ctx,
      { repairs: [{ file: '定稿/正文/9999-注入.md', content: '---\n章号: 9\n---\nx' }] },
      { allowedFiles: ['定稿/正文/0001-起.md'] }
    )
    assert.equal(r.ok, false)
    await assert.rejects(() => read(root, '定稿/正文/9999-注入.md'))
  } finally { await cleanup() }
})

test('persistRepair：修复内容仍解析失败 → ok=false 不写', async () => {
  const { ctx, root, cleanup } = await tmpRepo()
  try {
    const target = '定稿/正文/0001-起.md'
    const r = await persistRepair(
      ctx,
      { repairs: [{ file: target, content: '---\n仍坏: : :\n---\nx' }] },
      { allowedFiles: [target] }
    )
    assert.equal(r.ok, false)
  } finally { await cleanup() }
})

// R3：book.yaml / 名册 / 时间线不是 front matter 文件，校验必须按类型分派，
// 否则合法修复被「缺少 front matter 分隔符」拒收，书锁死在序 0。
test('persistRepair：book.yaml 的合法修复被接受（纯 YAML，无 --- 围栏）', async () => {
  const { ctx, root, cleanup } = await tmpRepo()
  try {
    const good = 'spec_version: "7.0"\n书名: 测试书\n类型: 玄幻\n每章目标字数: 3000\n卷规模: 40\n'
    const r = await persistRepair(
      ctx,
      { repairs: [{ file: 'book.yaml', content: good }] },
      { allowedFiles: ['book.yaml'] }
    )
    assert.equal(r.ok, true, r.error)
    assert.match(await read(root, 'book.yaml'), /书名: 测试书/)
  } finally { await cleanup() }
})

test('persistRepair：名册/时间线的合法修复被接受（纯表格）', async () => {
  const { ctx, root, cleanup } = await tmpRepo()
  try {
    const roster = '| 正名 | 别名 | 类型 | 首现章 |\n|---|---|---|---|\n| 林晚 |  | 角色 | 1 |\n'
    const timeline = '| 章 | 书内时间 | 一句话事件 | 在场 |\n|---|---|---|---|\n| 1 | 春月初一 | 开局 | 林晚 |\n'
    const r = await persistRepair(
      ctx,
      {
        repairs: [
          { file: '定稿/设定/名册.md', content: roster },
          { file: '定稿/设定/时间线/第01卷.md', content: timeline },
        ],
      },
      { allowedFiles: ['定稿/设定/名册.md', '定稿/设定/时间线/第01卷.md'] }
    )
    assert.equal(r.ok, true, r.error)
    assert.match(await read(root, '定稿/设定/名册.md'), /林晚/)
    assert.match(await read(root, '定稿/设定/时间线/第01卷.md'), /春月初一/)
  } finally { await cleanup() }
})

test('persistRepair：名册修复内容仍是坏表格 → ok=false 不写', async () => {
  const { ctx, cleanup } = await tmpRepo()
  try {
    const r = await persistRepair(
      ctx,
      { repairs: [{ file: '定稿/设定/名册.md', content: '不是表格的东西\n' }] },
      { allowedFiles: ['定稿/设定/名册.md'] }
    )
    assert.equal(r.ok, false)
    assert.match(r.error, /名册/)
  } finally { await cleanup() }
})

test('persistRepair：计划对象按对象 schema 校验，不只检查普通 front matter', async () => {
  const { ctx, root, cleanup } = await tmpRepo()
  const target = '大纲/创作设计/人物/CHAR-001-林晚.md'
  try {
    const bad = await persistRepair(
      ctx,
      { repairs: [{ file: target, content: '---\nID: CHAR-001\n名称: 林晚\n---\n缺必需小节。' }] },
      { allowedFiles: [target] }
    )
    assert.equal(bad.ok, false)
    assert.match(bad.error, /本书设计|一致性边界/)

    const good = await persistRepair(
      ctx,
      { repairs: [{ file: target, content: designFixture() }] },
      { allowedFiles: [target] }
    )
    assert.equal(good.ok, true, good.error)
    assert.match(await read(root, target), /一致性边界/)
  } finally {
    await cleanup()
  }
})
