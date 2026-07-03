import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import {
  registerBook,
  setCurrentBook,
  touchLastOpened,
  readBooksRegistry,
  loadBooks,
} from '../../src/session/index.js'

async function tmpWorkdir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-reg-'))
  return { root, cleanup: () => fs.rm(root, { recursive: true, force: true }) }
}
async function writeRegistry(root, lines) {
  await fs.mkdir(path.join(root, '.webnovel'), { recursive: true })
  await fs.writeFile(path.join(root, '.webnovel', 'books.jsonl'), lines.join('\n') + '\n', 'utf8')
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

test('registerBook：空工作目录登记首本,置当前并带最后打开', async () => {
  const { root, cleanup } = await tmpWorkdir()
  try {
    const r = await registerBook(root, { 书名: '剑起青云', 目录: '剑起青云' })
    assert.equal(r.ok, true)
    const reg = await readBooksRegistry(root)
    assert.equal(reg.books.length, 1)
    assert.equal(reg.books[0].书名, '剑起青云')
    assert.equal(reg.books[0].当前, true)
    assert.match(reg.books[0].最后打开, DATE_RE)
  } finally {
    await cleanup()
  }
})

test('registerBook：新书置当前,旧当前退位', async () => {
  const { root, cleanup } = await tmpWorkdir()
  try {
    await writeRegistry(root, [JSON.stringify({ 书名: '星海', 目录: '星海', 当前: true })])
    const r = await registerBook(root, { 书名: '剑起青云', 目录: '剑起青云' })
    assert.equal(r.ok, true)
    const reg = await readBooksRegistry(root)
    assert.equal(reg.books.length, 2)
    assert.equal(reg.books.find((b) => b.书名 === '星海').当前, false)
    assert.equal(reg.books.find((b) => b.书名 === '剑起青云').当前, true)
  } finally {
    await cleanup()
  }
})

test('registerBook：同目录重复登记不产生重复行,书名更新', async () => {
  const { root, cleanup } = await tmpWorkdir()
  try {
    await writeRegistry(root, [JSON.stringify({ 书名: '旧名', 目录: '书目录', 当前: true })])
    const r = await registerBook(root, { 书名: '新名', 目录: '书目录' })
    assert.equal(r.ok, true)
    const reg = await readBooksRegistry(root)
    assert.equal(reg.books.length, 1)
    assert.equal(reg.books[0].书名, '新名')
  } finally {
    await cleanup()
  }
})

test('registerBook：缺书名/目录 → 人话错误', async () => {
  const { root, cleanup } = await tmpWorkdir()
  try {
    const r = await registerBook(root, { 书名: '', 目录: 'x' })
    assert.equal(r.ok, false)
    assert.ok(r.error.includes('书名'))
  } finally {
    await cleanup()
  }
})

test('setCurrentBook：按书名或目录命中,单一当前', async () => {
  const { root, cleanup } = await tmpWorkdir()
  try {
    await writeRegistry(root, [
      JSON.stringify({ 书名: '星海', 目录: 'xinghai', 当前: true }),
      JSON.stringify({ 书名: '剑起青云', 目录: 'jian', 当前: false }),
    ])
    const r = await setCurrentBook(root, '剑起青云')
    assert.equal(r.ok, true)
    assert.equal(r.book.目录, 'jian')
    const reg = await readBooksRegistry(root)
    assert.equal(reg.books.filter((b) => b.当前).length, 1)
    assert.equal(reg.books.find((b) => b.当前).书名, '剑起青云')
    // 按目录名也可命中
    const r2 = await setCurrentBook(root, 'xinghai')
    assert.equal(r2.ok, true)
    assert.equal(r2.book.书名, '星海')
  } finally {
    await cleanup()
  }
})

test('setCurrentBook：未命中 → 列候选', async () => {
  const { root, cleanup } = await tmpWorkdir()
  try {
    await writeRegistry(root, [JSON.stringify({ 书名: '星海', 目录: '星海', 当前: true })])
    const r = await setCurrentBook(root, '不存在的书')
    assert.equal(r.ok, false)
    assert.ok(r.error.includes('星海'), `候选应包含书名：${r.error}`)
  } finally {
    await cleanup()
  }
})

test('touchLastOpened：刷新最后打开,不改其他字段', async () => {
  const { root, cleanup } = await tmpWorkdir()
  try {
    await writeRegistry(root, [
      JSON.stringify({ 书名: '星海', 目录: '星海', 当前: true, 最后打开: '2000-01-01' }),
    ])
    await touchLastOpened(root, '星海')
    const reg = await readBooksRegistry(root)
    assert.notEqual(reg.books[0].最后打开, '2000-01-01')
    assert.match(reg.books[0].最后打开, DATE_RE)
    assert.equal(reg.books[0].当前, true)
  } finally {
    await cleanup()
  }
})

test('loadBooks：坏行丢弃回写自愈（与 assembleSessionContext 同源）', async () => {
  const { root, cleanup } = await tmpWorkdir()
  try {
    await writeRegistry(root, [
      JSON.stringify({ 书名: '星海', 目录: '星海', 当前: true }),
      '{坏的 json',
    ])
    const r = await loadBooks(root)
    assert.equal(r.books.length, 1)
    const raw = await fs.readFile(path.join(root, '.webnovel', 'books.jsonl'), 'utf8')
    assert.ok(!raw.includes('坏的'), '坏行应被自愈回写清除')
  } finally {
    await cleanup()
  }
})
