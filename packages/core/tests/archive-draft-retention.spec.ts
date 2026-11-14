import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { archiveChapter, inspectPendingSettlementRetention, type ArchiveOptions } from '../src/commit/archive'
import * as receiptModule from '../src/commit/receipt'
import {
  archiveReceiptCommit, archiveReceiptCommitted, archiveReceiptOp, contentHash,
  listArchiveReceipts, makeDraftRetentionReceipt, readArchiveReceipt, type ArchiveReceipt,
} from '../src/commit/receipt'
import { captureDraftRetention, draftRetentionDigest, type DraftRetentionManifest } from '../src/repo/draft-retention'
import { addDraftRetentionAnchor } from '../src/repo/retention-anchor'
import { parseDocument, serializeDocument } from '../src/repo/frontmatter'
import { paths } from '../src/repo/paths'
import { removeSync } from '../src/repo/remove'

const roots: string[] = []
const key = { 卷: 1, 章: 1, 章名: '初见' }
const chapterPath = paths.定稿章(key.卷, key.章, key.章名)
const summaryPath = paths.章摘要(key.卷, key.章, key.章名)
const directory = paths.草稿目录(key.卷, key.章名)
const sourceDraft = `${directory}/稿1.md`
const prose = '主角在城门看见铜铃。'

function temp(): string {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'archive-retention-'))
  roots.push(root)
  return root
}

function put(root: string, relative: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content)
}

