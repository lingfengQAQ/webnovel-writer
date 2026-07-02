import { checkGitHealth } from './git-health.js'
import { BookConfigReader } from '../storage/adapters/BookConfigReader.js'
import { buildDto } from './dto.js'
import * as d from './detectors.js'

/**
 * 状态机单入口（spec §10）：先跑 git 健康检查，再按序 0-6 命中即停判定下一步。
 * 只路由、不判业务、不调 AI——AI 态返回 needsAI=true + dto 交 M4。
 * @param {{repoPath: string, cache: object}} ctx
 * @returns {Promise<{ok, gitHealth, 序, state, needsAI, message, dto}>}
 */
export async function determineNextState(ctx) {
  const { repoPath, cache } = ctx
  const gitHealth = await checkGitHealth(ctx)

  // 序0 修复确认（检测=脚本，提议=AI）
  const failures = await d.detectParseFailures(repoPath)
  if (failures.length) {
    return mk(0, 'repair-confirm', true, `检测到 ${failures.length} 个源文件解析失败，需逐个修复确认。`, gitHealth, await buildDto(ctx, 0, { failures }))
  }

  // 序1 建书引导
  if (await d.bookMissing(repoPath)) {
    return mk(1, 'create-book', true, '当前目录还没有书，进入建书引导。', gitHealth, await buildDto(ctx, 1, {}))
  }

  // 序2 手改补登
  if (await d.hasManualEdits(repoPath)) {
    return mk(2, 'relink-manual-edits', false, '定稿/大纲 有未登记的手改，建议补登（fix）。', gitHealth, {})
  }

  // 序3 断点续跑
  if (await d.hasUnfinishedWork(repoPath)) {
    return mk(3, 'resume', false, '工作区有未完成的流程，从中断处继续。', gitHealth, {})
  }

  // 序4/5/6 需章号信息
  const lastRows = await cache.query(
    'SELECT chapter_num, volume_num, is_volume_end FROM chapters ORDER BY chapter_num DESC LIMIT 1'
  )
  const last = lastRows[0] || null
  const maxChapter = last?.chapter_num || 0
  const config = await new BookConfigReader(repoPath).read()
  const 体检周期 = (config.ok && config.data.体检周期) || 50

  // 序4 卷复盘（收卷声明制，spec 0.9 §10：最新定稿章声明了收卷；复盘完成以卷摘要存在为准，防重复触发。对谈=AI）
  if (last && last.is_volume_end && !(await d.volumeReviewDone(repoPath, last.volume_num))) {
    return mk(4, 'volume-review', true, `第 ${last.chapter_num} 章已收卷，进入第 ${last.volume_num} 卷复盘。`, gitHealth, await buildDto(ctx, 4, {
      卷: last.volume_num,
    }))
  }

  // 序5 体检（距上次体检 ≥ 体检周期；记录存缓存 meta，丢失重测无害。统计项随 M5.5，最小体检=health-check 命令）
  const lastCheck = await readLastHealthCheck(cache)
  if (maxChapter > 0 && maxChapter - lastCheck >= 体检周期) {
    return mk(5, 'health-check', false, `距上次体检已 ${maxChapter - lastCheck} 章（周期 ${体检周期}），进入体检。`, gitHealth, {})
  }

  // 序6 起草新章细纲（近况=脚本，拟提案=AI）
  return mk(6, 'draft-outline', true, `起草第 ${maxChapter + 1} 章细纲。`, gitHealth, await buildDto(ctx, 6, {
    nextChapter: maxChapter + 1,
  }))
}

function mk(序, state, needsAI, message, gitHealth, dto) {
  return { ok: true, 序, state, needsAI, message, gitHealth, dto }
}

async function readLastHealthCheck(cache) {
  try {
    const rows = await cache.query("SELECT value FROM meta WHERE key = 'last_health_check_chapter'")
    return parseInt(rows[0]?.value || '0', 10) || 0
  } catch {
    return 0
  }
}
