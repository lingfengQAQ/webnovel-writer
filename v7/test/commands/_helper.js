import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CacheManager } from '../../src/cache/index.js'

const execFileAsync = promisify(execFile)

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 共享的示例书仓库（只读，命令测试默认喂它）
export const fixtureRoot = path.join(__dirname, '../fixtures/sample-book')

/**
 * 用共享 sample-book fixture 建命令运行上下文。
 * @returns {Promise<{ctx: {repoPath, cache}, cleanup: () => Promise<void>}>}
 */
export function fixtureCtx() {
  return repoCtx(fixtureRoot, null)
}

/**
 * 建命令运行上下文。
 * @param {string|null} repoPath 现成书仓库路径（与 files 二选一）
 * @param {object|null} files {相对路径: 内容} → 在临时目录现造一个书仓库
 */
export async function repoCtx(repoPath, files) {
  let tmpRepo = null
  if (files) {
    tmpRepo = await mkdtemp(path.join(os.tmpdir(), 'wnw-cmd-repo-'))
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(tmpRepo, rel)
      await mkdir(path.dirname(full), { recursive: true })
      await writeFile(full, content, 'utf8')
    }
    repoPath = tmpRepo
  }
  // db 放独立临时目录，绝不写进书仓库
  const dbDir = await mkdtemp(path.join(os.tmpdir(), 'wnw-cmd-db-'))
  const cache = new CacheManager(path.join(dbDir, 'index.db'))
  await cache.ensureReady(repoPath)
  return {
    ctx: { repoPath, cache },
    cleanup: async () => {
      await cache.close()
      await rm(dbDir, { recursive: true, force: true })
      if (tmpRepo) await rm(tmpRepo, { recursive: true, force: true })
    },
  }
}

/**
 * 把 sample-book fixture 整体拷到临时目录（可写），建 ctx。
 * 用于会写入书仓库的流程（备料写本章写作材料、定稿写定稿/git），避免污染 committed fixture。
 */
export async function tempBookCtx() {
  const tmpRepo = await mkdtemp(path.join(os.tmpdir(), 'wnw-book-'))
  await cp(fixtureRoot, tmpRepo, { recursive: true })
  const dbDir = await mkdtemp(path.join(os.tmpdir(), 'wnw-book-db-'))
  const cache = new CacheManager(path.join(dbDir, 'index.db'))
  await cache.ensureReady(tmpRepo)
  return {
    ctx: { repoPath: tmpRepo, cache },
    cleanup: async () => {
      await cache.close()
      await rm(dbDir, { recursive: true, force: true })
      await rm(tmpRepo, { recursive: true, force: true })
    },
  }
}

/**
 * 同 tempBookCtx，但额外 git init + 首提交（定稿/git 流程测试用）。
 * 仓库形态对齐真实建书 persistCreateBook：.gitignore（.cache/、工作区/）+
 * core.quotepath false + 工作区不入跟踪（G-1：脚手架失真会掩盖 goto/finalize 的真实行为）。
 */
export async function gitBookCtx() {
  const { ctx, cleanup } = await tempBookCtx()
  await writeFile(path.join(ctx.repoPath, '.gitignore'), '.cache/\n工作区/\n', 'utf8')
  const git = (args) => execFileAsync('git', args, { cwd: ctx.repoPath })
  await git(['init', '-q'])
  await git(['config', 'core.quotepath', 'false'])
  await git(['config', 'user.email', 't@example.com'])
  await git(['config', 'user.name', 'test'])
  await git(['add', '-A'])
  await git(['commit', '-q', '-m', 'init'])
  return { ctx, cleanup }
}
