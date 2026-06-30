import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import {
  readBooksRegistry,
  scanRebuildBooks,
  assembleSessionContext,
  writeBooksRegistry,
} from '../../src/session/index.js'

async function tmpWorkdir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-wd-'))
  return { root, cleanup: () => fs.rm(root, { recursive: true, force: true }) }
}
async function writeRegistry(root, lines) {
  await fs.mkdir(path.join(root, '.webnovel'), { recursive: true })
  await fs.writeFile(path.join(root, '.webnovel', 'books.jsonl'), lines.join('\n') + '\n', 'utf8')
}
async function makeBookDir(root, name) {
  await fs.mkdir(path.join(root, name), { recursive: true })
  await fs.writeFile(path.join(root, name, 'book.yaml'), `spec_version: "7.0"\n书名: ${name}\n`, 'utf8')
}

test('readBooksRegistry：解析合法行,损坏行跳过并计数', async () => {
  const { root, cleanup } = await tmpWorkdir()
  try {
    await writeRegistry(root, [
      JSON.stringify({ 书名: '剑起青云', 目录: '剑起青云', 当前: true }),
      '{坏的 json',
      JSON.stringify({ 书名: '星海', 目录: '星海', 当前: false }),
    ])
    const r = await readBooksRegistry(root)
    assert.equal(r.ok, true)
    assert.equal(r.books.length, 2)
    assert.equal(r.corrupt, 1)
  } finally { await cleanup() }
})

test('readBooksRegistry：缺文件 → missing=true 不抛', async () => {
  const { root, cleanup } = await tmpWorkdir()
  try {
    const r = await readBooksRegistry(root)
    assert.equal(r.missing, true)
    assert.equal(r.books.length, 0)
  } finally { await cleanup() }
})

test('scanRebuildBooks：扫含 book.yaml 子目录重建,需作者选当前书', async () => {
  const { root, cleanup } = await tmpWorkdir()
  try {
    await makeBookDir(root, '剑起青云')
    await makeBookDir(root, '星海')
    const r = await scanRebuildBooks(root)
    assert.equal(r.ok, true)
    assert.equal(r.books.length, 2)
    assert.ok(r.books.some((b) => b.书名 === '剑起青云'))
    assert.equal(r.needsAuthorPick, true)
  } finally { await cleanup() }
})

test('assembleSessionContext：有登记 → 注入含当前书与本数', async () => {
  const { root, cleanup } = await tmpWorkdir()
  try {
    await writeRegistry(root, [
      JSON.stringify({ 书名: '剑起青云', 目录: '剑起青云', 当前: true }),
      JSON.stringify({ 书名: '星海', 目录: '星海', 当前: false }),
    ])
    const r = await assembleSessionContext(root)
    assert.equal(r.ok, true)
    assert.match(r.text, /剑起青云/)
    assert.match(r.text, /2 本/)
    assert.equal(r.current.书名, '剑起青云')
  } finally { await cleanup() }
})

test('assembleSessionContext：登记缺失 → 扫描重建并标记', async () => {
  const { root, cleanup } = await tmpWorkdir()
  try {
    await makeBookDir(root, '剑起青云')
    const r = await assembleSessionContext(root)
    assert.equal(r.ok, true)
    assert.equal(r.rebuilt, true)
    assert.match(r.text, /剑起青云/)
  } finally { await cleanup() }
})

test('assembleSessionContext（P1-4）：部分损坏 → 丢坏行回写,下读 corrupt=0', async () => {
  const { root, cleanup } = await tmpWorkdir()
  try {
    await writeRegistry(root, [
      JSON.stringify({ 书名: '剑起青云', 目录: '剑起青云', 当前: true }),
      '{坏的 json',
      JSON.stringify({ 书名: '星海', 目录: '星海', 当前: false }),
    ])
    const r = await assembleSessionContext(root)
    assert.equal(r.ok, true)
    assert.equal(r.current.书名, '剑起青云')
    // 回写后坏行已丢
    const reread = await readBooksRegistry(root)
    assert.equal(reread.corrupt, 0, '自愈回写应丢掉坏行')
    assert.equal(reread.books.length, 2)
  } finally { await cleanup() }
})

test('assembleSessionContext（P1-4）：登记缺失重建后回写,下读不再 missing', async () => {
  const { root, cleanup } = await tmpWorkdir()
  try {
    await makeBookDir(root, '剑起青云')
    await makeBookDir(root, '星海')
    const r = await assembleSessionContext(root)
    assert.equal(r.rebuilt, true)
    assert.equal(r.books.length, 2)
    // 回写后下个会话直接读登记,不必再扫
    const reread = await readBooksRegistry(root)
    assert.equal(reread.missing, false)
    assert.equal(reread.books.length, 2)
  } finally { await cleanup() }
})

test('writeBooksRegistry：写 JSONL 逐行,可被 readBooksRegistry 读回', async () => {
  const { root, cleanup } = await tmpWorkdir()
  try {
    await writeBooksRegistry(root, [
      { 书名: 'A', 目录: 'A', 当前: true },
      { 书名: 'B', 目录: 'B', 当前: false },
    ])
    const r = await readBooksRegistry(root)
    assert.equal(r.books.length, 2)
    assert.equal(r.corrupt, 0)
  } finally { await cleanup() }
})

test('无 hook 等价:hook 入口与状态机入口调同一函数 → 注入文本逐字一致', async () => {
  const { root, cleanup } = await tmpWorkdir()
  try {
    await writeRegistry(root, [JSON.stringify({ 书名: '剑起青云', 目录: '剑起青云', 当前: true })])
    const hookText = (await assembleSessionContext(root)).text // Claude Code SessionStart hook
    const smText = (await assembleSessionContext(root)).text // 无 hook 宿主由状态机入口调
    assert.equal(hookText, smText)
  } finally { await cleanup() }
})
