import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawnSync } from 'node:child_process'
import { checkGitHealth } from '../src/commit/health'
import { formatCommitMessage } from '../src/commit/message'
import { checkCommitRelPath } from '../src/commit/paths'
import { archiveChapter, archiveRetcon } from '../src/commit/archive'
import { commitConfirmed } from '../src/commit/design'
import { lastCommitOf } from '../src/commit/history'

const roots: string[] = []
function mkDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

function git(cwd: string, args: readonly string[]): ReturnType<typeof spawnSync> {
  return spawnSync('git', args, { cwd, encoding: 'utf-8', windowsHide: true })
}

function initRepo(): string {
  const root = mkDir('webnovel-git-')
  const init = git(root, ['init'])
  expect(init.status).toBe(0)
  git(root, ['config', 'user.email', 'test@example.com'])
  git(root, ['config', 'user.name', 'test'])
  git(root, ['config', 'commit.gpgsign', 'false'])
  return root
}

describe('git 健康检查(B6)', () => {
  it('干净仓库通过', () => {
    const root = initRepo()
    expect(checkGitHealth(root)).toEqual({ ok: true })
  })

  it('MERGE_HEAD→不通过', () => {
    const root = initRepo()
    fs.writeFileSync(path.join(root, '.git', 'MERGE_HEAD'), 'deadbeef\n')
    const h = checkGitHealth(root)
    expect(h.ok).toBe(false)
    if (!h.ok) expect(h.reason).toMatch(/合并|B6/)
  })

  it('worktree 里 .git 是文件,进行中状态仍能查到', () => {
    // 一本书仓内部开 worktree 做改稿对比是正当用法(见 single-workspace-rework.md §5)。
    // 那时 `<worktree>/.git` 是文件,状态存在 `<主仓>/.git/worktrees/<名>/` 内。
    const main = initRepo()
    fs.writeFileSync(path.join(main, '初章.md'), '正文\n')
    expect(git(main, ['add', '.']).status).toBe(0)
    expect(git(main, ['commit', '-m', 'ch: 首提交']).status).toBe(0)
    const wt = path.join(main, '..', path.basename(main) + '-改稿')
    roots.push(path.resolve(wt))
    expect(git(main, ['worktree', 'add', wt, '-b', '改稿']).status).toBe(0)

    expect(fs.statSync(path.join(wt, '.git')).isFile()).toBe(true)
    expect(checkGitHealth(wt)).toEqual({ ok: true })

    const gitDir = /gitdir:\s*(.+)/.exec(fs.readFileSync(path.join(wt, '.git'), 'utf-8'))?.[1]?.trim()
    expect(gitDir).toBeDefined()
    fs.writeFileSync(path.join(gitDir!, 'MERGE_HEAD'), 'deadbeef\n')
    const h = checkGitHealth(wt)
    expect(h.ok).toBe(false)
    if (!h.ok) expect(h.reason).toMatch(/合并|B6/)
  })

  it('.git 是文件但指针指向不存在的目录→不通过', () => {
    const root = mkDir('webnovel-git-bad-')
    fs.writeFileSync(path.join(root, '.git'), 'gitdir: ./不存在的目录\n')
    const h = checkGitHealth(root)
    expect(h.ok).toBe(false)
    if (!h.ok) expect(h.reason).toMatch(/版本库|B6/)
  })
})

describe('提交说明(D4)', () => {
  it('前缀格式', () => {
    expect(formatCommitMessage({ prefix: 'ch', summary: '初见入档' })).toBe('ch: 初见入档')
    expect(formatCommitMessage({ prefix: 'vol', summary: '卷一收束' })).toMatch(/^vol:/)
    expect(formatCommitMessage({ prefix: 'fix', summary: '补登' })).toMatch(/^fix:/)
    expect(formatCommitMessage({ prefix: 'retcon', summary: '死亡更正', kind: '吃书补偿' })).toMatch(/^retcon:/)
  })

  it('retcon 仅补偿通道', () => {
    expect(() => formatCommitMessage({ prefix: 'retcon', summary: '偷改' })).toThrow(/retcon: 前缀仅补偿通道可产生/)
  })
})

