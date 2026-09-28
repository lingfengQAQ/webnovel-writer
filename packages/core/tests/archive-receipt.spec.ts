import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { archiveChapter, archiveRetcon, type ArchiveOptions } from '../src/commit/archive'
import { ARCHIVE_RECEIPT_DIR } from '../src/commit/receipt'
import { parseDocument, serializeDocument } from '../src/repo/frontmatter'
import { removeSync } from '../src/repo/remove'
import { writeSettlementDecision } from '../src/settlement/decision'

const roots: string[] = []
function temp(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-receipt-'))
  roots.push(root)
  return root
}
function put(root: string, relative: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content)
}
function git(root: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout.trim()
}
function fixture(): ArchiveOptions {
  const root = temp()
  git(root, 'init')
  git(root, 'config', 'user.name', 'test')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'config', 'commit.gpgsign', 'false')
  put(root, '.gitignore', '草稿区/\n.webnovel/\n')
  put(root, '账本/时间线.md', '# 时间线\n')
  put(root, '账本/故事线.md', '# 故事线\n')
  put(root, '世界书/设定/铜铃.md', serializeDocument({ 名称: '铜铃', 性质: '事实', 版本: 1 }, '既有事实。'))
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'vol: 初始化')
  const packageDir = '草稿区/定稿准备/卷01-初见'
  const candidates = {
    '正文.md': '第一次听见铜铃。\n',
    '章摘要.md': '初见摘要。\n',
    '事实变更.md': '# 事实变更\n## 设定\n### 铜铃\n铜铃在城门响起。\n',
    '时间线变更.md': '# 时间线变更\n## 听见铜铃\n事件：铜铃响起\n',
    '账本变更.md': '# 账本变更\n## 故事线\n### 铜铃之谜\n状态：进行中\n计划来源：卷纲#1\n开始调查。\n',
    '本书层记忆候选.md': '# 本书层记忆候选\n## 文风\n### 克制\n状态：候选\n短句推进。\n',
    '卷对账.md': '# 卷对账\n无偏离。\n',
    '清单.json': JSON.stringify({ 文件: [
      { 源: '正文.md', 目标: '定稿/卷01/0001-初见.md' },
      { 源: '章摘要.md', 目标: '大纲/卷规划/卷01/章摘要/0001-初见.md' },
    ], schemaVersion: 1 }),
  }
  for (const [name, content] of Object.entries(candidates)) put(root, `${packageDir}/${name}`, content)
  return { bookRoot: root, packageDir, summary: '初见入档', lines: ['作者批准的定稿'], settlement: { 章节: { 卷: 1, 章: 1, 章名: '初见' }, 批准: true, 裁决记录: '第一次批准' } }
}
function failCommit(root: string): void {
  put(root, '.git/hooks/pre-commit', '#!/bin/sh\nexit 1\n')
  fs.chmodSync(path.join(root, '.git/hooks/pre-commit'), 0o755)
}
function receiptPath(root: string): string {
  const dir = path.join(root, ARCHIVE_RECEIPT_DIR)
  const names = fs.readdirSync(dir)
  expect(names).toHaveLength(1)
  return path.join(dir, names[0]!)
}
function written(root: string): Record<string, string> {
  return Object.fromEntries(['定稿/卷01/0001-初见.md', '大纲/卷规划/卷01/章摘要/0001-初见.md', '账本/时间线.md', '账本/故事线.md', '世界书/设定/铜铃.md', '本书记忆/克制.md', '本书记忆/索引.md']
    .map(relative => [relative, fs.readFileSync(path.join(root, relative), 'utf8')]))
}

