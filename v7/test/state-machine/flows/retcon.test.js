import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { retcon } from '../../../src/state-machine/flows/retcon.js'
import { makeGitBook } from '../_helper.js'

test('吃书 retcon：改设定 + retcon(N) commit + 留痕', async () => {
  const { ctx, root, git, cleanup } = await makeGitBook({
    'book.yaml': 'spec_version: "7.0"\n书名: 测\n',
    '定稿/设定/角色/林晚.md': '---\n姓名: 林晚\n境界: 练气三层\n---\n## 设定\n外门弟子。',
  })
  try {
    const r = await retcon(ctx, {
      chapterNum: 87,
      原因: '修正大长老境界设定',
      characterUpdates: [{ name: '林晚', updates: { 境界: '金丹初期' } }],
    })
    assert.equal(r.ok, true, r.error)
    const card = await fs.readFile(path.join(root, '定稿/设定/角色/林晚.md'), 'utf8')
    assert.match(card, /境界: 金丹初期/)
    const { stdout } = await git(['log', '--oneline'])
    assert.match(stdout, /retcon\(87\):/)
  } finally {
    await cleanup()
  }
})

test('吃书：缺原因 → ok=false（留痕要求）', async () => {
  const { ctx, cleanup } = await makeGitBook({ 'book.yaml': '书名: 测\n' })
  try {
    const r = await retcon(ctx, { chapterNum: 1, characterUpdates: [] })
    assert.equal(r.ok, false)
  } finally {
    await cleanup()
  }
})
