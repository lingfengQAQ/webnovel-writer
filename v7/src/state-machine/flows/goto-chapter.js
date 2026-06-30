import { createGit } from '../../finalize/git.js'
import { checkGitHealth } from '../git-health.js'

/**
 * 回到第 N 章（spec §9，git 回滚包装）。执行前展示影响范围 + 作者确认；
 * confirm 才真 reset，且**先建救援 ref 备份**（不变量 8：作者不碰 git）。
 * @param {{repoPath: string}} ctx
 * @param {{chapterNum: number, confirm?: boolean}} args
 */
export async function gotoChapter(ctx, { chapterNum, confirm = false } = {}) {
  if (!Number.isInteger(chapterNum)) return { ok: false, error: '请指定要回到的章号' }
  const git = createGit(ctx.repoPath)

  // P1-6：先跑 git 健康检查（此前漏跑,与状态机主入口一致）
  const gitHealth = await checkGitHealth(ctx)

  const hash = await git.findChapterCommit(chapterNum)
  if (!hash) return { ok: false, error: `未找到第 ${chapterNum} 章的定稿提交（ch(${chapterNum}):）`, gitHealth }

  const willLose = await git.commitsAfter(hash)
  if (!confirm) {
    return {
      ok: true,
      needsConfirm: true,
      target: hash,
      willLose,
      gitHealth,
      message:
        willLose.length === 0
          ? `第 ${chapterNum} 章已是最新，无需回退。`
          : `回到第 ${chapterNum} 章会丢弃其后 ${willLose.length} 个提交：${willLose.join('；')}。确认请带 confirm。`,
    }
  }

  // P1-6：reset --hard 前检查脏树。rescue ref 只存 HEAD 指针不含工作树,
  // 定稿/大纲 若有未提交手改会被静默抹掉且无法找回 → 拒绝,要作者先 commit/stash。
  const status = await git.status()
  const dirtyScoped = status
    .split('\n')
    .filter(Boolean)
    .some((l) => {
      const p = l.slice(3)
      return p.startsWith('定稿') || p.startsWith('大纲')
    })
  if (dirtyScoped) {
    return {
      ok: false,
      error: '定稿/大纲 有未登记的手改，reset --hard 会丢弃且无法从救援 ref 找回。请先 commit 或 stash 再回退。',
      gitHealth,
    }
  }

  const ref = `rescue/goto-${Date.now()}`
  try {
    await git.createBackupRef(ref) // 备份当前 HEAD
    await git.resetHard(hash)
    return {
      ok: true,
      reverted: true,
      backupRef: `refs/${ref}`,
      gitHealth,
      message: `已回到第 ${chapterNum} 章。原状态已备份到 refs/${ref}，如需找回：git reset --hard refs/${ref}`,
    }
  } catch (err) {
    return { ok: false, error: `回退失败：${err.message}`, gitHealth }
  }
}