function git(root: string, ...args: string[]): string {
  const result = spawnSync('git', ['--no-optional-locks', '-c', 'core.quotepath=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout.trim()
}

function fixture(): { options: ArchiveOptions; manifest: DraftRetentionManifest } {
  const root = temp()
  git(root, 'init')
  git(root, 'config', 'user.name', 'retention-test')
  git(root, 'config', 'user.email', 'retention-test@example.com')
  git(root, 'config', 'commit.gpgsign', 'false')
  git(root, 'config', 'core.autocrlf', 'false')
  git(root, 'config', 'core.hooksPath', '.git/hooks')
  put(root, '.gitignore', '草稿区/\n.webnovel/\n')
  put(root, paths.契约(), serializeDocument({ 书id: 'retention-test-book', 书仓格式版本: 1 }, '# 作品契约'))
  put(root, '账本/时间线.md', '# 时间线\n')
  git(root, 'add', '.')
  git(root, 'commit', '--quiet', '-m', 'vol: 合成书仓')
  put(root, sourceDraft, serializeDocument({ 身份: key, 版本: 1, 角色: '待审稿', 选定: true }, prose))
  put(root, `${directory}/稿2.md`, serializeDocument({ 身份: key, 版本: 2, 角色: '草稿', 选定: false, 保真风险: ['另一种交易'] }, '未选用的另一稿。'))
  put(root, `${directory}/稿1.起草中.txt`, '主角刚到城门，')
  const { manifest } = captureDraftRetention(root, { bookId: 'retention-test-book', chapter: key, sourceDraft })
  const packageDir = paths.待定稿包目录(key.卷, key.章名)
  const finalText = serializeDocument({ 身份: key, 状态: '已定稿', 版本: 1, 生成模块: '定稿入档', 恢复信息: { 来源草稿: sourceDraft }, 草稿留档摘要: draftRetentionDigest(manifest) }, prose)
  const summaryText = '# 章摘要\n\n初见铜铃。\n'
  for (const [name, content] of Object.entries({
    '正文.md': finalText,
    '章摘要.md': summaryText,
    '事实变更.md': '# 事实变更\n\n（无事实变更）\n',
    '时间线变更.md': '# 时间线变更\n\n## 看见铜铃\n事件：主角看见铜铃\n',
    '账本变更.md': '# 账本变更\n\n（无账本变更）\n',
    '本书层记忆候选.md': '# 本书层记忆候选\n\n（无记忆候选）\n',
    '卷对账.md': '# 卷对账\n\n无偏离\n',
    '清单.json': JSON.stringify({ schemaVersion: 1, 草稿留档: manifest, 文件: [
      { 源: '正文.md', 目标: chapterPath, sha256: contentHash(finalText) },
      { 源: '章摘要.md', 目标: summaryPath, sha256: contentHash(summaryText) },
    ] }),
  })) put(root, `${packageDir}/${name}`, content)
  return { options: { bookRoot: root, packageDir, summary: '初见定稿', settlement: { 章节: key, 批准: true, 裁决记录: '批准完整留档清单' } }, manifest }
}

function failCommit(root: string): void {
  put(root, '.git/hooks/pre-commit', '#!/bin/sh\nexit 1\n')
  fs.chmodSync(path.join(root, '.git/hooks/pre-commit'), 0o755)
}

function removeFailure(root: string): void { fs.unlinkSync(path.join(root, '.git/hooks/pre-commit')) }

function savedReceipt(root: string): ArchiveReceipt {
  const receipts = listArchiveReceipts(root)
  expect(receipts).toHaveLength(1)
  return receipts[0]!
}

function outputs(root: string, receipt: ArchiveReceipt): Record<string, string> {
  return Object.fromEntries(receipt.outputs.map(output => [output.relPath, fs.readFileSync(path.join(root, output.relPath), 'utf8')]))
}

function packageJson(options: ArchiveOptions): { file: string; data: Record<string, any> } {
  const file = path.join(options.bookRoot, options.packageDir!, '清单.json')
  return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) }
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

afterEach(() => vi.restoreAllMocks())

afterAll(() => {
  const parent = fs.realpathSync.native(os.tmpdir())
  for (const root of roots.reverse()) {
    if (path.dirname(path.resolve(root)) !== parent || !path.basename(root).startsWith('archive-retention-')) throw new Error('Unsafe fixture cleanup')
    removeSync(root)
  }
})

function inProcess(options: ArchiveOptions, mode: 'lost-response' | 'write-fault'): ReturnType<typeof spawnSync> {
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
  return spawnSync(process.execPath, ['-e', source, archiveModule, JSON.stringify(options), mode], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
}

describe('归档留档清单与schema3同批提交', () => {
  it('归档复制冻结清单并绑定提交前后树，草稿原字节不进入Git', () => {
    const { options, manifest } = fixture(), root = options.bookRoot
    const before = Object.fromEntries(manifest.files.map(file => [file.relPath, fs.readFileSync(path.join(root, file.relPath), 'utf8')]))
    const base = git(root, 'rev-parse', 'HEAD')
    expect(archiveChapter(options).ok).toBe(true)
    const receipt = savedReceipt(root)
    expect(receipt).toMatchObject({ schema: 3, kind: 'archive', mode: 'ch', baseHead: base, retention: manifest })
    expect(receipt.outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ relPath: chapterPath, beforeGitBlob: null }),
      expect.objectContaining({ relPath: summaryPath, beforeGitBlob: null }),
      expect.objectContaining({ relPath: '账本/时间线.md', beforeGitBlob: git(root, 'rev-parse', `${base}:账本/时间线.md`) }),
    ]))
    expect(archiveReceiptCommit(root, receipt)).toBe(git(root, 'rev-parse', 'HEAD'))
    expect(git(root, 'ls-files')).not.toContain('草稿区/')
    for (const [relative, text] of Object.entries(before)) expect(fs.readFileSync(path.join(root, relative), 'utf8')).toBe(text)
  })

  it.each(['manifest', 'marker', 'changed', 'new', 'missing', 'book'] as const)('准备后%s冲突在真源写入前拒绝，不扩大清单', kind => {
    const { options } = fixture(), root = options.bookRoot
    const base = git(root, 'rev-parse', 'HEAD')
    const input = packageJson(options)
    if (kind === 'manifest') delete input.data['草稿留档']
    if (kind === 'marker') {
      const file = path.join(root, options.packageDir!, '正文.md')
      const doc = parseDocument(fs.readFileSync(file, 'utf8'))
      if (!doc.ok) throw new Error(doc.detail)
      const text = serializeDocument(Object.fromEntries(Object.entries(doc.data.fields).filter(([name]) => name !== '草稿留档摘要')), doc.data.body)
      fs.writeFileSync(file, text)
      input.data['文件'][0].sha256 = contentHash(text)
    }
    if (kind === 'changed') put(root, `${directory}/稿1.起草中.txt`, '准备后改过的半稿。')
    if (kind === 'new') put(root, `${directory}/稿3.md`, serializeDocument({ 身份: key, 版本: 3 }, '准备后新增。'))
    if (kind === 'missing') fs.unlinkSync(path.join(root, `${directory}/稿2.md`))
    if (kind === 'book') put(root, paths.契约(), serializeDocument({ 书id: 'another-book' }, '# 作品契约'))
    fs.writeFileSync(input.file, JSON.stringify(input.data))
    expect(archiveChapter(options)).toMatchObject({ ok: false, reason: expect.stringMatching(/留档|草稿|摘要|书身份/) })
    expect(fs.existsSync(path.join(root, chapterPath))).toBe(false)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(base)
  })

  it('清单被扩写后重算checksum，也无法借原提交证明新集合', () => {
    const { options } = fixture(), root = options.bookRoot
    expect(archiveChapter(options).ok).toBe(true)
    const receipt = savedReceipt(root)
    if (receipt.schema !== 3) throw new Error('Missing schema3')
    const forged = { ...receipt, retention: { ...receipt.retention, files: [
      ...receipt.retention.files, { relPath: `${directory}/稿3.md`, kind: 'draft' as const, sha256: 'a'.repeat(64) },
    ] } }
    const op = archiveReceiptOp(forged)
    put(root, op.relPath, op.content)
    const reread = readArchiveReceipt(root, forged.scope)!
    expect(archiveReceiptCommitted(root, reread)).toBe(false)
    expect(archiveChapter(options).ok).toBe(false)
  })

  it('新收据被改成旧schema并重算checksum，重试不能回退旧证明', () => {
    const { options } = fixture(), root = options.bookRoot
    expect(archiveChapter(options).ok).toBe(true)
    const receipt = savedReceipt(root)
    const downgraded: ArchiveReceipt = {
      schema: 1, mode: 'ch', scope: receipt.scope, request: receipt.request, message: receipt.message, baseHead: receipt.baseHead,
      outputs: receipt.outputs.map(({ relPath, sha256, gitBlob }) => ({ relPath, sha256, gitBlob })),
    }
    const op = archiveReceiptOp(downgraded)
    put(root, op.relPath, op.content)
    const head = git(root, 'rev-parse', 'HEAD')
    expect(archiveChapter(options)).toMatchObject({ ok: false, reason: expect.stringMatching(/不能回退/) })
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
  })

  it('新格式缺前态、错误种类、未来字段或已存在的新章前态均拒绝', () => {
    const { options } = fixture(), root = options.bookRoot
    expect(archiveChapter(options).ok).toBe(true)
    const receipt = savedReceipt(root), location = archiveReceiptOp(receipt).relPath
    const mutations = [
      (value: Record<string, any>) => { delete value.outputs[0].beforeGitBlob },
      (value: Record<string, any>) => { value.mode = 'retcon' },
      (value: Record<string, any>) => { value.futureEvidence = true },
      (value: Record<string, any>) => { value.outputs.find((output: { relPath: string }) => output.relPath === chapterPath).beforeGitBlob = 'a'.repeat(40) },
    ]
    for (const mutate of mutations) {
      const value = JSON.parse(JSON.stringify(receipt))
      mutate(value)
      put(root, location, JSON.stringify({ checksum: contentHash(JSON.stringify(value)), receipt: value }))
      expect(() => readArchiveReceipt(root, receipt.scope)).toThrow(/收据损坏/)
    }
  })

  it('真实提交失败后允许无关提交介入，只补原输出与原清单', () => {
    const { options } = fixture(), root = options.bookRoot
    failCommit(root)
    expect(archiveChapter(options)).toMatchObject({ ok: false, written: true })
    const receipt = savedReceipt(root), before = outputs(root, receipt)
    removeFailure(root)
    put(root, '大纲/其他.md', '无关设计。\n')
    git(root, 'add', '大纲/其他.md')
    git(root, 'commit', '--only', '--quiet', '-m', 'design: 无关设计', '--', '大纲/其他.md')
    expect(archiveChapter(options)).toMatchObject({ ok: true })
    expect(outputs(root, receipt)).toEqual(before)
    expect(savedReceipt(root)).toEqual(receipt)
    expect(before['账本/时间线.md']!.match(/^## 看见铜铃$/gm)).toHaveLength(1)
    expect(archiveReceiptCommitted(root, receipt)).toBe(true)
  })

  it('非来源留档缺失仍拒绝工具补交，并给作者可核对的整批恢复路径', () => {
    const { options } = fixture(), root = options.bookRoot
    failCommit(root)
    expect(archiveChapter(options)).toMatchObject({ ok: false, written: true })
    const receipt = savedReceipt(root), before = outputs(root, receipt), head = git(root, 'rev-parse', 'HEAD')
    fs.unlinkSync(path.join(root, directory, '稿2.md'))
    const retry = archiveChapter(options)
    expect(retry).toMatchObject({ ok: false, written: true, reason: expect.stringContaining('非来源留档已缺失'), next: expect.stringContaining('一次性手动提交') })
    if (retry.ok) throw new Error('Unexpected archive')
    for (const output of receipt.outputs) expect(retry.next).toContain(output.relPath)
    expect(inspectPendingSettlementRetention(root, key)).toEqual({ reason: retry.reason, next: retry.next })
    expect(outputs(root, receipt)).toEqual(before)
    expect(savedReceipt(root)).toEqual(receipt)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)

    removeFailure(root)
    put(root, '大纲/其他.md', '无关暂存。\n')
    git(root, 'add', '--', '大纲/其他.md')
    git(root, '--literal-pathspecs', 'commit', '--only', '--quiet', '-m', '作者核对后一次补交', '--', ...receipt.outputs.map(output => output.relPath))
    expect(git(root, 'diff', '--cached', '--name-only')).toBe('大纲/其他.md')
    expect(archiveChapter(options)).toMatchObject({ ok: true, alreadyCommitted: true })
    expect(outputs(root, receipt)).toEqual(before)
  }, 30_000)

  it('恢复提示不适用于来源缺失、变化、新文件、改包、输出冲突或分批提交', () => {
    const { options } = fixture(), root = options.bookRoot
    failCommit(root)
    expect(archiveChapter(options)).toMatchObject({ ok: false, written: true })
    const receipt = savedReceipt(root), original = outputs(root, receipt), sourceText = fs.readFileSync(path.join(root, sourceDraft), 'utf8')
    fs.unlinkSync(path.join(root, directory, '稿2.md'))
    fs.unlinkSync(path.join(root, sourceDraft))
    expect(inspectPendingSettlementRetention(root, key)).toBeUndefined()
    put(root, sourceDraft, sourceText + '\n改变过的来源。')
    expect(inspectPendingSettlementRetention(root, key)).toBeUndefined()
    put(root, sourceDraft, sourceText)
    put(root, `${directory}/稿3.md`, '新写的草稿。')
    expect(inspectPendingSettlementRetention(root, key)).toBeUndefined()
    fs.unlinkSync(path.join(root, directory, '稿3.md'))
    const candidatePath = `${options.packageDir}/时间线变更.md`, candidate = fs.readFileSync(path.join(root, candidatePath), 'utf8')
    put(root, candidatePath, candidate + '\n后来改变的请求。')
    expect(inspectPendingSettlementRetention(root, key)).toBeUndefined()
    put(root, candidatePath, candidate)
    put(root, chapterPath, original[chapterPath]! + '\n作者改过定稿。')
    expect(() => inspectPendingSettlementRetention(root, key)).toThrow('目标冲突')
    put(root, chapterPath, original[chapterPath]!)
    removeFailure(root)
    git(root, '--literal-pathspecs', 'commit', '--only', '--quiet', '-m', '先交一部分', '--', chapterPath)
    expect(() => inspectPendingSettlementRetention(root, key)).toThrow('分批提交')
    expect(outputs(root, receipt)).toEqual(original)
  }, 45_000)

  it('收据构造前出现的已有目标属于写前拒绝，不误报原子写入失败', () => {
    const { options } = fixture(), root = options.bookRoot
    const make = receiptModule.makeArchiveReceipt
    let introduced = false
    vi.spyOn(receiptModule, 'makeArchiveReceipt').mockImplementation((...args) => {
      introduced = true
      put(root, chapterPath, '外部先提交的定稿。\n')
      put(root, summaryPath, '外部先提交的摘要。\n')
      git(root, 'add', '--', chapterPath, summaryPath)
      git(root, 'commit', '--quiet', '-m', '外部抢先入档')
      return make(...args)
    })
    const result = archiveChapter(options)
    expect(introduced).toBe(true)
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('归档写入前核对失败，本次没有写入：新归档须同时新建本章定稿与章摘要') })
    expect(result).not.toHaveProperty('written')
    expect(fs.readFileSync(path.join(root, chapterPath), 'utf8')).toBe('外部先提交的定稿。\n')
    expect(fs.readFileSync(path.join(root, '账本/时间线.md'), 'utf8')).toBe('# 时间线\n')
    expect(listArchiveReceipts(root)).toEqual([])
  })

  it('一次人工补交不要求原提交说明，再调用不重复提交', () => {
    const { options } = fixture(), root = options.bookRoot
    failCommit(root)
    expect(archiveChapter(options)).toMatchObject({ ok: false, written: true })
    const receipt = savedReceipt(root)
    removeFailure(root)
    git(root, 'commit', '--quiet', '-m', '作者一次补交')
    const head = git(root, 'rev-parse', 'HEAD')
    expect(archiveReceiptCommit(root, receipt)).toBe(head)
    expect(archiveChapter(options)).toMatchObject({ ok: true, alreadyCommitted: true })
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
  })

  it('两次人工提交后的完整树不是同批；重试不得再补一个提交凑数', () => {
    const { options } = fixture(), root = options.bookRoot
    failCommit(root)
    expect(archiveChapter(options)).toMatchObject({ ok: false, written: true })
    const receipt = savedReceipt(root), before = outputs(root, receipt)
    removeFailure(root)
    git(root, 'reset', '--quiet')
    git(root, 'add', '--', chapterPath)
    git(root, 'commit', '--quiet', '-m', '作者先交定稿')
    git(root, 'add', '--', ...receipt.outputs.filter(output => output.relPath !== chapterPath).map(output => output.relPath))
    git(root, 'commit', '--quiet', '-m', '作者另交摘要与沉淀')
    const head = git(root, 'rev-parse', 'HEAD')
    expect(archiveReceiptCommitted(root, receipt)).toBe(false)
    expect(archiveChapter(options)).toMatchObject({ ok: false, written: true, reason: expect.stringMatching(/分批|前态/) })
    expect(outputs(root, receipt)).toEqual(before)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
  })

  it('新进程提交后响应丢失，重放仍认出原schema3提交', () => {
    const { options } = fixture(), root = options.bookRoot
    const first = inProcess(options, 'lost-response')
    expect(first.status, String(first.stderr)).toBe(88)
    const head = git(root, 'rev-parse', 'HEAD')
    expect(archiveChapter(options)).toMatchObject({ ok: true, alreadyCommitted: true })
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
  })

  it('新收据写入失败时，正文与沉淀和收据同批回滚', () => {
    const { options } = fixture(), root = options.bookRoot
    const timeline = fs.readFileSync(path.join(root, '账本/时间线.md'), 'utf8')
    const first = inProcess(options, 'write-fault')
    expect(first.status, String(first.stderr)).toBe(0)
    expect(JSON.parse(String(first.stdout))).toMatchObject({ result: { ok: false }, faultHit: true })
    expect(fs.existsSync(path.join(root, chapterPath))).toBe(false)
    expect(fs.readFileSync(path.join(root, '账本/时间线.md'), 'utf8')).toBe(timeline)
    expect(listArchiveReceipts(root)).toEqual([])
    expect(archiveChapter(options).ok).toBe(true)
  })

  it('稳定缺失非来源留档不使已完成的精确重试重新归档', () => {
    const { options } = fixture(), root = options.bookRoot
    expect(archiveChapter(options).ok).toBe(true)
    fs.unlinkSync(path.join(root, `${directory}/稿2.md`))
    const head = git(root, 'rev-parse', 'HEAD')
    expect(archiveChapter(options)).toMatchObject({ ok: true, alreadyCommitted: true })
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
  })
})

