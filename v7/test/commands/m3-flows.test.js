import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run as impactRun } from '../../src/commands/impact.js'
import { run as gotoRun } from '../../src/commands/goto-chapter.js'
import { makeGitBook, chapter } from '../state-machine/_helper.js'

test('impact 命令：输出影响分析 JSON', async () => {
  const { ctx, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n已发布到章: 0\n',
    '定稿/正文/0001-起.md': chapter(1, '林晚得到玉佩。'),
  })
  try {
    const r = await impactRun(['玉佩'], {}, ctx)
    assert.equal(r.ok, true)
    const out = JSON.parse(r.output)
    assert.deepEqual(out.未发布, [1])
  } finally {
    await cleanup()
  }
})

test('goto-chapter 命令：不带 --confirm 只展示影响', async () => {
  const { ctx, cleanup } = await makeGitBook(
    { 'book.yaml': 'spec_version: "7.0"\n书名: 测\n' },
    {
      commits: [
        { message: 'ch(1): 起', files: { '定稿/正文/0001-起.md': chapter(1) } },
        { message: 'ch(2): 承', files: { '定稿/正文/0002-承.md': chapter(2) } },
      ],
    }
  )
  try {
    const r = await gotoRun(['1'], {}, ctx)
    assert.equal(r.ok, true)
    assert.match(r.output, /丢弃|ch\(2\)/)
  } finally {
    await cleanup()
  }
})

test('goto-chapter 命令：非数字章号 → ok=false', async () => {
  const { ctx, cleanup } = await makeGitBook({ 'book.yaml': '书名: 测\n' })
  try {
    const r = await gotoRun(['abc'], {}, ctx)
    assert.equal(r.ok, false)
  } finally {
    await cleanup()
  }
})
