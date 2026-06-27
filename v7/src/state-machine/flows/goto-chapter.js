import { createGit } from '../../finalize/git.js'

/**
 * 回到第 N 章（spec §9，git 回滚包装）。执行前展示影响范围 + 作者确认；
 * confirm 才真 reset，且**先建救援 ref 备份**（不变量 8：作者不碰 git）。
 * @param {{repoPath: string}} ctx
 * @param {{chapterNum: number, confirm?: boolean}} args
 */
export async function gotoChapter(ctx, { chapterNum, confirm = false } = {}) {
  if (!Number.isInteger(chapterNum)) return { ok: false, error: '请指定要回到的章号' }
  const git = createGit(ctx.repoPath)

  const hash = await git.findChapterCommit(chapterNum)
  if (!hash) return { ok: false, error: `未找到第 ${chapterNum} 章的定稿提交（ch(${chapterNum}):）` }

  const willLose = await git.commitsAfter(hash)
  if (!confirm) {
    return {
      ok: true,
      needsConfirm: true,
      target: hash,
      willLose,
      message:
        willLose.length === 0
          ? `第 ${chapterNum} 章已是最新，无需回退。`
          : `回到第 ${chapterNum} 章会丢弃其后 ${willLose.length} 个提交：${willLose.join('；')}。确认请带 confirm。`,
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
      message: `已回到第 ${chapterNum} 章。原状态已备份到 refs/${ref}，如需找回：git reset --hard refs/${ref}`,
    }
  } catch (err) {
    return { ok: false, error: `回退失败：${err.message}` }
  }
}