describe('提交路径(不变量 8)', () => {
  it('拒绝知识库正文', () => {
    const r = checkCommitRelPath('知识库/写作方法库/节拍.md')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/知识库条目正文不得进入定稿提交/)
  })

  it('允许定稿真源', () => {
    expect(checkCommitRelPath('定稿/卷01/0003-初见.md').ok).toBe(true)
  })
})

describe('清单入档', () => {
  it('快乐路径:清单一项写入定稿并 ch: 提交', () => {
    const root = initRepo()
    const pkg = path.join(root, '草稿区/定稿准备/卷01-初见')
    fs.mkdirSync(pkg, { recursive: true })
    fs.writeFileSync(path.join(pkg, '正文.md'), '第一章\n', 'utf-8')
    fs.writeFileSync(path.join(pkg, '清单.json'), JSON.stringify({
      schemaVersion: 1,
      文件: [{ 源: '正文.md', 目标: '定稿/卷01/0003-初见.md' }],
    }))
    const r = archiveChapter({ bookRoot: root, packageDir: pkg, summary: '初见入档' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.message.startsWith('ch:')).toBe(true)
    expect(fs.readFileSync(path.join(root, '定稿/卷01/0003-初见.md'), 'utf-8')).toBe('第一章\n')
    const log = git(root, ['log', '-1', '--pretty=%s'])
    expect(log.status).toBe(0)
    expect((log.stdout ?? '').trim().startsWith('ch:')).toBe(true)
  })

  it('章号跨卷重复被拒:章号全书连续(格式规格 §2.2)', () => {
    const root = initRepo()
    fs.mkdirSync(path.join(root, '定稿/卷01'), { recursive: true })
    fs.writeFileSync(path.join(root, '定稿/卷01/0005-已有.md'), '旧章\n', 'utf-8')
    const pkg = path.join(root, '草稿区/定稿准备/卷02-新章')
    fs.mkdirSync(pkg, { recursive: true })
    fs.writeFileSync(path.join(pkg, '正文.md'), '新章\n', 'utf-8')
    fs.writeFileSync(path.join(pkg, '清单.json'), JSON.stringify({
      schemaVersion: 1,
      文件: [{ 源: '正文.md', 目标: '定稿/卷02/0005-新章.md' }],
    }))
    const r = archiveChapter({ bookRoot: root, packageDir: pkg, summary: '新章入档' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/章号/)
    expect(r.reason).toContain('定稿/卷01/0005-已有.md')
    expect(fs.existsSync(path.join(root, '定稿/卷02/0005-新章.md'))).toBe(false)
  })

  it('同卷内递增章号正常入档', () => {
    const root = initRepo()
    fs.mkdirSync(path.join(root, '定稿/卷01'), { recursive: true })
    fs.writeFileSync(path.join(root, '定稿/卷01/0005-已有.md'), '旧章\n', 'utf-8')
    const pkg = path.join(root, '草稿区/定稿准备/卷02-续章')
    fs.mkdirSync(pkg, { recursive: true })
    fs.writeFileSync(path.join(pkg, '正文.md'), '续章\n', 'utf-8')
    fs.writeFileSync(path.join(pkg, '清单.json'), JSON.stringify({
      schemaVersion: 1,
      文件: [{ 源: '正文.md', 目标: '定稿/卷02/0006-续章.md' }],
    }))
    expect(archiveChapter({ bookRoot: root, packageDir: pkg, summary: '续章入档' }).ok).toBe(true)
  })

  it('补偿入口才产生 retcon: 前缀', () => {
    const root = initRepo()
    const r = archiveRetcon({
      bookRoot: root,
      files: [{ 目标: '世界书/人物/甲.md', 内容: '更正\n' }],
      summary: '死亡更正',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.message.startsWith('retcon:')).toBe(true)
    const log = git(root, ['log', '-1', '--pretty=%s'])
    expect((log.stdout ?? '').trim().startsWith('retcon:')).toBe(true)
  })

  it('健康检查失败:不写文件、不提交', () => {
    const root = initRepo()
    fs.writeFileSync(path.join(root, '.git', 'MERGE_HEAD'), 'deadbeef\n')
    const dest = '定稿/卷01/0003-初见.md'
    const r = archiveChapter({
      bookRoot: root,
      files: [{ 目标: dest, 内容: '不该出现\n' }],
      summary: '初见入档',
    })
    expect(r.ok).toBe(false)
    expect(fs.existsSync(path.join(root, dest))).toBe(false)
    const log = git(root, ['log', '-1', '--pretty=%s'])
    expect(log.status).not.toBe(0)
  })
})

describe('提交说明:design 前缀与章号 Scope(拍板 1/7)', () => {
  it('design 携带活跃章 Scope,格式 design(chNNNN):', () => {
    expect(formatCommitMessage({ prefix: 'design', summary: '确认细纲', chapterScope: 12 })).toBe('design(ch0012): 确认细纲')
    expect(formatCommitMessage({ prefix: 'design', summary: '确认契约·核心设定' })).toBe('design: 确认契约·核心设定')
  })

  it('Scope 仅 design: 前缀携带', () => {
    expect(() => formatCommitMessage({ prefix: 'ch', summary: '初见入档', chapterScope: 3 })).toThrow(/Scope/)
    expect(() => formatCommitMessage({ prefix: 'fix', summary: '补登', chapterScope: 3 })).toThrow(/Scope/)
  })
})

describe('设计侧确认提交(commitConfirmed,拍板 1/2/7)', () => {
  it('隔离预先 staged 的无关文件,提交只包含本次目标且原暂存仍在', () => {
    const root = initRepo()
    fs.mkdirSync(path.join(root, '作品契约'), { recursive: true })
    fs.writeFileSync(path.join(root, '作品契约/无关.md'), '旧\n', 'utf-8')
    expect(git(root, ['add', '.']).status).toBe(0)
    expect(git(root, ['commit', '-m', 'vol: 基线']).status).toBe(0)
    fs.writeFileSync(path.join(root, '作品契约/无关.md'), '作者暂存修改\n', 'utf-8')
    expect(git(root, ['add', '--', '作品契约/无关.md']).status).toBe(0)
    fs.writeFileSync(path.join(root, '作品契约/本次.md'), '本次确认\n', 'utf-8')

    const result = commitConfirmed({ bookRoot: root, paths: ['作品契约/本次.md'], prefix: 'design', summary: '本次确认' })
    expect(result.ok).toBe(true)
    const show = git(root, ['-c', 'core.quotepath=false', 'show', '--name-only', '--pretty=format:', 'HEAD'])
    expect(show.stdout).toContain('作品契约/本次.md')
    expect(show.stdout).not.toContain('作品契约/无关.md')
    expect(git(root, ['-c', 'core.quotepath=false', 'diff', '--cached', '--name-only']).stdout?.trim()).toBe('作品契约/无关.md')
    const replay = commitConfirmed({ bookRoot: root, paths: ['作品契约/本次.md'], prefix: 'design', summary: '本次确认' })
    expect(replay.ok && replay.noChanges).toBe(true)
  })

  it('确认后产生 design: 提交,git log -1 -- 路径 命中', () => {
    const root = initRepo()
    fs.mkdirSync(path.join(root, '作品契约'), { recursive: true })
    fs.writeFileSync(path.join(root, '作品契约/契约.md'), '# 契约\n', 'utf-8')
    const r = commitConfirmed({ bookRoot: root, paths: ['作品契约/契约.md'], prefix: 'design', summary: '确认契约·核心设定' })
    expect(r.ok).toBe(true)
    const log = git(root, ['log', '-1', '--pretty=%s', '--', '作品契约/契约.md'])
    expect((log.stdout ?? '').trim()).toBe('design: 确认契约·核心设定')
  })

  it('携带活跃章号:design(ch0012): 确认细纲', () => {
    const root = initRepo()
    fs.mkdirSync(path.join(root, '大纲/章细纲/卷01'), { recursive: true })
    fs.writeFileSync(path.join(root, '大纲/章细纲/卷01/0012-初见.md'), '# 细纲\n', 'utf-8')
    const r = commitConfirmed({
      bookRoot: root, paths: ['大纲/章细纲/卷01/0012-初见.md'], prefix: 'design',
      summary: '确认细纲·初见', chapterScope: 12,
    })
    expect(r.ok).toBe(true)
    const log = git(root, ['log', '-1', '--pretty=%s'])
    expect((log.stdout ?? '').trim()).toBe('design(ch0012): 确认细纲·初见')
  })

  it('整批多文件一次提交(拍板 7:一次确认一次提交)', () => {
    const root = initRepo()
    fs.mkdirSync(path.join(root, '大纲/卷规划/卷01'), { recursive: true })
    fs.writeFileSync(path.join(root, '大纲/卷规划/卷01/卷纲.md'), '# 卷纲\n', 'utf-8')
    fs.writeFileSync(path.join(root, '大纲/卷规划/卷01/近期窗口.md'), '# 近期窗口\n', 'utf-8')
    const r = commitConfirmed({
      bookRoot: root,
      paths: ['大纲/卷规划/卷01/卷纲.md', '大纲/卷规划/卷01/近期窗口.md'],
      prefix: 'design', summary: '卷纲·线索推进',
    })
    expect(r.ok).toBe(true)
    const show = git(root, ['-c', 'core.quotepath=false', 'show', '--name-only', '--pretty=format:'])
    const names = (show.stdout ?? '').split('\n').map((l) => l.trim()).filter((l) => l !== '')
    expect(names).toContain('大纲/卷规划/卷01/卷纲.md')
    expect(names).toContain('大纲/卷规划/卷01/近期窗口.md')
    expect(git(root, ['rev-list', '--count', 'HEAD']).stdout?.trim()).toBe('1')
  })

  it('幂等重放:上一次已提交→无改动不空提交', () => {
    const root = initRepo()
    fs.mkdirSync(path.join(root, '作品契约'), { recursive: true })
    fs.writeFileSync(path.join(root, '作品契约/契约.md'), '# 契约\n', 'utf-8')
    expect(commitConfirmed({ bookRoot: root, paths: ['作品契约/契约.md'], prefix: 'design', summary: '确认契约' }).ok).toBe(true)
    const before = git(root, ['rev-list', '--count', 'HEAD']).stdout?.trim()
    const replay = commitConfirmed({ bookRoot: root, paths: ['作品契约/契约.md'], prefix: 'design', summary: '确认契约' })
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.noChanges).toBe(true)
    expect(git(root, ['rev-list', '--count', 'HEAD']).stdout?.trim()).toBe(before)
  })

  it('幂等重放:提交失败过(锁)→重跑补提交,不重写文件', () => {
    const root = initRepo()
    fs.mkdirSync(path.join(root, '作品契约'), { recursive: true })
    fs.writeFileSync(path.join(root, '作品契约/契约.md'), '# 契约\n', 'utf-8')
    fs.writeFileSync(path.join(root, '.git', 'index.lock'), '', 'utf-8')
    const blocked = commitConfirmed({ bookRoot: root, paths: ['作品契约/契约.md'], prefix: 'design', summary: '确认契约' })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.reason).toMatch(/锁定|B6/)
    fs.rmSync(path.join(root, '.git', 'index.lock'))
    const replay = commitConfirmed({ bookRoot: root, paths: ['作品契约/契约.md'], prefix: 'design', summary: '确认契约' })
    expect(replay.ok).toBe(true)
    expect(fs.readFileSync(path.join(root, '作品契约/契约.md'), 'utf-8')).toBe('# 契约\n')
    const log = git(root, ['log', '-1', '--pretty=%s'])
    expect((log.stdout ?? '').trim()).toBe('design: 确认契约')
  })

  it('路径越界与草稿区路径拒绝', () => {
    const root = initRepo()
    expect(commitConfirmed({ bookRoot: root, paths: ['知识库/写作/节拍.md'], prefix: 'design', summary: 'x' }).ok).toBe(false)
    expect(commitConfirmed({ bookRoot: root, paths: ['草稿区/草稿/卷01-初见/稿1.md'], prefix: 'design', summary: 'x' }).ok).toBe(false)
    expect(commitConfirmed({ bookRoot: root, paths: ['../外部.md'], prefix: 'design', summary: 'x' }).ok).toBe(false)
    expect(commitConfirmed({ bookRoot: root, paths: [], prefix: 'design', summary: 'x' }).ok).toBe(false)
    const log = git(root, ['log', '--oneline'])
    expect((log.stdout ?? '').trim()).toBe('')
  })

  it('index.lock→拒绝,工作树保留改动可继续', () => {
    const root = initRepo()
    fs.mkdirSync(path.join(root, '世界书/人物'), { recursive: true })
    fs.writeFileSync(path.join(root, '世界书/人物/甲.md'), '# 甲\n', 'utf-8')
    fs.writeFileSync(path.join(root, '.git', 'index.lock'), '', 'utf-8')
    const r = commitConfirmed({ bookRoot: root, paths: ['世界书/人物/甲.md'], prefix: 'design', summary: '确认条目' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/锁定|B6/)
    expect(fs.existsSync(path.join(root, '世界书/人物/甲.md'))).toBe(true)
    expect(git(root, ['log', '--oneline']).stdout?.trim()).toBe('')
  })
})

describe('归档附加提交路径(extraPaths,拍板 1:窗口标记随 ch:)', () => {
  it('归档失败重试保留无关 staged 项,文件名中的方括号按字面处理', () => {
    const root = initRepo()
    const target = '定稿/卷01/0001-[ab].md'
    const unrelated = '定稿/卷01/0001-a.md'
    fs.mkdirSync(path.join(root, '定稿/卷01'), { recursive: true })
    fs.writeFileSync(path.join(root, unrelated), 'author-staged\n')
    expect(git(root, ['add', '--', unrelated]).status).toBe(0)
    const hook = path.join(root, '.git/hooks/pre-commit')
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    const input = { bookRoot: root, files: [{ 目标: target, 内容: 'chapter\n' }], summary: 'literal archive' }
    const failed = archiveChapter(input)
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.written).toBe(true)
    expect(git(root, ['show', `:${unrelated}`]).stdout).toBe('author-staged\n')
    fs.unlinkSync(hook)
    expect(archiveChapter(input).ok).toBe(true)
    expect(git(root, ['-c', 'core.quotepath=false', 'show', '--format=', '--name-only', 'HEAD']).stdout?.trim()).toBe(target)
    expect(git(root, ['-c', 'core.quotepath=false', 'diff', '--cached', '--name-only']).stdout?.trim()).toBe(unrelated)
  })

  it('窗口标记随 ch: 提交,先前已提交的真源不在其中', () => {
    const root = initRepo()
    fs.mkdirSync(path.join(root, '大纲/卷规划/卷01'), { recursive: true })
    fs.writeFileSync(path.join(root, '大纲/卷规划/卷01/近期窗口.md'), '# 近期窗口\n', 'utf-8')
    // 真源先经 design: 提交(提交点跟随确认),归档不再携带。
    const confirmed = commitConfirmed({ bookRoot: root, paths: ['大纲/卷规划/卷01/近期窗口.md'], prefix: 'design', summary: '滚动窗口' })
    expect(confirmed.ok).toBe(true)
    // 归档流程标记窗口已消费(此处直接改文件模拟),随 ch: 一并提交。
    fs.writeFileSync(path.join(root, '大纲/卷规划/卷01/近期窗口.md'), '# 近期窗口\n- 初见 〔已消费〕\n', 'utf-8')
    const pkg = path.join(root, '草稿区/定稿准备/卷01-初见')
    fs.mkdirSync(pkg, { recursive: true })
    fs.writeFileSync(path.join(pkg, '正文.md'), '第一章\n', 'utf-8')
    fs.writeFileSync(path.join(pkg, '清单.json'), JSON.stringify({
      schemaVersion: 1,
      文件: [{ 源: '正文.md', 目标: '定稿/卷01/0003-初见.md' }],
    }))
    const r = archiveChapter({ bookRoot: root, packageDir: pkg, summary: '初见入档', extraPaths: ['大纲/卷规划/卷01/近期窗口.md'] })
    expect(r.ok).toBe(true)
    const show = git(root, ['-c', 'core.quotepath=false', 'show', '--name-only', '--pretty=format:', 'HEAD'])
    const names = (show.stdout ?? '').split('\n').map((l) => l.trim()).filter((l) => l !== '')
    expect(names).toContain('定稿/卷01/0003-初见.md')
    expect(names).toContain('大纲/卷规划/卷01/近期窗口.md')
    const last = lastCommitOf(root, '大纲/卷规划/卷01/近期窗口.md')
    expect(last.ok).toBe(true)
    if (last.ok) expect(last.prefix).toBe('ch')
  })

  it('extraPaths 越界同样拒绝', () => {
    const root = initRepo()
    const r = archiveChapter({
      bookRoot: root,
      files: [{ 目标: '定稿/卷01/0003-初见.md', 内容: '第一章\n' }],
      summary: '初见入档',
      extraPaths: ['草稿区/草稿/x.md'],
    })
    expect(r.ok).toBe(false)
  })
})

describe('某工件最近一次提交(lastCommitOf,拍板 3)', () => {
  it('从 design(chNNNN) Scope 解析章号', () => {
    const root = initRepo()
    fs.mkdirSync(path.join(root, '大纲/章细纲/卷01'), { recursive: true })
    fs.writeFileSync(path.join(root, '大纲/章细纲/卷01/0012-初见.md'), '# 细纲\n', 'utf-8')
    expect(commitConfirmed({
      bookRoot: root, paths: ['大纲/章细纲/卷01/0012-初见.md'], prefix: 'design',
      summary: '确认细纲·初见', chapterScope: 12,
    }).ok).toBe(true)
    const r = lastCommitOf(root, '大纲/章细纲/卷01/0012-初见.md')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.prefix).toBe('design(ch0012)')
    expect(r.summary).toBe('确认细纲·初见')
    expect(r.chapter).toEqual({ 卷: null, 章: 12 })
  })

  it('从定稿章路径解析卷与章(ch: 不带 Scope)', () => {
    const root = initRepo()
    const pkg = path.join(root, '草稿区/定稿准备/卷01-初见')
    fs.mkdirSync(pkg, { recursive: true })
    fs.writeFileSync(path.join(pkg, '正文.md'), '第一章\n', 'utf-8')
    fs.writeFileSync(path.join(pkg, '清单.json'), JSON.stringify({
      schemaVersion: 1,
      文件: [{ 源: '正文.md', 目标: '定稿/卷01/0003-初见.md' }],
    }))
    expect(archiveChapter({ bookRoot: root, packageDir: pkg, summary: '初见入档' }).ok).toBe(true)
    const r = lastCommitOf(root, '定稿/卷01/0003-初见.md')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.prefix).toBe('ch')
    expect(r.chapter).toEqual({ 卷: 1, 章: 3 })
  })

  it('从未提交→kind never;非 git 仓→kind error', () => {
    const root = initRepo()
    fs.mkdirSync(path.join(root, '大纲'), { recursive: true })
    fs.writeFileSync(path.join(root, '大纲/卷纲.md'), '# 卷纲\n', 'utf-8')
    git(root, ['add', '大纲/卷纲.md'])
    git(root, ['commit', '-m', 'vol: 建书'])
    const never = lastCommitOf(root, '作品契约/契约.md')
    expect(never.ok).toBe(false)
    if (!never.ok) expect(never.kind).toBe('never')

    const bare = mkDir('webnovel-nogit-')
    const err = lastCommitOf(bare, '作品契约/契约.md')
    expect(err.ok).toBe(false)
    if (!err.ok) expect(err.kind).toBe('error')
  })
})
