import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CacheManager } from '../../src/cache/index.js'

const execFileAsync = promisify(execFile)

/**
 * 造 git 书仓库 + 缓存。files={相对路径:内容}。commits=[{message,files}] 逐个额外提交（用于造 ch(N) 历史）。
 */
export async function makeGitBook(files, { commits = [] } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-sm-'))
  const git = (a) => execFileAsync('git', a, { cwd: root })
  await git(['init', '-q'])
  await git(['config', 'user.email', 't@example.com'])
  await git(['config', 'user.name', 'test'])
  await fs.writeFile(path.join(root, '.gitignore'), '.cache/\n工作区/\n', 'utf8')
  await writeAll(root, files)
  await git(['add', '-A'])
  await git(['commit', '-q', '-m', 'init'])

  for (const c of commits) {
    await writeAll(root, c.files)
    await git(['add', '-A'])
    await git(['commit', '-q', '-m', c.message])
  }

  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-sm-db-'))
  const cache = new CacheManager(path.join(dbDir, 'index.db'))
  await cache.ensureReady(root)
  return {
    root,
    git,
    ctx: { repoPath: root, cache },
    cleanup: async () => {
      await cache.close()
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(dbDir, { recursive: true, force: true })
    },
  }
}

async function writeAll(root, files = {}) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, content, 'utf8')
  }
}

export const chapter = (n, body = '正文。', vol = 1) =>
  `---\n章号: ${n}\n标题: 第${n}章\n卷: ${vol}\n字数: 100\n章定位: 推进\n钩子: 危机钩-强\n情绪定位: 铺垫\n---\n${body}`
