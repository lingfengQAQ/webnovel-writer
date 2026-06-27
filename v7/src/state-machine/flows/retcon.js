import path from 'node:path'
import { createGit } from '../../finalize/git.js'
import { EntityWriter } from '../../storage/adapters/EntityWriter.js'
import { ThreadLedgerWriter } from '../../storage/adapters/ThreadLedgerWriter.js'

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
      written.push(path.join(repoPath, '定稿', '设定', '角色', `${c.name}.md`))
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
    return { ok: true, commitHash, message: `已吃书并留痕：retcon(${chapterNum}): ${原因}` }
  } catch (err) {
    try {
      await git.restore(['定稿/', '大纲/'])
      await git.clean(['定稿/', '大纲/'])
    } catch {
      // 回滚尽力而为
    }
    return { ok: false, error: `吃书失败，已回滚未提交写入：${err.message}` }
  }
}
