import { createGit } from '../finalize/git.js'
import { listManualEdits } from '../state-machine/detectors.js'
import { refreshCacheAfterSourceChange } from '../cache/index.js'

/**
 * relink --message=<一句话说明>：序2 手改补登（spec §9/§10）。
 * 把 定稿/大纲 下未登记的手改 add + commit（fix(手改) 前缀）并刷新缓存——作者不碰 git。
 * 范围与序2 检测同源（listManualEdits），不会捎带工作区等无关路径。
 * 契约：纯返回 {ok, output?, error?}。
 */
export async function run(args, options, ctx) {
  const message = typeof options.message === 'string' ? options.message.trim() : ''
  if (!message) {
    return { ok: false, error: '缺少 --message=<一句话说明>（写进 commit，日后可查这次手改改了什么）' }
  }
  const changes = await listManualEdits(ctx.repoPath)
  if (!changes.length) {
    return { ok: true, output: '定稿/大纲 没有未登记的手改，无需补登。' }
  }
  const git = createGit(ctx.repoPath)
  try {
    await git.ensureIdentity()
    await git.add(changes)
    const hash = await git.commit(`fix(手改): ${message}`)
    const cacheRefresh = await refreshCacheAfterSourceChange(ctx)
    const cacheNote =
      cacheRefresh && !cacheRefresh.ok ? '（缓存刷新失败，已作废旧缓存，下次命令自动重建）' : ''
    return {
      ok: true,
      output: `已补登 ${changes.length} 处手改：fix(手改): ${message}（${hash.slice(0, 7)}）${cacheNote}`,
    }
  } catch (err) {
    return { ok: false, error: `补登失败：${err.message}` }
  }
}
