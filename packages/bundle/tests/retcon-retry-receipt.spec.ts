import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { createNovelTools, type ToolExecContext } from '../src/novel-tools'
import { APPROVE_LABEL, REJECT_LABEL, archiveRetcon, paths, parseDocument, serializeDocument, writeBookMemory, type AskFn } from '../../core/src/index'
import { contentHash, type ArchiveReceipt } from '../../core/src/commit/receipt'
import { removeSync } from '../../core/src/repo/remove'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'retcon-tool-receipt-'))
afterAll(() => removeSync(scratch))
const key = { 卷: 1, 章: 1, 章名: '铜铃' }
const chapter = paths.定稿章(1, 1, key.章名)
const summary = paths.章摘要(1, 1, key.章名)
const world = '世界书/设定/铜铃.md'
const receipts = '草稿区/.archive-receipts'
const approve: AskFn = async request => ({ answers: [{ id: request.questions[0]!.id, selected: [APPROVE_LABEL] }] })
type Result = { ok: boolean; reason?: string; 补偿事件?: string; dests?: string[] }
const toolModule = path.join(scratch, 'tools.cjs')
beforeAll(() => {
  buildSync({ entryPoints: [fileURLToPath(new URL('../src/novel-tools.ts', import.meta.url))], outfile: toolModule, bundle: true, platform: 'node', format: 'cjs',
    define: { 'import.meta.url': JSON.stringify(import.meta.url) },
  })
})

function inProcess(root: string, args: Record<string, unknown>, mode = 'normal') {
  const source = `
    const fs = require('node:fs');
    const path = require('node:path');
    const [modulePath, root, input, mode] = process.argv.slice(1);
    let faultHit = false;
    const rename = fs.renameSync;
    if (mode === 'write-fault') fs.renameSync = (from, to) => {
      if (!faultHit && String(to).replaceAll('\\\\', '/').includes('/.archive-receipts/') && String(from).includes('.webnovel-txn-')) {
        faultHit = true;
        throw Object.assign(new Error('injected receipt failure'), { code: 'EIO' });
      }
      return rename(from, to);
    };
    const tools = require(modulePath).createNovelTools({ workspaceRoot: () => path.dirname(root), bookRootOfBookId: () => root,
      askFn: async request => ({ answers: [{ id: request.questions[0].id, selected: ['${APPROVE_LABEL}'] }] }) });
    tools.find(tool => tool.name === 'novel_apply_retcon').execute(JSON.parse(input), { callId: 'new-process' }).then(result => {
      if (mode === 'lost-response' && result.ok) process.exit(88);
      process.stdout.write(JSON.stringify({ result, faultHit }));
    }).catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
  `
  return spawnSync(process.execPath, ['-e', source, toolModule, root, JSON.stringify(args), mode], { encoding: 'utf8', windowsHide: true, timeout: 20000 })
}

