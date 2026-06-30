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
    /** 仓库初始化（幂等：已存在则 reinit，无害） */
    async init() {
      await run(['init', '-q'])
    },
    /** 中文路径不转义（spec quality §3.3：书仓库初始化必设） */
    async setQuotepathFalse() {
      await run(['config', 'core.quotepath', 'false'])
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
    /** 仓库是否可正常 git status（false = .git 损坏等） */
    async health() {
      try {
        await run(['status', '--porcelain'])
        return { ok: true, error: '' }
      } catch (err) {
        return { ok: false, error: err.message }
      }
    },
    async status() {
      // core.quotePath=false：中文路径不转义成 \xxx，便于按前缀匹配
      const { stdout } = await run(['-c', 'core.quotePath=false', 'status', '--porcelain'])
      return stdout
    },
    /** 是否处于未完成合并（存在 MERGE_HEAD） */
    async isMerging() {
      try {
        await run(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
        return true
      } catch {
        return false
      }
    },
    /** 暂存区是否有残留改动（半提交迹象） */
    async hasStagedChanges() {
      try {
        await run(['diff', '--cached', '--quiet'])
        return false
      } catch {
        return true
      }
    },
    async stash(message) {
      await run(['stash', 'push', '-m', message])
    },
    async mergeAbort() {
      await run(['merge', '--abort'])
    },
    /** 建救援 ref：refs/<name> 指向 source（默认 HEAD），用于回滚前备份 */
    async createBackupRef(name, source = 'HEAD') {
      await run(['update-ref', `refs/${name}`, source])
    },
    /** 找某章定稿提交（ch(N): …）的最近 hash；无则 null */
    async findChapterCommit(n) {
      try {
        const { stdout } = await run(['log', `--grep=ch(${n}):`, '--format=%H', '-1'])
        return stdout.trim() || null
      } catch {
        return null
      }
    },
    /** ref..HEAD 之间提交的标题列表（影响范围） */
    async commitsAfter(ref) {
      try {
        const { stdout } = await run(['log', '--format=%s', `${ref}..HEAD`])
        return stdout.split('\n').map((s) => s.trim()).filter(Boolean)
      } catch {
        return []
      }
    },
    async resetHard(ref) {
      await run(['reset', '--hard', ref])
    },
  }
}
