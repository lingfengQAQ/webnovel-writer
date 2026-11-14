import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { scaffoldBookFiles } from '../src/book/scaffold'
import { contentHash } from '../src/commit/receipt'
import { inspectBookDocuments } from '../src/maintenance/inspection'
import { inspectChapterOpening } from '../src/maintenance/opening'
import { previewBookUpgrade } from '../src/maintenance/upgrade-plan'
import { applyBookUpgrade } from '../src/maintenance/upgrade'
import { createReadonlyBookSnapshot } from '../src/maintenance/snapshot'
import { removeSync } from '../src/repo/remove'

const temporaryParent = fs.realpathSync.native(os.tmpdir())
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(path.resolve(root)) !== temporaryParent || !path.basename(root).startsWith('maintenance-metadata-')) throw new Error('Unsafe fixture cleanup')
    removeSync(root)
  }
})

const git = (root: string, ...args: string[]) => execFileSync('git', ['--no-optional-locks', ...args], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
function fixture(legacy = false): string {
  const root = fs.mkdtempSync(path.join(temporaryParent, 'maintenance-metadata-'))
  roots.push(root)
  scaffoldBookFiles(root, { 状态: '已确认', 核心创意: '合成元数据检查。', 题材与目标读者: '测试' }, { bookId: 'metadata-fixture' })
  if (legacy) {
    const contract = path.join(root, '作品契约/契约.md')
    fs.writeFileSync(contract, fs.readFileSync(contract, 'utf8').replace('书仓格式版本: 1\n', ''))
  }
  git(root, 'init', '--quiet')
  git(root, 'config', 'user.name', 'Fixture')
  git(root, 'config', 'user.email', 'fixture@example.invalid')
  git(root, 'config', 'commit.gpgsign', 'false')
  git(root, 'config', 'core.hooksPath', '.git/hooks')
  git(root, 'config', 'core.autocrlf', 'false')
  git(root, 'add', '.')
  git(root, 'commit', '--quiet', '-m', 'fixture: Finder metadata')
  return root
}

const binary = Buffer.from([0, 0, 0, 1, 66, 117, 100, 49, 255])
function metadata(root: string, directory: string): string {
  const file = path.join(root, directory, '.DS_Store')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, binary)
  return file
}

function allBytes(root: string): Record<string, string> {
  const values: Record<string, string> = {}
  const walk = (relative: string): void => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const file = path.posix.join(relative, entry.name)
      if (entry.isSymbolicLink()) values[file] = `link:${fs.readlinkSync(path.join(root, file))}`
      else if (entry.isDirectory()) { values[`${file}/`] = ''; walk(file) }
      else values[file] = contentHash(fs.readFileSync(path.join(root, file)))
    }
  }
  walk('')
  return values
}

describe('Finder metadata is separate from book documents', { timeout: 90000 }, () => {
  it('ignores regular binary metadata across document, opening, runtime and receipt scans without writing', () => {
    const root = fixture()
    for (const directory of ['', '作品契约', '大纲/卷规划/卷01', '账本', '本书记忆', '定稿/卷01',
      '草稿区', '草稿区/草稿', '草稿区/材料包', '草稿区/审核', '草稿区/定稿准备',
      '草稿区/.archive-receipts', '草稿区/.maintenance-receipts', '.webnovel/transactions']) metadata(root, directory)
    expect(git(root, 'status', '--porcelain=v1')).toBe('')
    expect(git(root, 'ls-files', '--', '**/.DS_Store', '.DS_Store')).toBe('')
    const before = allBytes(root)
    expect(inspectBookDocuments(root).结论).toBe('未发现已知问题')
    expect(inspectChapterOpening(root)).toMatchObject({ 状态: '边界已核对', 问题: [] })
    expect(previewBookUpgrade(root)).toMatchObject({ state: 'unchanged', issues: [] })
    expect(allBytes(root)).toEqual(before)
  })

  it('keeps a preview valid when ignored Finder metadata appears or changes, and preserves it on apply', () => {
    const root = fixture(true), preview = previewBookUpgrade(root)
    expect(preview.state).toBe('ready')
    const file = metadata(root, '草稿区')
    const after = previewBookUpgrade(root)
    expect(after.fingerprint).toBe(preview.fingerprint)
    fs.writeFileSync(file, Buffer.from([255, 254, 253]))
    const result = applyBookUpgrade(root, { bookId: 'metadata-fixture', fingerprint: preview.fingerprint! })
    expect(result.state).toBe('committed')
    expect(fs.readFileSync(file)).toEqual(Buffer.from([255, 254, 253]))
    expect(git(root, 'ls-files', '--', '**/.DS_Store')).toBe('')
  })

  it('rechecks directory types and real membership while ignoring metadata creation, rewrite and removal', () => {
    const root = fixture(), reader = createReadonlyBookSnapshot(root)
    reader.listDirectory('草稿区')
    const file = metadata(root, '草稿区')
    expect(reader.finish().稳定).toBe(true)
    fs.writeFileSync(file, Buffer.from([255, 254]))
    expect(reader.finish().稳定).toBe(true)
    fs.unlinkSync(file)
    expect(reader.finish().稳定).toBe(true)
    fs.mkdirSync(file)
    expect(reader.finish()).toMatchObject({ 稳定: false, 变更: ['草稿区'] })
    expect(reader.issues).toContainEqual(expect.objectContaining({ 代码: 'READ_FAILED', 路径: '草稿区/.DS_Store' }))
    const other = createReadonlyBookSnapshot(root)
    other.listDirectory('账本')
    fs.writeFileSync(path.join(root, '账本/真实新文件.md'), '新内容')
    expect(other.finish().稳定).toBe(false)
  })

  it.each(['directory', 'junction', 'hardlink'] as const)('refuses a %s named .DS_Store even though Git ignores the name', kind => {
    const root = fixture(), file = path.join(root, '草稿区/.DS_Store')
    if (kind === 'directory') fs.mkdirSync(file)
    else if (kind === 'junction') fs.symlinkSync(path.join(root, '大纲'), file, process.platform === 'win32' ? 'junction' : 'dir')
    else fs.linkSync(path.join(root, '作品契约/契约.md'), file)
    const before = allBytes(root), preview = previewBookUpgrade(root)
    expect(preview.state).toBe('blocked')
    expect(preview).not.toHaveProperty('fingerprint')
    expect(preview.issues).toContainEqual(expect.objectContaining({ 代码: 'READ_FAILED', 路径: '草稿区/.DS_Store' }))
    expect(allBytes(root)).toEqual(before)
  })

  it('keeps unknown files and tracked metadata changes blocking', () => {
    const root = fixture(), file = metadata(root, '草稿区')
    fs.renameSync(file, path.join(root, '草稿区/.DS_Store.backup'))
    expect(previewBookUpgrade(root).state).toBe('blocked')
    fs.unlinkSync(path.join(root, '草稿区/.DS_Store.backup'))
    const tracked = metadata(root, '')
    git(root, 'add', '-f', '--', '.DS_Store')
    git(root, 'commit', '--quiet', '-m', 'fixture: tracked metadata')
    fs.writeFileSync(tracked, Buffer.from([254, 253]))
    expect(previewBookUpgrade(root).issues.some(issue => issue.代码 === 'UPGRADE_GIT_NOT_CLEAN')).toBe(true)
  })
})
