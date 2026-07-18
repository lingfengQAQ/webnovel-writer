import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ChapterWriter } from '../storage/adapters/ChapterWriter.js'
import { ThreadLedgerWriter } from '../storage/adapters/ThreadLedgerWriter.js'
import { EntityWriter } from '../storage/adapters/EntityWriter.js'
import { TimelineWriter } from '../storage/adapters/TimelineWriter.js'
import { SecretWriter } from '../storage/adapters/SecretWriter.js'
import { SummaryWriter } from '../storage/adapters/SummaryWriter.js'
import { createGit } from './git.js'
import { refreshCacheAfterSourceChange } from '../cache/index.js'
import { normalizeWorkspaceRel } from '../util/workspace-path.js'
import { validateFactChanges } from '../knowledge/fact-changes.js'
import { sanitizeFileName } from '../util/filename.js'
import { archiveChapterKnowledgeFromOutline } from '../knowledge/chapter.js'

/**
 * 定稿：原子 commit（D3）。写工作树 → git add → commit → 最后清工作区。
 * 断电安全：commit 前任何中断都回滚未提交写入（仅 定稿/大纲，不碰工作区），
 * 工作区草稿原样保留，不存在半章入档。
 *
 * @param {{repoPath: string, cache?: object}} ctx
 * @param {object} payload 定稿包（章档案/正文/摘要/条目/设定变更/commit 行/待清工作区文件）
 * @param {{git?: object, faultAfterWrite?: boolean, archiveOutline?: boolean}} [opts]
 *   注入 git（测试）/故障注入（断电模拟）；批量转正传 archiveOutline=false，只消费暂存值
 * @returns {Promise<{ok: boolean, commitHash?: string, error?: string}>}
 */
export async function finalizeChapter(ctx, payload, opts = {}) {
  const { repoPath } = ctx
  const git = opts.git || createGit(repoPath)
  if (opts.archiveOutline !== false) {
    const archived = await archiveChapterKnowledgeFromOutline(ctx, payload)
    if (!archived.ok) return { ok: false, error: `定稿停止：${archived.error}` }
    payload = archived.payload
  }
  const {
    chapterNum,
    frontMatter,
    body = '',
    summary = null,
    threadCreates = [],
    threadUpdates = [],
    characterUpdates = [],
    rosterUpserts = [],
    timelineRows = [],
    secretWrites = [],
    factChanges = [],
    commitLines = {},
    workspaceFiles = [],
  } = payload

  // 1. 校验（不过则什么都没写，天然原样）
  if (!Number.isInteger(chapterNum)) return { ok: false, error: '章号必须是整数' }
  if (!frontMatter || !frontMatter.标题) return { ok: false, error: '缺少章档案或标题' }
  const factValidation = await validateFactChanges(repoPath, factChanges)
  if (!factValidation.ok) {
    return { ok: false, error: `事实转正停止：${factValidation.errors.join('；')}` }
  }
  const factTargetCollisions = findFactTargetCollisions(factValidation.changes, {
    characterUpdates,
    rosterUpserts,
    timelineRows,
    secretWrites,
  })
  if (factTargetCollisions.length) {
    return { ok: false, error: `事实转正停止：${factTargetCollisions.join('；')}` }
  }

  const stageFiles = []
  const rollbackFiles = []
  const chapterBackups = []
  let cacheRefresh = null
  try {
    // 2. 写工作树（全部落 定稿/大纲，非 工作区）
    const cw = await new ChapterWriter(repoPath).writeChapter(chapterNum, frontMatter, body, {
      preserveBackups: true,
    })
    if (!cw.ok) throw new Error(cw.error)
    stageFiles.push(cw.filePath, ...(cw.removedPaths || []))
    rollbackFiles.push(cw.filePath)
    chapterBackups.push(...(cw.backups || []))

    if (summary != null) {
      const sw = await new SummaryWriter(repoPath).writeChapterSummary(chapterNum, summary)
      if (!sw.ok) throw new Error(sw.error)
      stageFiles.push(sw.filePath)
      rollbackFiles.push(sw.filePath)
    }

    const tlw = new ThreadLedgerWriter(repoPath)
    // 新开条目先建档（开启类声明的入档执行体），再处理更新——同一章可"埋下并写首条履历"
    for (const t of threadCreates) {
      const r = await tlw.createThread(t)
      if (!r.ok) throw new Error(r.error)
      stageFiles.push(r.filePath)
      rollbackFiles.push(r.filePath)
    }
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
      if (f) {
        stageFiles.push(f)
        rollbackFiles.push(f)
      }
    }

    const ew = new EntityWriter(repoPath)
    for (const c of characterUpdates) {
      const r = await ew.updateCharacter(c.name, c.updates)
      if (!r.ok) throw new Error(r.error)
      // 路径取写入器返回值（A10：文件名净化单源，防手拼路径与实际写点分裂）
      stageFiles.push(r.filePath)
      rollbackFiles.push(r.filePath)
    }
    for (const row of rosterUpserts) {
      const r = await ew.upsertRosterRow(row)
      if (!r.ok) throw new Error(r.error)
      const filePath = path.join(repoPath, '定稿', '设定', '名册.md')
      stageFiles.push(filePath)
      rollbackFiles.push(filePath)
    }

    const tw = new TimelineWriter(repoPath)
    for (const tr of timelineRows) {
      const r = await tw.appendRow(tr.volumeNum, tr.row)
      if (!r.ok) throw new Error(r.error)
      stageFiles.push(r.filePath)
      rollbackFiles.push(r.filePath)
    }

    const secw = new SecretWriter(repoPath)
    for (const s of secretWrites) {
      const r = await secw.write(s.id, s.frontMatter, s.content)
      if (!r.ok) throw new Error(r.error)
      stageFiles.push(r.filePath)
      rollbackFiles.push(r.filePath)
    }

    for (const change of factValidation.changes) {
      const factFile = path.join(repoPath, ...change.factPath.split('/'))
      await fs.mkdir(path.dirname(factFile), { recursive: true })
      await fs.writeFile(factFile, change.content, 'utf8')
      stageFiles.push(factFile)
      rollbackFiles.push(factFile)
      if (change.removePlan) {
        const planFile = path.join(repoPath, ...change.planPath.split('/'))
        await fs.rm(planFile)
        stageFiles.push(planFile)
      }
    }

    // 故障注入点（断电模拟，仅测试用）
    if (opts.faultAfterWrite) throw new Error('注入故障：写工作树后、commit 前中断')

    // 3. git add + commit（原子点）
    const relFiles = [...new Set(stageFiles)].map((f) => path.relative(repoPath, f))
    await git.add(relFiles)
    const commitHash = await git.commit(buildCommitMessage(chapterNum, frontMatter.标题, commitLines))

    for (const b of chapterBackups) {
      try {
        await fs.rm(b.backup, { force: true })
      } catch {
        // 备份残留不影响已完成 commit；文件名不以 .md 结尾，不进缓存扫描
      }
    }

    // P0-1：定稿后同步刷新缓存，避免 next 读旧章号重抄本章。
    // 重建失败不阻断定稿（已 commit 入档），但不能继续保留旧缓存，否则 next 会读旧章号。
    cacheRefresh = await refreshCacheAfterSourceChange(ctx)

    // 4. 清工作区（必须在 commit 成功之后；失败只记 warning——
    //    commit 已经发生，任何清理问题都不得把结果反转成"失败/已回滚"（R4））
    const warnings = await cleanWorkspaceFiles(repoPath, workspaceFiles)

    return { ok: true, commitHash, cacheRefresh, warnings, error: '' }
  } catch (err) {
    // commit 前中断：回滚本次 stage/rollback 集合（非整棵 定稿/大纲 子树,避免误伤同子树其他章手改）。
    // 逐文件 restore:新章文件未跟踪会让整条 restore 报错被吞,逐个跑才能精确复原已跟踪文件。
    const relStageFiles = [...new Set(stageFiles)].map((f) => path.relative(repoPath, f))
    const relRollbackFiles = [...new Set(rollbackFiles)].map((f) => path.relative(repoPath, f))
    try {
      for (const rel of relStageFiles) {
        await git.restore([rel])
      }
      await git.clean(relRollbackFiles)
      for (const b of chapterBackups.toReversed()) {
        await fs.rm(b.original, { force: true })
        await fs.rename(b.backup, b.original)
      }
      for (const b of chapterBackups) {
        const rel = path.relative(repoPath, b.original)
        if (!(await git.hasDiff([rel]))) await git.restore([rel])
      }
    } catch {
      // 回滚尽力而为；M3 git 健康检查兜底
    }
    return {
      ok: false,
      error: `定稿中断，已回滚未提交写入、工作区原样保留：${err.message}`,
    }
  }
}

