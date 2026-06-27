import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * git 薄封装（node:child_process）。M2 假设仓库健康；健康检查/异常修复归 M3。
 * 错误向上抛由 finalize 转中文。
 */
export function createGit(repoPath) {
  const run = (args) =>
    exec('git', args, { cwd: repoPath, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })

  return {
    async add(files) {
      if (!files.length) return
      await run(['add', '--', ...files])
    },
    async commit(message) {
      await run(['commit', '-m', message])
      const { stdout } = await run(['rev-parse', 'HEAD'])
      return stdout.trim()
    },
    /** 撤销 paths 下已跟踪文件的未提交修改（不碰其他路径如 工作区/） */
    async restore(paths) {
      try {
        await run(['restore', '--staged', '--worktree', '--', ...paths])
      } catch {
        // 无可恢复改动时 git 可能报错，忽略
      }
    },
    /** 删除 paths 下未跟踪的新文件（scoped，绝不触及 工作区/） */
    async clean(paths) {
      await run(['clean', '-fd', '--', ...paths])
    },
    async revCount() {
      try {
        const { stdout } = await run(['rev-list', '--count', 'HEAD'])
        return parseInt(stdout.trim(), 10) || 0
      } catch {
        return 0
      }
    },
    async log() {
      const { stdout } = await run(['log', '--oneline', '--no-color'])
      return stdout
    },
  }
}
