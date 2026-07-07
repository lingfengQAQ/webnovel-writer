import path from 'node:path'
import { createGit } from '../../finalize/git.js'
import { EntityWriter } from '../../storage/adapters/EntityWriter.js'
import { ThreadLedgerWriter } from '../../storage/adapters/ThreadLedgerWriter.js'
import { refreshCacheAfterSourceChange } from '../../cache/index.js'

/**
 * 吃书 retcon（spec §9）：显式改定稿，commit `retcon(N): 原因`，设定/条目同步，留痕可查。
 * 圆设定（AI 生成向后兼容方案）留 M4；M3 只做 retcon 的脚本落地。
 * @param {{repoPath: string}} ctx
 * @param {{chapterNum: number, 原因: string, characterUpdates?: object[], threadUpdates?: object[]}} args
 */
export async function retcon(ctx, { chapterNum, 原因, characterUpdates = [], threadUpdates = [] } = {}) {
  if (!Number.isInteger(chapterNum)) return { ok: false, error: '请指定吃书涉及的章号' }
  if (!原因) return { ok: false, error: '吃书必须写明原因（commit 留痕可查）' }

  const { repoPath } = ctx
  const git = createGit(repoPath)
  const written = []
  try {
    const ew = new EntityWriter(repoPath)
    for (const c of characterUpdates) {
      const r = await ew.updateCharacter(c.name, c.updates)
      if (!r.ok) throw new Error(r.error)
      // 路径取写入器返回值（A10 同源）：手拼在名字含可净化字符时会与实际写点分裂
      written.push(r.filePath)
    }

    const tlw = new ThreadLedgerWriter(repoPath)
    for (const t of threadUpdates) {
      if (t.updates) {
        const r = await tlw.updateThread(t.id, t.updates)
        if (!r.ok) throw new Error(r.error)
      }
      const f = await tlw._findThreadFile(t.id)
      if (f) written.push(f)
    }

    if (!written.length) throw new Error('吃书未提供任何设定/条目变更')

    const rel = [...new Set(written)].map((f) => path.relative(repoPath, f))
    await git.add(rel)
    const commitHash = await git.commit(`retcon(${chapterNum}): ${原因}`)
    // 角色/条目源已改,缓存同步刷,否则 threads/entities 陈旧
    const cacheRefresh = await refreshCacheAfterSourceChange(ctx)
    return { ok: true, commitHash, cacheRefresh, message: `已吃书并留痕：retcon(${chapterNum}): ${原因}` }
  } catch (err) {
    // 回滚收窄到本次写入集合（D4，对齐 finalize 模式）：整棵 定稿/大纲 restore+clean
    // 会误伤序2 在场的作者手改与无关未跟踪新文件。逐文件 restore——retcon 只更新既有
    // 文件，不会有未跟踪路径让整条 restore 报错。
    try {
      const rel = [...new Set(written)].map((f) => path.relative(repoPath, f))
      for (const r of rel) {
        await git.restore([r])
      }
    } catch {
      // 回滚尽力而为
    }
    return { ok: false, error: `吃书失败，已回滚未提交写入：${err.message}` }
  }
}
