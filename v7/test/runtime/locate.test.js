import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { resolveRunContext } from '../../src/runtime/locate.js'

async function tmpDir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-loc-'))
  return { root, cleanup: () => fs.rm(root, { recursive: true, force: true }) }
}
async function makeWorkdir(root, books = []) {
  await fs.mkdir(path.join(root, '.webnovel'), { recursive: true })
  await fs.writeFile(
    path.join(root, '.webnovel', 'books.jsonl'),
    books.map((b) => JSON.stringify(b)).join('\n') + '\n',
    'utf8'
  )
}
async function makeBook(root, name) {
  await fs.mkdir(path.join(root, name), { recursive: true })
  await fs.writeFile(path.join(root, name, 'book.yaml'), `spec_version: "7.0"\n书名: ${name}\n`, 'utf8')
}

test('locate：cwd 含 book.yaml → 书仓库直启（兼容开发/测试）', async () => {
  const { root, cleanup } = await tmpDir()
  try {
    await fs.writeFile(path.join(root, 'book.yaml'), '书名: 测\n', 'utf8')
    const p = await resolveRunContext(root)
    assert.equal(p.mode, 'book')
    assert.equal(p.repoPath, root)
  } finally {
    await cleanup()
  }
})

test('locate：工作目录 + 当前书 → workdir-book,repoPath 指向书目录', async () => {
  const { root, cleanup } = await tmpDir()
  try {
    await makeBook(root, '剑起青云')
    await makeWorkdir(root, [{ 书名: '剑起青云', 目录: '剑起青云', 当前: true }])
    const p = await resolveRunContext(root)
    assert.equal(p.mode, 'workdir-book')
    assert.equal(p.repoPath, path.join(root, '剑起青云'))
    assert.equal(p.book.书名, '剑起青云')
  } finally {
    await cleanup()
  }
})

test('locate：工作目录无任何书 → workdir-no-book + 建书指引', async () => {
  const { root, cleanup } = await tmpDir()
  try {
    await makeWorkdir(root, [])
    const p = await resolveRunContext(root)
    assert.equal(p.mode, 'workdir-no-book')
    assert.ok(p.message.includes('建书'))
  } finally {
    await cleanup()
  }
})

test('locate：有书但未选当前 → workdir-no-book + 候选与 switch-book 指引', async () => {
  const { root, cleanup } = await tmpDir()
  try {
    await makeBook(root, '星海')
    await makeWorkdir(root, [{ 书名: '星海', 目录: '星海', 当前: false }])
    const p = await resolveRunContext(root)
    assert.equal(p.mode, 'workdir-no-book')
    assert.ok(p.message.includes('星海') && p.message.includes('switch-book'))
  } finally {
    await cleanup()
  }
})

test('locate：登记的当前书目录缺 book.yaml → workdir-no-book + 核对指引', async () => {
  const { root, cleanup } = await tmpDir()
  try {
    await makeWorkdir(root, [{ 书名: '幽灵书', 目录: '不存在', 当前: true }])
    const p = await resolveRunContext(root)
    assert.equal(p.mode, 'workdir-no-book')
    assert.ok(p.message.includes('幽灵书'))
  } finally {
    await cleanup()
  }
})

test('locate：既非工作目录也非书仓库 → error 人话提示', async () => {
  const { root, cleanup } = await tmpDir()
  try {
    const p = await resolveRunContext(root)
    assert.equal(p.mode, 'error')
    assert.ok(p.message.includes('工作目录'))
    assert.ok(!/[A-Za-z]:\\/.test(p.message), '不暴露绝对路径')
  } finally {
    await cleanup()
  }
})

test('locate：scope=workdir 在非工作目录 → error;在工作目录 → workdir', async () => {
  const { root, cleanup } = await tmpDir()
  try {
    assert.equal((await resolveRunContext(root, { scope: 'workdir' })).mode, 'error')
    await makeWorkdir(root, [])
    const p = await resolveRunContext(root, { scope: 'workdir' })
    assert.equal(p.mode, 'workdir')
    assert.equal(p.workdir, root)
  } finally {
    await cleanup()
  }
})

test('locate：scope=workdir-or-book 书仓库优先,退而工作目录', async () => {
  const a = await tmpDir()
  const b = await tmpDir()
  try {
    await fs.writeFile(path.join(a.root, 'book.yaml'), '书名: 测\n', 'utf8')
    assert.equal((await resolveRunContext(a.root, { scope: 'workdir-or-book' })).mode, 'book')
    await makeWorkdir(b.root, [])
    assert.equal((await resolveRunContext(b.root, { scope: 'workdir-or-book' })).mode, 'workdir')
    const empty = await tmpDir()
    try {
      assert.equal((await resolveRunContext(empty.root, { scope: 'workdir-or-book' })).mode, 'error')
    } finally {
      await empty.cleanup()
    }
  } finally {
    await a.cleanup()
    await b.cleanup()
  }
})

test('locate：scope=anywhere 直接给 workdir（init 装出 .webnovel 之前就要能跑）', async () => {
  const { root, cleanup } = await tmpDir()
  try {
    const p = await resolveRunContext(root, { scope: 'anywhere' })
    assert.equal(p.mode, 'workdir')
    assert.equal(p.workdir, root)
  } finally {
    await cleanup()
  }
})