function put(root: string, relative: string, text: string): void {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
function git(root: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout.trim()
}
function toolsFor(root: string, askFn: AskFn = approve) {
  return createNovelTools({ workspaceRoot: () => path.dirname(root), bookRootOfBookId: () => root, askFn })
}
async function apply(root: string, args: Record<string, unknown>, ctx: ToolExecContext = {}, askFn = approve): Promise<Result> {
  // Recreate the tools on every call: persistence must live in the book, not a closure.
  return await toolsFor(root, askFn).find(tool => tool.name === 'novel_apply_retcon')!.execute(args, ctx) as Result
}
function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {}
  function walk(relative: string): void {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.webnovel') continue
      const file = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(file)
      else files[file] = fs.readFileSync(path.join(root, file), 'utf8')
    }
  }
  walk('')
  return files
}
async function fixture(candidate: boolean | 'all' = false, name = key.章名) {
  const ws = fs.mkdtempSync(path.join(scratch, 'case-'))
  const root = path.join(ws, '复查书')
  const created = await toolsFor(root).find(tool => tool.name === 'novel_create_book')!.execute({ bookName: '复查书', concept: {
    状态: '已确认', 核心创意: 'x', 题材与目标读者: 'x', 主角核心欲望: 'x', 主要冲突: 'x', 核心看点: 'x', 差异化方向: 'x', 明确不要什么: 'x',
  } }, {}) as { ok: boolean; bookId: string }
  expect(created.ok).toBe(true)
  git(root, 'config', 'user.name', 'Receipt test')
  git(root, 'config', 'user.email', 'receipt@example.com')
  git(root, 'config', 'commit.gpgsign', 'false')
  put(root, paths.定稿章(1, 1, name), serializeDocument({ 角色: '定稿', 版本: 1, ...key, 章名: name }, '原正文。'))
  put(root, paths.章摘要(1, 1, name), '# 章摘要\n原摘要。\n')
  put(root, world, serializeDocument({ 名称: '铜铃', 性质: '事实', 版本: 1 }, '原事实。'))
  if (candidate === 'all') {
    put(root, '账本/时间线.md', '# 时间线\n\n## 听见铜铃\n事件：旧事件\n章号：1\n### 正文\n旧原文。\n')
    put(root, '账本/故事线.md', '# 故事线\n\n## 铜铃之谜\n状态：进行中\n计划来源：卷纲#1\n### 正文\n旧调查。\n')
    writeBookMemory(root, { 名称: '克制', 类: '文风', 正文: '旧记忆。', 来源: chapter, 裁决记录: '夹具批准' })
  }
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'ch: fixture')
  const args: Record<string, unknown> = { bookId: created.bookId, ...key, 章名: name, 更正后正文: '更正正文。', 更正后章摘要: '更正摘要。', 摘要: '修正铜铃',
    ...(candidate ? { 事实变更: '# 事实变更\n## 设定\n### 铜铃\n更正后的事实。\n' } : {}),
    ...(candidate === 'all' ? {
      时间线变更: '# 时间线变更\n## 听见铜铃\n事件：更正事件\n更正后的经过。\n',
      账本变更: '# 账本变更\n## 故事线\n### 铜铃之谜\n状态：已结束\n计划来源：卷纲#1\n更正后的调查。\n',
      记忆候选: '# 本书层记忆候选\n## 文风\n### 克制\n状态：候选\n更正后的记忆。\n',
    } : {}),
  }
  return { root, args }
}
async function failFirst(root: string, args: Record<string, unknown>): Promise<void> {
  put(root, '.git/hooks/pre-commit', '#!/bin/sh\nexit 1\n')
  fs.chmodSync(path.join(root, '.git/hooks/pre-commit'), 0o755)
  const result = await apply(root, args, { callId: 'first' })
  expect(result, JSON.stringify(result)).toMatchObject({ ok: false, reason: expect.stringMatching(/文件已写入但提交失败/) })
  fs.unlinkSync(path.join(root, '.git/hooks/pre-commit'))
}

