/** Git 提交辅助：使用路径限定提交隔离调用前已经存在的 staged 修改。 */

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { currentBookProvenance } from '../repo/lock'

export interface BookCommitEvent {
  readonly bookRoot: string
  readonly paths: readonly string[]
  readonly sessionId?: string
}
const commitListeners = new Set<(event: BookCommitEvent) => void>()

/** Notification only: observers never participate in the Git transaction. */
export function onBookCommit(listener: (event: BookCommitEvent) => void): () => void {
  commitListeners.add(listener)
  return () => { commitListeners.delete(listener) }
}

export interface GitCommandResult {
  readonly status: number
  readonly stderr: string
  readonly stdout: string
  readonly noChanges?: boolean
}

export function runGit(bookRoot: string, args: readonly string[], env?: NodeJS.ProcessEnv, input?: string): GitCommandResult {
  const r = spawnSync('git', args, {
    cwd: bookRoot,
    encoding: 'utf-8',
    windowsHide: true,
    ...(input === undefined ? {} : { input }),
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
  })
  if (r.error) return { status: 1, stderr: r.error.message, stdout: '' }
  return { status: r.status ?? 1, stderr: r.stderr ?? '', stdout: r.stdout ?? '' }
}

/**
 * 先只把目标路径加入 index，再用 Git 原生 `commit --only` 构造只含
 * 指定路径的提交树。`--only` 排除调用方原有的其他 staged 文件；目标
 * 自身是本次操作负责的路径，成功提交后从 index 正常消耗，失败则保留
 * 在工作树和 staged 区，便于重跑。
 */
export function commitWithIsolatedIndex(
  bookRoot: string,
  dests: readonly string[],
  message: string,
): GitCommandResult {
  for (const dest of dests) {
    try {
      if (!fs.lstatSync(path.resolve(bookRoot, dest)).isFile()) return { status: 1, stderr: `提交目标必须是文件:${dest}`, stdout: '' }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const add = runGit(bookRoot, ['--literal-pathspecs', 'add', '--', ...dests])
  if (add.status !== 0) return add
  const staged = runGit(bookRoot, ['--literal-pathspecs', 'diff', '--cached', '--quiet', '--', ...dests])
  if (staged.status === 0) return { status: 1, noChanges: true, stderr: '无实质变更', stdout: '' }
  if (staged.status !== 1) return staged
  const result = runGit(bookRoot, ['--literal-pathspecs', 'commit', '--only', '-m', message, '--', ...dests])
  if (result.status === 0) {
    let sessionId: string | undefined
    try { sessionId = currentBookProvenance(bookRoot)?.sessionId } catch { /* No observer can change a committed result. */ }
    const event: BookCommitEvent = Object.freeze({ bookRoot, paths: Object.freeze([...dests]), ...(sessionId ? { sessionId } : {}) })
    queueMicrotask(() => { for (const listener of commitListeners) { try { listener(event) } catch { /* Background work is independent. */ } } })
  }
  return result
}
