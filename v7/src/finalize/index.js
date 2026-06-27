import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ChapterWriter } from '../storage/adapters/ChapterWriter.js'
import { ThreadLedgerWriter } from '../storage/adapters/ThreadLedgerWriter.js'
import { EntityWriter } from '../storage/adapters/EntityWriter.js'
import { TimelineWriter } from '../storage/adapters/TimelineWriter.js'
import { SecretWriter } from '../storage/adapters/SecretWriter.js'
import { SummaryWriter } from '../storage/adapters/SummaryWriter.js'
import { createGit } from './git.js'

/**
 * 定稿：原子 commit（D3）。写工作树 → git add → commit → 最后清工作区。
 * 断电安全：commit 前任何中断都回滚未提交写入（仅 定稿/大纲，不碰工作区），
 * 工作区草稿原样保留，不存在半章入档。
 *
 * @param {{repoPath: string, cache?: object}} ctx
 * @param {object} payload 定稿包（章档案/正文/摘要/条目/设定变更/commit 行/待清工作区文件）
 * @param {{git?: object, faultAfterWrite?: boolean}} [opts] 注入 git（测试）/故障注入（断电模拟）
 * @returns {Promise<{ok: boolean, commitHash?: string, error?: string}>}
 */
export async function finalizeChapter(ctx, payload, opts = {}) {
  const { repoPath } = ctx
  const git = opts.git || createGit(repoPath)
  const {
    chapterNum,
    frontMatter,
    body = '',
    summary = null,
    threadUpdates = [],
    characterUpdates = [],
    rosterUpserts = [],
    timelineRows = [],
    secretWrites = [],
    commitLines = {},
    workspaceFiles = [],
  } = payload

  // 1. 校验（不过则什么都没写，天然原样）
  if (!Number.isInteger(chapterNum)) return { ok: false, error: '章号必须是整数' }
  if (!frontMatter || !frontMatter.标题) return { ok: false, error: '缺少章档案或标题' }

  const written = []
  try {
    // 2. 写工作树（全部落 定稿/大纲，非 工作区）
    const cw = await new ChapterWriter(repoPath).writeChapter(chapterNum, frontMatter, body)
    if (!cw.ok) throw new Error(cw.error)
    written.push(cw.filePath)

    if (summary != null) {
      const sw = await new SummaryWriter(repoPath).writeChapterSummary(chapterNum, summary)
      if (!sw.ok) throw new Error(sw.error)
      written.push(sw.filePath)
    }

    const tlw = new ThreadLedgerWriter(repoPath)
    for (const t of threadUpdates) {
      if (t.updates) {
        const r = await tlw.updateThread(t.id, t.updates)
        if (!r.ok) throw new Error(r.error)
      }
      if (t.history) {
        const r = await tlw.appendHistory(t.id, t.history)
        if (!r.ok) throw new Error(r.error)
      }
      const f = await tlw._findThreadFile(t.id)
      if (f) written.push(f)
    }

    const ew = new EntityWriter(repoPath)
    for (const c of characterUpdates) {
      const r = await ew.updateCharacter(c.name, c.updates)
      if (!r.ok) throw new Error(r.error)
      written.push(path.join(repoPath, '定稿', '设定', '角色', `${c.name}.md`))
    }
    for (const row of rosterUpserts) {
      const r = await ew.upsertRosterRow(row)
      if (!r.ok) throw new Error(r.error)
      written.push(path.join(repoPath, '定稿', '设定', '名册.md'))
    }

    const tw = new TimelineWriter(repoPath)
    for (const tr of timelineRows) {
      const r = await tw.appendRow(tr.volumeNum, tr.row)
      if (!r.ok) throw new Error(r.error)
      written.push(r.filePath)
    }

    const secw = new SecretWriter(repoPath)
    for (const s of secretWrites) {
      const r = await secw.write(s.id, s.frontMatter, s.content)
      if (!r.ok) throw new Error(r.error)
      written.push(r.filePath)
    }

    // 故障注入点（断电模拟，仅测试用）
    if (opts.faultAfterWrite) throw new Error('注入故障：写工作树后、commit 前中断')

    // 3. git add + commit（原子点）
    const relFiles = [...new Set(written)].map((f) => path.relative(repoPath, f))
    await git.add(relFiles)
    const commitHash = await git.commit(buildCommitMessage(chapterNum, frontMatter.标题, commitLines))

    // 4. 清工作区（必须在 commit 成功之后）
    for (const wf of workspaceFiles) {
      await fs.rm(path.join(repoPath, '工作区', wf), { force: true })
    }

    return { ok: true, commitHash, error: '' }
  } catch (err) {
    // commit 前中断：回滚未提交写入（仅 定稿/大纲），工作区原样保留
    try {
      await git.restore(['定稿/', '大纲/'])
      await git.clean(['定稿/', '大纲/'])
    } catch {
      // 回滚尽力而为；M3 git 健康检查兜底
    }
    return {
      ok: false,
      error: `定稿中断，已回滚未提交写入、工作区原样保留：${err.message}`,
    }
  }
}

function buildCommitMessage(chapterNum, title, lines) {
  let msg = `ch(${chapterNum}): ${title}`
  const extras = []
  if (lines.条目) extras.push(`条目: ${lines.条目}`)
  if (lines.设定) extras.push(`设定: ${lines.设定}`)
  if (extras.length) msg += '\n\n' + extras.join('\n')
  return msg
}