let archiveModule: string
beforeAll(() => {
  const local = createRequire(import.meta.url)
  const vitest = createRequire(local.resolve('vitest/package.json'))
  const vite = createRequire(vitest.resolve('vite/package.json'))
  const { buildSync } = vite('esbuild') as { buildSync(options: Record<string, unknown>): unknown }
  archiveModule = path.join(temp(), 'archive.cjs')
  buildSync({ entryPoints: [fileURLToPath(new URL('../src/commit/archive.ts', import.meta.url))], outfile: archiveModule, bundle: true, platform: 'node', format: 'cjs' })
})
afterAll(() => { for (const root of roots.reverse()) removeSync(root) })
function inProcess(options: ArchiveOptions, mode = 'normal'): ReturnType<typeof spawnSync> {
  const source = `
    const fs = require('node:fs');
    const [modulePath, input, mode] = process.argv.slice(1);
    let faultHit = false;
    const rename = fs.renameSync;
    if (mode === 'write-fault') fs.renameSync = (from, to) => {
      if (!faultHit && String(to).replaceAll('\\\\', '/').includes('/.archive-receipts/') && String(from).includes('.webnovel-txn-')) {
        faultHit = true;
        throw Object.assign(new Error('injected receipt write failure'), { code: 'EIO' });
      }
      return rename(from, to);
    };
    const result = require(modulePath).archiveChapter(JSON.parse(input));
    if (mode === 'lost-response' && result.ok) process.exit(88);
    process.stdout.write(JSON.stringify({ result, faultHit }));
  `
  return spawnSync(process.execPath, ['-e', source, archiveModule, JSON.stringify(options), mode], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
}

describe('归档可信收据(F06)', () => {
  it('真实 Git 失败后新进程只补提交；时间线、世界书版本、记忆与原裁决均只写一次', () => {
    const options = fixture()
    failCommit(options.bookRoot)
    const failed = inProcess(options)
    expect(failed.status, String(failed.stderr)).toBe(0)
    expect(JSON.parse(String(failed.stdout)).result).toMatchObject({ ok: false, written: true })
    const before = written(options.bookRoot)
    const receipt = fs.readFileSync(receiptPath(options.bookRoot), 'utf8')
    fs.unlinkSync(path.join(options.bookRoot, '.git/hooks/pre-commit'))
    expect(writeSettlementDecision(options.bookRoot, { 卷: 1, 章名: '初见' }, '已批准').ok).toBe(true)
    put(options.bookRoot, '大纲/其他.md', '归档重试前的另一笔提交\n')
    git(options.bookRoot, 'add', '大纲/其他.md')
    git(options.bookRoot, 'commit', '--only', '-m', 'design: 插入其他提交', '--', '大纲/其他.md')
    const retried = inProcess({ ...options, settlement: { ...options.settlement!, 裁决记录: '重开后的批准时间' }, provenance: { callId: 'different-call' } })
    expect(retried.status, String(retried.stderr)).toBe(0)
    expect(JSON.parse(String(retried.stdout)).result).toMatchObject({ ok: true })
    expect(written(options.bookRoot)).toEqual(before)
    expect(fs.readFileSync(receiptPath(options.bookRoot), 'utf8')).toBe(receipt)
    expect(before['账本/时间线.md']!.match(/^## 听见铜铃$/gm)).toHaveLength(1)
    const world = parseDocument(before['世界书/设定/铜铃.md']!)
    expect(world.ok && world.data.fields['版本']).toBe(2)
    expect(git(options.bookRoot, 'rev-list', '--count', 'HEAD')).toBe('3')
    expect(git(options.bookRoot, 'ls-files')).not.toContain('.archive-receipts')
  })

  it('提交后响应丢失且有其他提交介入，仍按精确收据重放成功', () => {
    const options = fixture()
    expect(inProcess(options, 'lost-response').status).toBe(88)
    const before = written(options.bookRoot)
    put(options.bookRoot, '大纲/其他.md', '另一次作者修改\n')
    git(options.bookRoot, 'add', '大纲/其他.md')
    git(options.bookRoot, 'commit', '-m', 'design: 其他改动')
    const head = git(options.bookRoot, 'rev-parse', 'HEAD')
    expect(archiveChapter(options)).toMatchObject({ ok: true, alreadyCommitted: true })
    expect(git(options.bookRoot, 'rev-parse', 'HEAD')).toBe(head)
    expect(written(options.bookRoot)).toEqual(before)
  })

  it('Git 失败后作者用其他说明提交全部精确输出，重试识别已补交且不再沉淀', () => {
    const options = fixture()
    failCommit(options.bookRoot)
    expect(archiveChapter(options)).toMatchObject({ ok: false, written: true })
    const before = written(options.bookRoot)
    const receipt = fs.readFileSync(receiptPath(options.bookRoot), 'utf8')
    fs.unlinkSync(path.join(options.bookRoot, '.git/hooks/pre-commit'))
    git(options.bookRoot, 'commit', '-m', '作者人工补交上次定稿')
    const head = git(options.bookRoot, 'rev-parse', 'HEAD')
    const retried = inProcess(options)
    expect(retried.status, String(retried.stderr)).toBe(0)
    expect(JSON.parse(String(retried.stdout)).result).toMatchObject({ ok: true, alreadyCommitted: true })
    expect(written(options.bookRoot)).toEqual(before)
    expect(fs.readFileSync(receiptPath(options.bookRoot), 'utf8')).toBe(receipt)
    expect(git(options.bookRoot, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(options.bookRoot, 'rev-list', '--count', 'HEAD')).toBe('2')
  })

  it('收据与业务文件在同一事务，收据写失败整批回滚且可正常重试', () => {
    const options = fixture()
    const original = fs.readFileSync(path.join(options.bookRoot, '世界书/设定/铜铃.md'), 'utf8')
    const failed = inProcess(options, 'write-fault')
    expect(failed.status, String(failed.stderr)).toBe(0)
    expect(JSON.parse(String(failed.stdout))).toMatchObject({ faultHit: true, result: { ok: false } })
    expect(fs.existsSync(path.join(options.bookRoot, '定稿/卷01/0001-初见.md'))).toBe(false)
    expect(fs.readFileSync(path.join(options.bookRoot, '世界书/设定/铜铃.md'), 'utf8')).toBe(original)
    expect(fs.readdirSync(path.join(options.bookRoot, ARCHIVE_RECEIPT_DIR))).toEqual([])
    expect(archiveChapter(options).ok).toBe(true)
  })

  it.each(['source', 'target', 'receipt', 'extra'])('已写未提交后 %s 被替换时拒绝，并保留全部证据', (kind) => {
    const options: ArchiveOptions = { ...fixture(), ...(kind === 'extra' ? { extraPaths: ['大纲/窗口.md'] } : {}) }
    if (kind === 'extra') put(options.bookRoot, '大纲/窗口.md', '# 已消费窗口\n')
    failCommit(options.bookRoot)
    expect(archiveChapter(options)).toMatchObject({ ok: false, written: true })
    if (kind === 'source') put(options.bookRoot, `${options.packageDir}/事实变更.md`, '# 事实变更\n## 设定\n### 铜铃\n换成另一份事实。\n')
    if (kind === 'target') put(options.bookRoot, '账本/时间线.md', '# 作者另改的时间线\n')
    if (kind === 'receipt') fs.writeFileSync(receiptPath(options.bookRoot), '{"schema":1}')
    if (kind === 'extra') put(options.bookRoot, '大纲/窗口.md', '# 作者修改窗口\n')
    const before = written(options.bookRoot)
    const receipt = fs.readFileSync(receiptPath(options.bookRoot), 'utf8')
    fs.unlinkSync(path.join(options.bookRoot, '.git/hooks/pre-commit'))
    expect(archiveChapter(options)).toMatchObject({ ok: false, reason: expect.stringMatching(/冲突|损坏/) })
    expect(written(options.bookRoot)).toEqual(before)
    expect(fs.readFileSync(receiptPath(options.bookRoot), 'utf8')).toBe(receipt)
    if (kind === 'extra') expect(fs.readFileSync(path.join(options.bookRoot, '大纲/窗口.md'), 'utf8')).toBe('# 作者修改窗口\n')
    expect(git(options.bookRoot, 'rev-list', '--count', 'HEAD')).toBe('1')
  })

  it('旧失败没有可信收据时，不靠相同正文猜测沉淀完成', () => {
    const options = fixture()
    failCommit(options.bookRoot)
    expect(archiveChapter(options)).toMatchObject({ ok: false, written: true })
    fs.unlinkSync(receiptPath(options.bookRoot))
    fs.unlinkSync(path.join(options.bookRoot, '.git/hooks/pre-commit'))
    const before = written(options.bookRoot)
    expect(archiveChapter(options)).toMatchObject({ ok: false, reason: expect.stringMatching(/可信收据/) })
    expect(written(options.bookRoot)).toEqual(before)
  })

  it('旧记忆文件碰撞使整包在写入前失败，既有世界书与记忆保持原样', () => {
    const options = fixture()
    const legacy = '# 文风\n\n## 旧条目甲\n甲原文\n\n## 旧条目乙\n乙原文\n'
    put(options.bookRoot, '本书记忆/文风.md', legacy)
    put(options.bookRoot, `${options.packageDir}/本书层记忆候选.md`, '# 本书层记忆候选\n## 文风\n### 文风\n状态：候选\n新条目不能覆盖分类。\n')
    const world = fs.readFileSync(path.join(options.bookRoot, '世界书/设定/铜铃.md'), 'utf8')
    expect(archiveChapter(options)).toMatchObject({ ok: false, reason: expect.stringMatching(/旧格式|冲突/) })
    expect(fs.existsSync(path.join(options.bookRoot, '定稿/卷01/0001-初见.md'))).toBe(false)
    expect(fs.readFileSync(path.join(options.bookRoot, '本书记忆/文风.md'), 'utf8')).toBe(legacy)
    expect(fs.readFileSync(path.join(options.bookRoot, '世界书/设定/铜铃.md'), 'utf8')).toBe(world)
  })

  it('吃书更正也可补交和重放，已提交后仍允许新的明确更正', () => {
    const options = fixture()
    const first: ArchiveOptions = { bookRoot: options.bookRoot, files: [{ 目标: '世界书/设定/铜铃.md', 内容: '更正一\n' }], summary: '更正铜铃' }
    failCommit(options.bookRoot)
    expect(archiveRetcon(first)).toMatchObject({ ok: false, written: true })
    fs.unlinkSync(path.join(options.bookRoot, '.git/hooks/pre-commit'))
    expect(archiveRetcon(first).ok).toBe(true)
    expect(archiveRetcon(first)).toMatchObject({ ok: true, alreadyCommitted: true })
    expect(archiveRetcon({ ...first, files: [{ 目标: '世界书/设定/铜铃.md', 内容: '更正二\n' }] }).ok).toBe(true)
    expect(fs.readFileSync(path.join(options.bookRoot, '世界书/设定/铜铃.md'), 'utf8')).toBe('更正二\n')
    expect(git(options.bookRoot, 'rev-list', '--count', 'HEAD')).toBe('3')
  })
})
