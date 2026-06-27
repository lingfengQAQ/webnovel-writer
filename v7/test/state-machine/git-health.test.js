import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { checkGitHealth } from '../../src/state-machine/git-health.js'

const execFileAsync = promisify(execFile)

// 造一个健康的 git 书仓库
async function makeGitRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-gh-'))
  const git = (args) => execFileAsync('git', args, { cwd: root })
  await git(['init', '-q'])
  await git(['config', 'user.email', 't@example.com'])
  await git(['config', 'user.name', 'test'])
  await fs.mkdir(path.join(root, '定稿', '正文'), { recursive: true })
  await fs.writeFile(path.join(root, '定稿', '正文', '0001-开局.md'), '---\n章号: 1\n---\n正文', 'utf8')
  await fs.writeFile(path.join(root, 'book.yaml'), '书名: 测\n', 'utf8')
  await fs.writeFile(path.join(root, '.gitignore'), '.cache/\n工作区/\n', 'utf8')
  await git(['add', '-A'])
  await git(['commit', '-q', '-m', 'init'])
  return { root, git }
}

test('git健康：陈旧锁文件自动删 + 救援记录', async () => {
  const { root } = await makeGitRepo()
  try {
    const lock = path.join(root, '.git', 'index.lock')
    await fs.writeFile(lock, '', 'utf8')
    const old = new Date(Date.now() - 3600_000)
    await fs.utimes(lock, old, old)
    const r = await checkGitHealth({ repoPath: root })
    assert.equal(r.ok, true)
    assert.ok(r.fixed.some((m) => m.includes('锁文件')))
    await assert.rejects(() => fs.access(lock))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('git健康：网盘冲突副本归档不删', async () => {
  const { root } = await makeGitRepo()
  try {
    const dupe = path.join(root, '定稿', '正文', '0001-开局 (1).md')
    await fs.writeFile(dupe, '副本内容', 'utf8')
    const r = await checkGitHealth({ repoPath: root })
    assert.ok(r.fixed.some((m) => m.includes('网盘')))
    await assert.rejects(() => fs.access(dupe))
    const archived = path.join(root, '工作区', '.救援', '网盘副本', '0001-开局 (1).md')
    assert.equal(await fs.readFile(archived, 'utf8'), '副本内容')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('git健康：半提交（暂存残留）自动 stash 可恢复', async () => {
  const { root, git } = await makeGitRepo()
  try {
    await fs.writeFile(path.join(root, '定稿', '正文', '0002-初遇.md'), '---\n章号: 2\n---\n新章', 'utf8')
    await git(['add', '-A'])
    const r = await checkGitHealth({ repoPath: root })
    assert.ok(r.fixed.some((m) => m.includes('暂存') || m.includes('stash')))
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.equal(stdout.trim(), '')
    const { stdout: stashList } = await execFileAsync('git', ['stash', 'list'], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.ok(stashList.includes('救援'))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('git健康：合并冲突先备份再中止', async () => {
  const { root, git } = await makeGitRepo()
  try {
    await git(['checkout', '-q', '-b', 'other'])
    await fs.writeFile(path.join(root, 'book.yaml'), '书名: 分支A\n', 'utf8')
    await git(['commit', '-q', '-am', 'A'])
    await git(['checkout', '-q', '-'])
    await fs.writeFile(path.join(root, 'book.yaml'), '书名: 分支B\n', 'utf8')
    await git(['commit', '-q', '-am', 'B'])
    try {
      await git(['merge', 'other'])
    } catch {
      // 预期冲突
    }
    const r = await checkGitHealth({ repoPath: root })
    assert.ok(r.fixed.some((m) => m.includes('合并')))
    await assert.rejects(() => fs.access(path.join(root, '.git', 'MERGE_HEAD')))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('git健康：.git 损坏只指引不乱动（零英文堆栈）', async () => {
  const { root } = await makeGitRepo()
  try {
    await fs.writeFile(path.join(root, '.git', 'HEAD'), '损坏内容不是 ref', 'utf8')
    const r = await checkGitHealth({ repoPath: root })
    assert.equal(r.ok, true)
    assert.ok(r.guidance.some((m) => m.includes('损坏') || m.includes('备份')))
    assert.ok(r.guidance.every((m) => !/Error|fatal|\bstack\b/i.test(m)))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
