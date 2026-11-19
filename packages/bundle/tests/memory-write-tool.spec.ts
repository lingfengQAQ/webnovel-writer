import { afterAll, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { paths, preparePack, serializeDocument } from '@webnovel/core'
import { createNovelTools } from '../src/novel-tools'

const roots: string[] = []
const root = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-tool-')); roots.push(dir); return dir }
afterAll(() => { for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true }) })
const data = { 操作: '新增', 名称: '范围选择', 描述: '未来采用何种视角', 类: '文风', 来源: '对谈', 正文: '采用主角限知视角。' }
function fixture() {
  const ws = root()
  const tool = createNovelTools({ workspaceRoot: () => ws, bookRootOfBookId: id => path.join(ws, id) }).find(item => item.name === 'novel_record_memory')!
  return { ws, call: async (args: Record<string, unknown>) => await tool.execute(args) as Record<string, unknown>, tool }
}
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
function initBook(dir: string) {
  fs.mkdirSync(dir)
  git(dir, 'init', '--quiet'); git(dir, 'config', 'user.name', 'Memory fixture'); git(dir, 'config', 'user.email', 'memory@example.test')
  fs.writeFileSync(path.join(dir, 'seed.md'), 'fixture')
  git(dir, 'add', 'seed.md'); git(dir, 'commit', '--quiet', '-m', 'fixture')
}