function findFactTargetCollisions(
  changes,
  { characterUpdates, rosterUpserts, timelineRows, secretWrites }
) {
  const managed = new Set()
  for (const update of characterUpdates) {
    if (update?.name) managed.add(`定稿/设定/角色/${sanitizeFileName(update.name)}.md`)
  }
  if (rosterUpserts.length) managed.add('定稿/设定/名册.md')
  for (const row of timelineRows) {
    const volume = Number(row?.volumeNum)
    if (Number.isInteger(volume) && volume > 0) {
      managed.add(`定稿/设定/时间线/第${String(volume).padStart(2, '0')}卷.md`)
    }
  }
  for (const secret of secretWrites) {
    if (secret?.id) managed.add(`定稿/设定/信息差/${secret.id}.md`)
  }
  return changes
    .filter((change) => managed.has(change.factPath))
    .map((change) => `${change.factPath} 同时出现在 factChanges 与其他事实写入字段中`)
}

function buildCommitMessage(chapterNum, title, lines) {
  let msg = `ch(${chapterNum}): ${title}`
  const extras = []
  if (lines.条目) extras.push(`条目: ${lines.条目}`)
  if (lines.设定) extras.push(`设定: ${lines.设定}`)
  if (extras.length) msg += '\n\n' + extras.join('\n')
  return msg
}

/**
 * commit 后的工作区清理：归一路径（剥前缀+拒 `..`，C2/G-4）、目录也能清（recursive），
 * 任何失败只收 warning 永不抛——本函数在原子点之后运行，不许影响定稿结果。
 */
async function cleanWorkspaceFiles(repoPath, workspaceFiles) {
  const warnings = []
  for (const wf of workspaceFiles) {
    const name = normalizeWorkspaceRel(wf)
    if (!name) {
      warnings.push(`工作区清理跳过可疑路径「${wf}」（不在工作区内）。`)
      continue
    }
    try {
      await fs.rm(path.join(repoPath, '工作区', name), { recursive: true, force: true })
    } catch (err) {
      warnings.push(`工作区/${name} 清理失败（${err.message}）——本章已入档，稍后手动删除即可。`)
    }
  }
  return warnings
}
