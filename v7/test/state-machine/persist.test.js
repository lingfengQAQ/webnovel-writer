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
  persistVolumeReview,
  persistDraftOutline,
} from '../../src/state-machine/persist.js'

async function tmpRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-persist-'))
  return { ctx: { repoPath: root }, root, cleanup: () => fs.rm(root, { recursive: true, force: true }) }
}
const read = (root, rel) => fs.readFile(path.join(root, rel), 'utf8')
const exec = promisify(execFile)

test('persistCreateBook（P0-2）→ git init + core.quotepath=false + .gitignore（书仓库工程化）', async () => {
  const { ctx, root, cleanup } = await tmpRepo()
  try {
    const r = await persistCreateBook(ctx, {
      book: { spec_version: '7.0', 书名: '测' },
      总纲: '# 总纲',
      卷纲: '# 第1卷',
    })
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
    const r = await persistCreateBook(ctx, { book: { 书名: '测' }, 总纲: '# 总纲', 卷纲: '# 第1卷' })
    assert.equal(r.ok, true, r.error)
    const gi = await read(root, '.gitignore')
    assert.ok(gi.includes('node_modules/'), '不应覆盖既有条目')
    assert.ok(gi.includes('.cache/') && gi.includes('工作区/'))
  } finally { await cleanup() }
})

test('persistDraftOutline（序6）→ 写 工作区/细纲.md', async () => {
  const { ctx, root, cleanup } = await tmpRepo()
  try {
    const r = await persistDraftOutline(ctx, { 细纲: '## 本章要写到的事\n林晚突破。\n' })
    assert.equal(r.ok, true)
    assert.match(await read(root, '工作区/细纲.md'), /林晚突破/)
  } finally { await cleanup() }
})

test('persistCreateBook（序1）→ 写 book.yaml + 总纲 + 第一卷卷纲', async () => {
  const { ctx, root, cleanup } = await tmpRepo()
  try {
    const r = await persistCreateBook(ctx, {
      book: { spec_version: '7.0', 书名: '剑起青云', 题材: '仙侠' },
      总纲: '# 总纲\n主角逆袭。',
      卷纲: '# 第1卷\n入门。',
    })
    assert.equal(r.ok, true)
    assert.match(await read(root, 'book.yaml'), /剑起青云/)
    assert.match(await read(root, '大纲/总纲.md'), /逆袭/)
    assert.match(await read(root, '大纲/卷纲/第01卷.md'), /入门/)
  } finally { await cleanup() }
})

test('persistVolumeReview（序4）→ 写卷摘要 + 下卷卷纲', async () => {
  const { ctx, root, cleanup } = await tmpRepo()
  try {
    const r = await persistVolumeReview(ctx, { 卷号: 1, 卷摘要: '第一卷收束。', 下卷卷纲: '# 第2卷\n新地图。' })
    assert.equal(r.ok, true)
    assert.match(await read(root, '定稿/摘要/卷摘要/第01卷.md'), /收束/)
    assert.match(await read(root, '大纲/卷纲/第02卷.md'), /新地图/)
  } finally { await cleanup() }
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