describe('记忆工具范围与更新', () => {
  it('工具 schema 为宿主支持的对象；非法组合在 IO 前拒绝', async () => {
    const workspaceRoot = vi.fn(() => undefined)
    const tool = createNovelTools({ workspaceRoot, bookRootOfBookId: () => undefined }).find(item => item.name === 'novel_record_memory')!
    expect(() => assertObjectJsonSchema(tool.parameters)).not.toThrow()
    for (const args of [{ ...data }, { ...data, scope: 'book' }, { ...data, scope: 'author', bookId: 'a' },
      { ...data, scope: 'author', 操作: '更新' }, { ...data, scope: 'author', 类: 'wrong' }]) {
      expect(await tool.execute(args)).toMatchObject({ ok: false, code: 'invalid-argument' })
    }
    expect(workspaceRoot).not.toHaveBeenCalled()
  })

  it('没有书也能保存作者偏好，并给出实际范围', async () => {
    const { ws, call } = fixture()
    expect(await call({ ...data, scope: 'author' })).toMatchObject({ ok: true, scope: 'author', changed: true, commitState: 'not-required' })
    expect(fs.existsSync(path.join(ws, '书房/作者记忆/范围选择.md'))).toBe(true)
    expect(fs.existsSync(path.join(ws, '本书记忆'))).toBe(false)
  })

  it('两本书同名记忆独立；提交失败后相同输入只补交', async () => {
    const { ws, call } = fixture(), a = path.join(ws, 'a'), b = path.join(ws, 'b')
    initBook(a); initBook(b)
    const hook = path.join(a, '.git/hooks/pre-commit')
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n'); fs.chmodSync(hook, 0o755)
    const args = { ...data, scope: 'book', bookId: 'a' }
    expect(await call(args)).toMatchObject({ ok: false, changed: true, commitState: 'failed' })
    const file = path.join(a, '本书记忆/范围选择.md'), text = fs.readFileSync(file, 'utf8')
    fs.utimesSync(file, 1000, 1000)
    fs.unlinkSync(hook)
    expect(await call(args)).toMatchObject({ ok: true, changed: false, commitState: 'committed' })
    expect(fs.readFileSync(file, 'utf8')).toBe(text)
    expect(fs.statSync(file).mtimeMs).toBe(1_000_000)
    expect(await call(args)).toMatchObject({ ok: true, changed: false, commitState: 'unchanged' })
    expect(await call({ ...args, bookId: 'b', 正文: '采用全知视角。' })).toMatchObject({ ok: true, scope: 'book' })
    expect(fs.readFileSync(path.join(b, '本书记忆/范围选择.md'), 'utf8')).toContain('全知视角')
    expect(fs.existsSync(path.join(ws, '书房/作者记忆/范围选择.md'))).toBe(false)
    expect(git(a, 'ls-files')).toContain('本书记忆/范围选择.md')
    expect(await call({ ...args, 操作: '更新', 原文: text, 正文: '新的有效结论。' })).toMatchObject({ ok: true, changed: true })
    expect(await call({ ...args, 操作: '更新', 原文: text, 正文: '另一份过期更新。' })).toMatchObject({ ok: false, code: 'source-conflict' })
  })

  it.each(['author', 'book'])('%s 命名和未知目标隔离继续阻止记忆写入', async scope => {
    for (const mode of ['named', 'unknown']) {
      const { ws, call } = fixture(), writeRoot = path.join(ws, scope === 'book' ? 'a' : '书房')
      const target = scope === 'book' ? '本书记忆/范围选择.md' : '作者记忆/范围选择.md'
      if (mode === 'unknown') {
        const interrupted = path.join(writeRoot, '.webnovel/transactions/bad')
        fs.mkdirSync(interrupted, { recursive: true }); fs.writeFileSync(path.join(interrupted, 'manifest.json'), '{bad')
      } else {
        const q = path.join(writeRoot, '.webnovel/quarantine/q')
        fs.mkdirSync(q, { recursive: true })
        fs.writeFileSync(path.join(q, 'quarantine.json'), JSON.stringify({ id: 'q', reason: 'conflict', targets: [target], location: '.webnovel/quarantine/q', quarantinedAt: '' }))
      }
      expect(await call({ ...data, scope, ...(scope === 'book' ? { bookId: 'a' } : {}) })).toMatchObject({ ok: false, code: 'transaction-conflict' })
      expect(fs.existsSync(path.join(writeRoot, target))).toBe(false)
    }
  })

  it('本书索引存在旧未编码目标、损坏链接或旧分类内容时归类为 parse-error 且零写入', async () => {
    const memorySnapshot = (bookRoot: string) => {
      const dir = path.join(bookRoot, '本书记忆')
      return Object.fromEntries(fs.readdirSync(dir).sort().map(name => [name, fs.readFileSync(path.join(dir, name), 'utf8')]))
    }

    const legacyWs = root(), legacyBook = path.join(legacyWs, 'legacy')
    initBook(legacyBook)
    const legacyDir = path.join(legacyBook, '本书记忆')
    fs.mkdirSync(legacyDir)
    fs.writeFileSync(path.join(legacyDir, 'Some File Name.md'), serializeDocument({ 名称: 'Some title', 类: '文风', 来源: '对谈' }, '旧记忆正文。'), 'utf8')
    fs.writeFileSync(path.join(legacyDir, '索引.md'), '# 本书记忆索引\n- [Some title](Some File Name.md)\n', 'utf8')
    const legacyBefore = memorySnapshot(legacyBook)
    const legacyTool = createNovelTools({ workspaceRoot: () => legacyWs, bookRootOfBookId: id => path.join(legacyWs, id) }).find(item => item.name === 'novel_record_memory')!
    const legacyResult = await legacyTool.execute({ ...data, scope: 'book', bookId: 'legacy' }) as Record<string, unknown>
    expect(legacyResult).toMatchObject({
      ok: false,
      code: 'parse-error',
      next: '先检查书仓或预览整仓升级；按 reason 核对原文后再调用。',
    })
    expect(String(legacyResult['reason'])).toContain('第2行旧索引目标未编码（Some File Name.md）')
    expect(String(legacyResult['reason'])).toContain('请先检查书仓并预览整仓升级，未重建索引')
    expect(memorySnapshot(legacyBook)).toEqual(legacyBefore)

    const malformedWs = root(), malformedBook = path.join(malformedWs, 'malformed')
    initBook(malformedBook)
    const malformedDir = path.join(malformedBook, '本书记忆')
    fs.mkdirSync(malformedDir)
    fs.writeFileSync(path.join(malformedDir, '索引.md'), '# 本书记忆索引\n- [编码无效](<./%ZZ.md>)\n', 'utf8')
    const malformedBefore = memorySnapshot(malformedBook)
    const malformedTool = createNovelTools({ workspaceRoot: () => malformedWs, bookRootOfBookId: id => path.join(malformedWs, id) }).find(item => item.name === 'novel_record_memory')!
    const malformedResult = await malformedTool.execute({ ...data, scope: 'book', bookId: 'malformed' }) as Record<string, unknown>
    expect(malformedResult).toMatchObject({ ok: false, code: 'parse-error' })
    expect(String(malformedResult['reason'])).toContain('第2行链接无效或不明确')
    expect(String(malformedResult['reason'])).toContain('请先核对原文并检查书仓，未重建索引')
    expect(memorySnapshot(malformedBook)).toEqual(malformedBefore)

    const categoryWs = root(), categoryBook = path.join(categoryWs, 'category')
    initBook(categoryBook)
    const categoryDir = path.join(categoryBook, '本书记忆')
    fs.mkdirSync(categoryDir)
    fs.writeFileSync(path.join(categoryDir, '文风.md'), '# 文风\n\n## 旧习惯\n状态：已确认\n### 正文\n旧正文。\n', 'utf8')
    const categoryBefore = memorySnapshot(categoryBook)
    const categoryTool = createNovelTools({ workspaceRoot: () => categoryWs, bookRootOfBookId: id => path.join(categoryWs, id) }).find(item => item.name === 'novel_record_memory')!
    const categoryResult = await categoryTool.execute({ ...data, scope: 'book', bookId: 'category' }) as Record<string, unknown>
    expect(categoryResult).toMatchObject({ ok: false, code: 'parse-error' })
    expect(String(categoryResult['reason'])).toContain('记忆条目解析失败：本书记忆/文风.md')
    expect(memorySnapshot(categoryBook)).toEqual(categoryBefore)
  })

  it('novel_settle_chapter 遇旧未编码记忆索引时透传 parse-error 与精确行号', async () => {
    const ws = root(), book = path.join(ws, 'settle-legacy')
    initBook(book)
    const key = { 卷: 1, 章: 1, 章名: '开篇' }
    fs.mkdirSync(path.join(book, '作品契约'), { recursive: true })
    fs.writeFileSync(path.join(book, paths.契约()), serializeDocument({ 书id: 'settle-legacy' }, '# 作品契约\n'), 'utf8')
    const draftDir = paths.草稿目录(key.卷, key.章名)
    fs.mkdirSync(path.join(book, draftDir), { recursive: true })
    fs.writeFileSync(path.join(book, `${draftDir}/稿1.md`), serializeDocument({ 身份: key, 角色: '待审稿', 选定: true, 版本: 1, 父版本: null }, '待定稿正文。'), 'utf8')
    const memoryDir = path.join(book, '本书记忆')
    fs.mkdirSync(memoryDir, { recursive: true })
    fs.writeFileSync(path.join(memoryDir, 'Some File Name.md'), serializeDocument({ 名称: 'Some title', 类: '文风', 来源: '对谈' }, '旧记忆正文。'), 'utf8')
    fs.writeFileSync(path.join(memoryDir, '索引.md'), '# 本书记忆索引\n- [Some title](Some File Name.md)\n', 'utf8')
    const pack = preparePack(book, key, { 记忆候选: '## 决策\n### 沉淀新增\n状态：候选\n描述：说明\n独立正文。\n' })
    expect(pack.ok).toBe(true)

    const tools = createNovelTools({
      workspaceRoot: () => ws,
      bookRootOfBookId: id => id === 'settle-legacy' ? book : undefined,
      askFn: async request => ({ answers: request.questions.map(q => ({ id: q.id, selected: ['批准'] })) }),
    })
    const settle = tools.find(item => item.name === 'novel_settle_chapter')!
    const result = await settle.execute({ bookId: 'settle-legacy', ...key, summary: '第一章 开篇' }) as Record<string, unknown>
    expect(result).toMatchObject({ ok: false, code: 'parse-error' })
    expect(String(result['reason'])).toContain('第2行旧索引目标未编码（Some File Name.md）')
    expect(String(result['reason'])).toContain('请先检查书仓并预览整仓升级，未重建索引')
    expect(fs.existsSync(path.join(book, paths.定稿章(key.卷, key.章, key.章名)))).toBe(false)
    expect(fs.existsSync(path.join(memoryDir, '沉淀新增.md'))).toBe(false)
  })
})
