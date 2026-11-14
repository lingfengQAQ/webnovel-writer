import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import childProcess, { execFileSync } from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scaffoldBookFiles } from '../src/book/scaffold'
import { previewDraftRetention } from '../src/maintenance/draft-retention'
import { openingGit } from '../src/maintenance/opening-git'
import { paths } from '../src/repo/paths'
import { serializeDocument } from '../src/repo/frontmatter'
import { removeSync } from '../src/repo/remove'

const temporary = fs.realpathSync.native(os.tmpdir())
const roots: string[] = []
const chapter = { 卷: 1, 章: 1, 章名: '渡口 夜话' }

function fixture(ignore = '草稿区/\n.webnovel/\n'): string {
  const root = fs.mkdtempSync(path.join(temporary, 'retention ignore-'))
  roots.push(root)
  scaffoldBookFiles(root, { 状态: '已确认', 核心创意: '核对旧船票。', 题材与目标读者: '合成测试' }, { bookId: 'retention-ignore' })
  const put = (relative: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
    fs.writeFileSync(path.join(root, relative), text)
  }
  put('.gitignore', ignore)
  const directory = paths.草稿目录(chapter.卷, chapter.章名), source = `${directory}/稿1.md`
  const prose = '来客站在渡口。'
  put(source, serializeDocument({ 身份: chapter, 角色: '待审稿', 选定: true, 版本: 1 }, prose))
  put(`${directory}/稿2.md`, serializeDocument({ 身份: chapter, 角色: '草稿', 选定: false, 版本: 2 }, '另一种表达。'))
  put(`${directory}/稿1.起草中.txt`, '起草片段。')
  put(paths.定稿章(chapter.卷, chapter.章, chapter.章名), serializeDocument({ 身份: chapter, 状态: '已定稿', 章号: chapter.章,
    版本: 1, 生成模块: '定稿入档', 恢复信息: { 来源草稿: source }, 来源快照: { 来源草稿: source } }, prose))
  put(paths.章摘要(chapter.卷, chapter.章, chapter.章名), '# 章摘要\n\n来客抵达渡口。\n')
  const git = (...args: string[]) => execFileSync('git', ['--no-optional-locks', ...args], { cwd: root, encoding: 'utf8', windowsHide: true })
  git('init', '--quiet')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'core.autocrlf', 'false')
  git('config', 'core.hooksPath', '.git/hooks')
  git('add', '.')
  git('commit', '--quiet', '-m', 'ch: 合成旧章')
  return root
}

afterEach(() => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  for (const root of roots.splice(0)) {
    if (path.dirname(path.resolve(root)) !== temporary || !path.basename(root).startsWith('retention ignore-')) throw new Error('Unsafe ignore fixture cleanup')
    removeSync(root)
  }
})

describe('retention ignores use one literal batch', () => {
  it('preserves NUL-separated Unicode, spaces and newlines through readonly Git stdin', () => {
    const root = fixture()
    const files = ['草稿区/带 空格.md', '草稿区/换\n行.md']
    const ignored = openingGit(root, ['check-ignore', '--no-index', '--stdin', '-z'], files.join('\0') + '\0')
    expect(ignored.status, ignored.stderr).toBe(0)
    expect(ignored.stdout.split('\0').filter(Boolean)).toEqual(files)
    const none = openingGit(root, ['check-ignore', '--no-index', '--stdin', '-z'], '.gitignore\0')
    expect(none.status).toBe(1)
    expect(none.stdout).toBe('')
    fs.writeFileSync(path.join(root, '.gitignore'), '草稿区/*\n!草稿区/未忽略.md\n')
    const mixed = openingGit(root, ['check-ignore', '--no-index', '--stdin', '-z'], '草稿区/未忽略.md\0草稿区/其他.md\0')
    expect(mixed.status).toBe(0)
    expect(mixed.stdout).toBe('草稿区/其他.md\0')
  })

  it('checks all draft paths and the future receipt with a single Git process', () => {
    const root = fixture(), spawn = childProcess.spawnSync.bind(childProcess)
    const inputs: string[] = []
    vi.spyOn(childProcess, 'spawnSync').mockImplementation(((command: string, args: readonly string[], options: { input?: string }) => {
      if (command === 'git' && args.includes('check-ignore')) inputs.push(options.input ?? '')
      return spawn(command, args, options)
    }) as typeof childProcess.spawnSync)
    syncBuiltinESMExports()
    const preview = previewDraftRetention(root, chapter)
    expect(preview, JSON.stringify(preview)).toMatchObject({ ok: true, state: 'ready' })
    expect(inputs).toHaveLength(1)
    expect(inputs[0]!.split('\0').filter(Boolean)).toHaveLength(4)
    expect(inputs[0]).toContain('渡口 夜话/稿2.md\0')
    expect(inputs[0]).toContain('草稿区/.archive-receipts/')
  })

  it('rejects a missing ignore rule for the future receipt even when all existing drafts match', () => {
    const root = fixture('草稿区/草稿/\n.webnovel/\n')
    const preview = previewDraftRetention(root, chapter)
    expect(preview).toMatchObject({ ok: false, state: 'blocked' })
    expect(preview.issues).toContainEqual(expect.objectContaining({ 说明: expect.stringContaining('现有未跟踪的忽略范围') }))
  })

  it('rejects a Git error even if stdout happens to contain every requested path', () => {
    const root = fixture(), spawn = childProcess.spawnSync.bind(childProcess)
    let failed = false
    vi.spyOn(childProcess, 'spawnSync').mockImplementation(((command: string, args: readonly string[], options: { input?: string }) => {
      if (command === 'git' && args.includes('check-ignore')) {
        failed = true
        return { status: 128, stdout: options.input ?? '', stderr: 'fixture ignore failure' }
      }
      return spawn(command, args, options)
    }) as typeof childProcess.spawnSync)
    syncBuiltinESMExports()
    const preview = previewDraftRetention(root, chapter)
    expect(failed).toBe(true)
    expect(preview).toMatchObject({ ok: false, state: 'blocked' })
    expect(preview.issues).toContainEqual(expect.objectContaining({ 说明: expect.stringContaining('现有未跟踪的忽略范围') }))
  })
})
