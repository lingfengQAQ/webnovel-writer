import { checkGitHealth } from './git-health.js'
import { BookConfigReader } from '../storage/adapters/BookConfigReader.js'
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
    return mk(0, 'repair-confirm', true, `检测到 ${failures.length} 个源文件解析失败，需逐个修复确认。`, gitHealth, { failures })
  }

  // 序1 建书引导
  if (await d.bookMissing(repoPath)) {
    return mk(1, 'create-book', true, '当前目录还没有书，进入建书引导。', gitHealth, {})
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
  const maxRow = await cache.query('SELECT MAX(chapter_num) AS m FROM chapters')
  const maxChapter = maxRow[0]?.m || 0
  const config = await new BookConfigReader(repoPath).read()
  const 卷规模 = (config.ok && config.data.卷规模) || 40
  const 体检周期 = (config.ok && config.data.体检周期) || 50

  // 序4 卷复盘（卷末章；对谈=AI）
  if (maxChapter > 0 && maxChapter % 卷规模 === 0) {
    return mk(4, 'volume-review', true, `第 ${maxChapter} 章是卷末，进入卷复盘。`, gitHealth, {
      卷: Math.floor(maxChapter / 卷规模),
    })
  }

  // 序5 体检（脚本项；指纹推 M3+）
  if (maxChapter > 0 && maxChapter % 体检周期 === 0) {
    return mk(5, 'health-check', false, `已到体检周期（第 ${maxChapter} 章），进入体检。`, gitHealth, {})
  }

  // 序6 起草新章细纲（近况=脚本，拟提案=AI）
  return mk(6, 'draft-outline', true, `起草第 ${maxChapter + 1} 章细纲。`, gitHealth, {
    nextChapter: maxChapter + 1,
  })
}

function mk(序, state, needsAI, message, gitHealth, dto) {
  return { ok: true, 序, state, needsAI, message, gitHealth, dto }
}