describe('旧章元数据留档收据', () => {
  function oldChapter() {
    const f = fixture(), root = f.options.bookRoot
    const before = '\uFEFF' + serializeDocument({ 身份: key, 状态: '已定稿', 版本: 2, 生成模块: '吃书补偿', 恢复信息: { 来源草稿: sourceDraft } }, '后来合法补偿过的正文。').replace(/\n/g, '\r\n')
    put(root, chapterPath, before)
    put(root, summaryPath, '# 章摘要\r\n\r\n旧章已经完成。\r\n')
    git(root, 'add', '--', chapterPath, summaryPath)
    git(root, 'commit', '--quiet', '-m', 'ch: 合成旧章')
    const origin = { head: git(root, 'rev-parse', 'HEAD'), chapterGitBlob: git(root, 'rev-parse', `HEAD:${chapterPath}`),
      summaryPath, summaryGitBlob: git(root, 'rev-parse', `HEAD:${summaryPath}`) }
    const after = addDraftRetentionAnchor(before, draftRetentionDigest(f.manifest))
    const op = { relPath: chapterPath, content: after }
    const identity = { scope: 'c'.repeat(64), request: 'd'.repeat(64), message: 'fix: 作者现在确认留档' }
    const receipt = makeDraftRetentionReceipt(root, identity, op, f.manifest, origin)
    return { ...f, root, before, op, identity, origin, receipt }
  }

  it('只证明本次元数据提交，保存原正文/BOM/CRLF并允许无关提交介入', () => {
    const f = oldChapter()
    put(f.root, f.op.relPath, f.op.content)
    const receiptOp = archiveReceiptOp(f.receipt)
    put(f.root, receiptOp.relPath, receiptOp.content)
    put(f.root, '大纲/其他.md', '独立修改\n')
    git(f.root, 'add', '--', '大纲/其他.md')
    git(f.root, 'commit', '--quiet', '-m', 'design: 无关修改')
    git(f.root, 'add', '--', chapterPath)
    git(f.root, 'commit', '--quiet', '-m', f.receipt.message)
    expect(archiveReceiptCommit(f.root, readArchiveReceipt(f.root, f.receipt.scope)!)).toBe(git(f.root, 'rev-parse', 'HEAD'))
    expect(fs.readFileSync(path.join(f.root, chapterPath), 'utf8')).toBe(f.op.content)
    expect(f.op.content.startsWith('\uFEFF---\r\n')).toBe(true)
    expect(f.op.content.endsWith('后来合法补偿过的正文。\r\n')).toBe(true)
  })

  it('实际父提交中的旧章摘要变化，拒绝沿用原origin', () => {
    const f = oldChapter()
    put(f.root, chapterPath, f.op.content)
    put(f.root, summaryPath, '# 章摘要\n\n其他修改。\n')
    git(f.root, 'add', '--', summaryPath)
    git(f.root, 'commit', '--quiet', '-m', '先改变旧章摘要')
    git(f.root, 'add', '--', chapterPath)
    git(f.root, 'commit', '--quiet', '-m', f.receipt.message)
    expect(archiveReceiptCommitted(f.root, f.receipt)).toBe(false)
  })

  it('元数据确认不得改正文或重排原头部空白', () => {
    const f = oldChapter()
    for (const content of [f.op.content.replace('后来合法补偿过的正文。', '被另改的正文。'), f.op.content.replace('版本: 2', '版本:   2')]) {
      expect(() => makeDraftRetentionReceipt(f.root, f.identity, { ...f.op, content }, f.manifest, f.origin)).toThrow(/保留|只能/)
    }
  })
})