describe('F06: 吃书补偿完整工具链收据', () => {
  it.each([false, true, 'all'] as const)('提交失败后只补提交，成功重放不变（候选=%s）', async candidate => {
    const { root, args } = await fixture(candidate)
    await failFirst(root, args)
    const before = snapshot(root)
    const count = Number(git(root, 'rev-list', '--count', 'HEAD'))
    const retry = await apply(root, args, { callId: 'retry' })
    expect(retry, JSON.stringify(retry)).toMatchObject({ ok: true })
    expect(snapshot(root)).toEqual(before)
    const doc = parseDocument(fs.readFileSync(path.join(root, chapter), 'utf8'))
    expect(doc.ok && doc.data.fields['版本']).toBe(2)
    expect(fs.readdirSync(path.join(root, '定稿/卷01/补偿'))).toHaveLength(1)
    expect(fs.readdirSync(path.join(root, receipts))).toHaveLength(1)
    expect(Number(git(root, 'rev-list', '--count', 'HEAD'))).toBe(count + 1)
    const head = git(root, 'rev-parse', 'HEAD')
    const replay = await apply(root, args, { callId: 'replay' })
    expect(replay).toMatchObject({ ok: true, 补偿事件: retry.补偿事件, dests: retry.dests })
    expect(snapshot(root)).toEqual(before)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
    fs.unlinkSync(path.join(root, chapter))
    const deleted = snapshot(root)
    expect(await apply(root, args)).toMatchObject({ ok: false, reason: expect.stringMatching(/冲突/) })
    expect(snapshot(root)).toEqual(deleted)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
  })

  it('提交失败后的作者定稿修改保留，旧参数不能覆盖', async () => {
    const { root, args } = await fixture(true)
    await failFirst(root, args)
    put(root, chapter, serializeDocument({ 角色: '定稿', 版本: 2, ...key }, '作者在失败后补写的正文。'))
    const before = snapshot(root)
    const head = git(root, 'rev-parse', 'HEAD')
    const retry = await apply(root, args)
    expect(retry).toMatchObject({ ok: false, reason: expect.stringMatching(/冲突/) })
    expect(snapshot(root)).toEqual(before)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
  })

  it('新进程补提交及丢响应重放，插入无关提交也只认原输出', async () => {
    const { root, args } = await fixture('all')
    await failFirst(root, args)
    put(root, '大纲/其他.md', '无关提交\n')
    git(root, 'add', '大纲/其他.md')
    git(root, 'commit', '--only', '-m', 'design: unrelated', '--', '大纲/其他.md')
    put(root, '大纲/暂存.md', '无关暂存不能被补交\n')
    git(root, 'add', '大纲/暂存.md')
    const before = snapshot(root)
    const lost = inProcess(root, args, 'lost-response')
    expect(lost.status, lost.stderr || lost.stdout).toBe(88)
    const head = git(root, 'rev-parse', 'HEAD')
    const replay = inProcess(root, args)
    expect(replay.status, replay.stderr).toBe(0)
    expect(JSON.parse(replay.stdout).result).toMatchObject({ ok: true })
    expect(snapshot(root)).toEqual(before)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(root, 'diff', '--cached', '--name-only', '--', '大纲/暂存.md')).not.toBe('')
    expect(git(root, 'ls-files', '--', receipts)).toBe('')
  })

  it('人工补交全部输出后重试不再创建提交', async () => {
    const { root, args } = await fixture(true)
    await failFirst(root, args)
    git(root, 'commit', '-m', '作者人工补交')
    const before = snapshot(root)
    const head = git(root, 'rev-parse', 'HEAD')
    expect(await apply(root, args)).toMatchObject({ ok: true })
    expect(snapshot(root)).toEqual(before)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
  })

  it.each([summary, 'event', world, '账本/时间线.md', '账本/故事线.md', '本书记忆/克制.md', '本书记忆/索引.md'])('修改或删除原输出 %s 都拒绝', async target => {
    const { root, args } = await fixture('all')
    await failFirst(root, args)
    const relative = target === 'event' ? '定稿/卷01/补偿/补偿-0001.md' : target
    const original = fs.readFileSync(path.join(root, relative), 'utf8')
    for (const mode of ['edit', 'delete']) {
      if (mode === 'edit') put(root, relative, original + '\n作者新修改。\n')
      else fs.unlinkSync(path.join(root, relative))
      const before = snapshot(root)
      const head = git(root, 'rev-parse', 'HEAD')
      expect(await apply(root, args)).toMatchObject({ ok: false, reason: expect.stringMatching(/冲突/) })
      expect(snapshot(root)).toEqual(before)
      expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
    }
  })

  it.each(['candidate', 'receipt', 'metadata', 'missing-receipt'])('损坏或丢失 %s 时拒绝，不另建补偿', async target => {
    const { root, args } = await fixture(true)
    await failFirst(root, args)
    const receiptPath = path.join(root, receipts, fs.readdirSync(path.join(root, receipts))[0]!)
    if (target === 'candidate') {
      const dir = fs.readdirSync(path.join(root, '草稿区/提案')).find(name => name.startsWith('retcon-'))!
      put(root, `草稿区/提案/${dir}/事实变更.md`, '# 作者替换的候选\n')
    } else if (target === 'missing-receipt') fs.unlinkSync(receiptPath)
    else if (target === 'receipt') fs.writeFileSync(receiptPath, '{broken')
    else {
      const envelope = JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as { receipt: ArchiveReceipt }
      const invalid = { ...envelope.receipt, retcon: { chapter, packageDir: '../escape', inputs: {} } }
      fs.writeFileSync(receiptPath, JSON.stringify({ receipt: invalid, checksum: contentHash(JSON.stringify(invalid)) }))
    }
    const before = snapshot(root)
    const head = git(root, 'rev-parse', 'HEAD')
    expect(await apply(root, args)).toMatchObject({ ok: false, reason: expect.stringMatching(/冲突|损坏|可信收据/) })
    expect(snapshot(root)).toEqual(before)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
  })

  it('未提交时改正文、候选、提案或摘要不能绕过原收据', async () => {
    const { root, args } = await fixture(true)
    await failFirst(root, args)
    const before = snapshot(root)
    const head = git(root, 'rev-parse', 'HEAD')
    for (const field of ['更正后正文', '更正后章摘要', '事实变更', '摘要', '提案编号']) {
      expect(await apply(root, { ...args, [field]: '另一份请求' })).toMatchObject({ ok: false, reason: expect.stringMatching(/冲突/) })
      expect(snapshot(root)).toEqual(before)
      expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
    }
  })

  it('旧低层收据无法证明工具业务身份时拒绝自动重写', async () => {
    const { root, args } = await fixture()
    put(root, '.git/hooks/pre-commit', '#!/bin/sh\nexit 1\n')
    fs.chmodSync(path.join(root, '.git/hooks/pre-commit'), 0o755)
    expect(archiveRetcon({ bookRoot: root, summary: '旧版补偿', files: [
      { 目标: chapter, 内容: serializeDocument({ 角色: '定稿', 版本: 2, ...key }, String(args['更正后正文'])) },
      { 目标: '定稿/卷01/补偿/补偿-0001.md', 内容: '# 补偿事件记录\n旧版补偿\n' },
    ] })).toMatchObject({ ok: false, written: true })
    fs.unlinkSync(path.join(root, '.git/hooks/pre-commit'))
    const before = snapshot(root)
    const head = git(root, 'rev-parse', 'HEAD')
    expect(await apply(root, args)).toMatchObject({ ok: false, reason: expect.stringMatching(/旧收据/) })
    expect(snapshot(root)).toEqual(before)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
  })

  it('不同请求在前次完成后正常补偿，旧请求证据继续保留', async () => {
    const { root, args } = await fixture(true)
    expect(await apply(root, args)).toMatchObject({ ok: true })
    expect(await apply(root, { ...args, 更正后正文: '第二次明确更正。' })).toMatchObject({ ok: true })
    const before = snapshot(root)
    const doc = parseDocument(before[chapter]!)
    expect(doc.ok && doc.data.fields['版本']).toBe(3)
    expect(fs.readdirSync(path.join(root, receipts))).toHaveLength(2)
    expect(await apply(root, args)).toMatchObject({ ok: false, reason: expect.stringMatching(/冲突/) })
    expect(snapshot(root)).toEqual(before)
  })

  it('空候选和对象键序归一；未传章摘要时过期标记只写一次', async () => {
    const { root, args } = await fixture()
    delete args['更正后章摘要']
    await failFirst(root, args)
    const before = snapshot(root)
    const reordered = Object.fromEntries(Object.entries(args).reverse())
    expect(await apply(root, { ...reordered, 事实变更: '\n ', 记忆候选: '' })).toMatchObject({ ok: true })
    expect(snapshot(root)).toEqual(before)
    expect(before[summary]!.match(/〔摘要过期〕/g)).toHaveLength(1)
  })

  it('正文整文件与纯正文沿用同一写入归一，不能借 frontmatter 重新升版', async () => {
    const { root, args } = await fixture()
    await failFirst(root, args)
    const before = snapshot(root)
    expect(await apply(root, { ...args, 更正后正文: serializeDocument({ 角色: '定稿', 版本: 99 }, String(args['更正后正文'])) })).toMatchObject({ ok: true })
    expect(snapshot(root)).toEqual(before)
  })

  it.skipIf(process.platform !== 'win32')('Windows 章节名大小写别名仍复用原收据并保护作者改动', async () => {
    const { root, args } = await fixture(false, 'Bell')
    await failFirst(root, args)
    const before = snapshot(root)
    expect(await apply(root, { ...args, 章名: 'bell', 摘要: '另一份请求' })).toMatchObject({ ok: false, reason: expect.stringMatching(/冲突/) })
    expect(await apply(root, { ...args, 章名: 'bell' })).toMatchObject({ ok: true })
    expect(snapshot(root)).toEqual(before)
    const relative = paths.定稿章(1, 1, 'Bell')
    put(root, relative, before[relative]! + '\n作者新写。\n')
    const edited = snapshot(root)
    expect(await apply(root, { ...args, 章名: 'BELL' })).toMatchObject({ ok: false, reason: expect.stringMatching(/冲突/) })
    expect(snapshot(root)).toEqual(edited)
  })

  it('同书另一章和另一书的请求独立，不能误当同一请求', async () => {
    const { root, args } = await fixture()
    const secondChapter = paths.定稿章(1, 2, '后续')
    put(root, secondChapter, serializeDocument({ 角色: '定稿', 版本: 1, 卷: 1, 章: 2, 章名: '后续' }, '第二章原文。'))
    git(root, 'add', secondChapter)
    git(root, 'commit', '-m', 'ch: second')
    await failFirst(root, args)
    const firstWritten = fs.readFileSync(path.join(root, chapter), 'utf8')
    expect(await apply(root, { ...args, 章: 2, 章名: '后续' })).toMatchObject({ ok: true })
    expect(fs.readFileSync(path.join(root, chapter), 'utf8')).toBe(firstWritten)
    expect(await apply(root, args)).toMatchObject({ ok: true })
    expect(fs.readdirSync(path.join(root, receipts))).toHaveLength(2)
    const other = await fixture()
    expect(await apply(other.root, other.args)).toMatchObject({ ok: true })
    expect(fs.readdirSync(path.join(other.root, receipts))).toHaveLength(1)
  })

  it('裁决等待期间书身份变化拒绝补交', async () => {
    const { root, args } = await fixture()
    await failFirst(root, args)
    let expected = snapshot(root)
    const head = git(root, 'rev-parse', 'HEAD')
    const ask: AskFn = async request => {
      const contract = paths.契约()
      const doc = parseDocument(fs.readFileSync(path.join(root, contract), 'utf8'))
      expect(doc.ok).toBe(true)
      if (!doc.ok) throw new Error('fixture contract invalid')
      put(root, contract, serializeDocument({ ...doc.data.fields, 书id: 'changed-book-id' }, doc.data.body))
      expected = snapshot(root)
      return approve(request)
    }
    expect(await apply(root, args, {}, ask)).toMatchObject({ ok: false })
    expect(snapshot(root)).toEqual(expected)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
  })

  it.each(['reject', 'cancel', 'edit'])('重试仍检查作者裁决：%s', async kind => {
    const { root, args } = await fixture()
    await failFirst(root, args)
    const controller = new AbortController()
    let expected = snapshot(root)
    const head = git(root, 'rev-parse', 'HEAD')
    const ask: AskFn = async request => {
      if (kind === 'cancel') controller.abort()
      if (kind === 'edit') {
        put(root, chapter, expected[chapter]! + '\n等待期间作者修改。\n')
        expected = snapshot(root)
      }
      return { answers: [{ id: request.questions[0]!.id, selected: [kind === 'reject' ? REJECT_LABEL : APPROVE_LABEL] }] }
    }
    expect(await apply(root, args, { signal: controller.signal }, ask)).toMatchObject({ ok: false })
    expect(snapshot(root)).toEqual(expected)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
  })

  it('收据写入失败回滚真源，重试复用准备包并只升版一次', async () => {
    const { root, args } = await fixture(true)
    const before = snapshot(root)
    const failed = inProcess(root, args, 'write-fault')
    expect(failed.status, failed.stderr).toBe(0)
    expect(JSON.parse(failed.stdout)).toMatchObject({ faultHit: true, result: { ok: false } })
    const after = snapshot(root)
    for (const [file, text] of Object.entries(before)) expect(after[file], file).toBe(text)
    expect(fs.readdirSync(path.join(root, receipts))).toHaveLength(0)
    expect(await apply(root, args)).toMatchObject({ ok: true })
    expect(fs.readdirSync(path.join(root, '草稿区/提案'))).toHaveLength(1)
    const doc = parseDocument(fs.readFileSync(path.join(root, chapter), 'utf8'))
    expect(doc.ok && doc.data.fields['版本']).toBe(2)
  })

  it('首次写入失败后准备包被改，重试也保留改动', async () => {
    const { root, args } = await fixture(true)
    const failed = inProcess(root, args, 'write-fault')
    expect(failed.status, failed.stderr).toBe(0)
    expect(JSON.parse(failed.stdout)).toMatchObject({ faultHit: true, result: { ok: false } })
    const dir = fs.readdirSync(path.join(root, '草稿区/提案'))[0]!
    put(root, `草稿区/提案/${dir}/事实变更.md`, '# 作者改过的准备包\n')
    const before = snapshot(root)
    expect(await apply(root, args)).toMatchObject({ ok: false, reason: expect.stringMatching(/冲突/) })
    expect(snapshot(root)).toEqual(before)
  })
})
