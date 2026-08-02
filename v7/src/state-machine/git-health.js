import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createGit } from '../finalize/git.js'

// P3-F10：3s 太短——杀软/Windows 索引器对 .git 的瞬时读锁常常超 3s，
// 曾被误判陈旧删除，引入双 git 进程并发写损坏窗口。git 的 index.lock 不含 pid
//（无法做活锁进程判定），退而求其次=分钟级阈值 + 删除前二次 stat 防 TOCTOU。
export const STALE_LOCK_MS = 60_000

/**
 * git 健康检查（spec §10 第 0 步前）。D2：激进自动修 + 可恢复安全网。
 * 作者永不直面 git 英文报错（不变量 8）：返回中文 fixed/guidance/rescued。
 * @param {{repoPath: string}} ctx
 * @returns {Promise<{ok: boolean, fixed: string[], guidance: string[], rescued: string[]}>}
 */
export async function checkGitHealth(ctx) {
  const { repoPath } = ctx
  const git = createGit(repoPath)
  const fixed = []
  const guidance = []
  const rescued = []

  // 1. 陈旧锁文件（先于 git status，免得残留锁干扰检测）
  const lockPath = path.join(repoPath, '.git', 'index.lock')
  try {
    const st = await fs.stat(lockPath)
    if (Date.now() - st.mtimeMs > STALE_LOCK_MS) {
      // P3-F10 删除前二次 stat 防 TOCTOU：判陈旧到 rm 的窗口里若锁被新 git 操作刷新（mtime 变近），
      // 说明是活锁，宁可保守不删，不能误删别人的锁。
      const recheck = await fs.stat(lockPath)
      if (Date.now() - recheck.mtimeMs > STALE_LOCK_MS) {
        await fs.rm(lockPath, { force: true })
        fixed.push('删除了陈旧的 git 锁文件（.git/index.lock，残留自上次中断的 git 操作）')
        rescued.push('index.lock 已删')
      }
    }
  } catch {
    // 无锁文件（或二次 stat 时已被持有方自然释放）
  }

  // 2. .git 损坏：坏了别再动 git（D2 例外，只指引）
  const health = await git.health()
  if (!health.ok) {
    guidance.push(
      'git 仓库似乎损坏，无法安全自动修复。请先把整个书目录复制一份做备份，再尝试 `git fsck`，或从网盘/最近备份找回历史版本。'
    )
    await logRescue(repoPath, '检测到 .git 损坏：仅给指引，未自动改动仓库')
    return { ok: true, fixed, guidance, rescued }
  }

  // 3. 网盘冲突副本 → 归档（移动非删除）
  for (const f of await findCloudDupes(repoPath)) {
    const rel = path.relative(repoPath, f)
    const dest = path.join(repoPath, '工作区', '.救援', '网盘副本', path.basename(f))
    try {
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.rename(f, dest)
      fixed.push(`网盘冲突副本「${rel}」已归档到 工作区/.救援/网盘副本/（未删除，可找回）`)
      rescued.push(rel)
    } catch (err) {
      guidance.push(`发现疑似网盘冲突副本「${rel}」，自动归档失败，请手动检查（${err.message}）`)
    }
  }

  // 4. 合并冲突 → 备份待合并分支后中止
  if (await git.isMerging()) {
    const ref = `rescue/merge-${Date.now()}`
    try {
      await git.createBackupRef(ref, 'MERGE_HEAD')
      await git.mergeAbort()
      fixed.push(
        `检测到未完成的合并，已把待合并分支备份到 refs/${ref} 并中止合并。如需重试合并：git merge refs/${ref}`
      )
      rescued.push(ref)
    } catch (err) {
      guidance.push(`检测到未完成的合并，自动中止失败，请联系维护者（${err.message}）`)
    }
  } else if (await git.hasStagedChanges()) {
    // 5. 半提交（暂存残留）→ stash（可恢复）
    const msg = `半提交救援-${Date.now()}`
    try {
      await git.stash(msg)
      fixed.push(
        `检测到未完成的提交（暂存区有残留改动），已暂存到 git stash「${msg}」。如需取回：git stash pop`
      )
      rescued.push(msg)
    } catch (err) {
      guidance.push(`检测到未完成的提交，自动暂存失败，请手动检查（${err.message}）`)
    }
  }

  if (fixed.length || rescued.length) {
    await logRescue(repoPath, fixed.join('；'))
  }
  return { ok: true, fixed, guidance, rescued }
}

// 扫描源文件目录，找网盘冲突副本（xxx (1).md / xxx 的冲突副本）
async function findCloudDupes(repoPath) {
  const all = []
  for (const sub of ['作品契约', '定稿', '大纲', '文风']) {
    all.push(...(await walk(path.join(repoPath, sub))))
  }
  return all.filter((f) => /(\(\d+\)\.md$)|的冲突副本/.test(path.basename(f)))
}

async function walk(dir) {
  let result = []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return result
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) result = result.concat(await walk(full))
    else result.push(full)
  }
  return result
}

async function logRescue(repoPath, line) {
  if (!line) return
  try {
    const dir = path.join(repoPath, '工作区', '.救援')
    await fs.mkdir(dir, { recursive: true })
    await fs.appendFile(path.join(dir, '修复日志.md'), `- ${line}\n`, 'utf8')
  } catch {
    // 日志失败不影响主流程
  }
}
