import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { run as listBooks } from '../../src/commands/list-books.js'
import { run as switchBook } from '../../src/commands/switch-book.js'
import { run as sessionContext } from '../../src/commands/session-context.js'
import { assembleSessionContext, readBooksRegistry } from '../../src/session/index.js'

async function tmpWorkdir(books = null) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-bkcmd-'))
  if (books) {
    await fs.mkdir(path.join(root, '.webnovel'), { recursive: true })
    await fs.writeFile(
      path.join(root, '.webnovel', 'books.jsonl'),
      books.map((b) => JSON.stringify(b)).join('\n') + '\n',
      'utf8'
    )
  }
  return { root, ctx: { workdir: root }, cleanup: () => fs.rm(root, { recursive: true, force: true }) }
}

test('list-books：列书单,当前书带标记', async () => {
  const { ctx, cleanup } = await tmpWorkdir([
    { 书名: '星海', 目录: '星海', 当前: true, 最后打开: '2026-07-01' },
    { 书名: '剑起青云', 目录: '剑起青云', 当前: false },
  ])
  try {
    const r = await listBooks([], {}, ctx)
    assert.equal(r.ok, true)
    assert.ok(r.output.includes('《星海》') && r.output.includes('《剑起青云》'))
    assert.ok(r.output.includes('2026-07-01'))
    const cur = r.output.split('\n').find((l) => l.startsWith('→'))
    assert.ok(cur.includes('星海'), '当前书行应带 → 标记')
  } finally {
    await cleanup()
  }
})

test('list-books：空书单 → 建书指引', async () => {
  const { root, ctx, cleanup } = await tmpWorkdir(null)
  try {
    await fs.mkdir(path.join(root, '.webnovel'), { recursive: true })
    const r = await listBooks([], {}, ctx)
    assert.equal(r.ok, true)
    assert.ok(r.output.includes('建书'))
  } finally {
    await cleanup()
  }
})

test('switch-book：换书改当前标记;缺参数人话报错', async () => {
  const { root, ctx, cleanup } = await tmpWorkdir([
    { 书名: '星海', 目录: '星海', 当前: true },
    { 书名: '剑起青云', 目录: '剑起青云', 当前: false },
  ])
  try {
    const bad = await switchBook([], {}, ctx)
    assert.equal(bad.ok, false)
    assert.ok(bad.error.includes('用法'))

    const r = await switchBook(['剑起青云'], {}, ctx)
    assert.equal(r.ok, true)
    assert.ok(r.output.includes('剑起青云'))
    const reg = await readBooksRegistry(root)
    assert.equal(reg.books.find((b) => b.当前).书名, '剑起青云')
  } finally {
    await cleanup()
  }
})

test('session-context：输出与 assembleSessionContext 逐字一致（两宿主入口等价）,并刷新最后打开', async () => {
  const { root, ctx, cleanup } = await tmpWorkdir([
    { 书名: '星海', 目录: '星海', 当前: true, 最后打开: '2000-01-01' },
  ])
  try {
    const expected = (await assembleSessionContext(root)).text
    const r = await sessionContext([], {}, ctx)
    assert.equal(r.ok, true)
    assert.equal(r.output, expected)
    const reg = await readBooksRegistry(root)
    assert.notEqual(reg.books[0].最后打开, '2000-01-01')
  } finally {
    await cleanup()
  }
})
