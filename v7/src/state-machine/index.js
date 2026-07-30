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

  // 空工作目录（bin 定位后无当前书）：没有书仓库可查,直接序1 建书引导（spec §10 序1「工作目录无任何书」）
  if (!repoPath) {
    return mk(1, 'create-book', true, '工作目录还没有书，进入建书引导。', { fixed: [], guidance: [] }, await buildDto(ctx, 1, {}), ctx)
  }

  const gitHealth = await checkGitHealth(ctx)

  // 序0 修复确认（检测=脚本，提议=AI）
  const failures = await d.detectParseFailures(repoPath)
  // 作品契约缺/坏由序4、序6的同一 ContractReader 阻断，不送进 AI 修复或创作态。
  // 若还有其他源文件错误，仍保持既有序0修复确认语义。
  const repairFailures = failures.filter(
    (failure) => failure.file !== '作品契约/作品契约.md'
  )
  if (repairFailures.length) {
    return mk(0, 'repair-confirm', true, `检测到 ${repairFailures.length} 个源文件解析失败，需逐个修复确认。`, gitHealth, await buildDto(ctx, 0, { failures: repairFailures }), ctx)
  }

  // 序1 建书引导
  if (await d.bookMissing(repoPath)) {
    return mk(1, 'create-book', true, '当前目录还没有书，进入建书引导。', gitHealth, await buildDto(ctx, 1, {}), ctx)
  }

  // 序2 手改补登（检测=脚本;补登执行体也是脚本：relink 命令,作者确认后跑）
  const manualEdits = await d.listManualEdits(repoPath, ctx.degradation)
  if (manualEdits.length) {
    return mk(2, 'relink-manual-edits', false, `书仓源文件有 ${manualEdits.length} 处未登记的手改，问作者「补登吗」，确认后运行 relink --message=<一句话说明> 入档。`, gitHealth, await buildDto(ctx, 2, { manualEdits }), ctx)
  }

  // 序3 断点续跑
  const unfinished = await d.unfinishedWorkDetail(repoPath)
  if (unfinished.现存.length) {
    return mk(3, 'resume', false, `工作区有未完成的流程（${unfinished.现存.join('、')}），从「${unfinished.从哪继续}」继续。`, gitHealth, await buildDto(ctx, 3, unfinished), ctx)
  }

  // 序4/5/6 需章号信息。查询失败不裸抛也不降级成「第 1 章」（D7）——
  // 假 maxChapter=0 会引导重抄第 1 章，比报错更危险
  let last = null
  try {
    const lastRows = await cache.query(
      'SELECT chapter_num, volume_num, is_volume_end FROM chapters ORDER BY chapter_num DESC LIMIT 1'
    )
    last = lastRows[0] || null
  } catch (err) {
    return {
      ok: false,
      序: null,
      state: 'cache-error',
      needsAI: false,
      gitHealth,
      dto: {},
      message: `缓存查询失败（${err.message}）：删除书目录下 .cache/ 后重跑 next，会自动重建缓存。`,
    }
  }
  const maxChapter = last?.chapter_num || 0
  const config = await new BookConfigReader(repoPath).read()
  const 体检周期 = (config.ok && config.data.体检周期) || 50

  // 序4 卷复盘（收卷声明制，spec 0.9 §10：最新定稿章声明了收卷；复盘完成以卷摘要存在为准，防重复触发。对谈=AI）
  if (last && last.is_volume_end && !(await d.volumeReviewDone(repoPath, last.volume_num))) {
    const volumeDto = await buildDto(ctx, 4, {
      卷: last.volume_num,
    })
    if (volumeDto.阻断原因) {
      return {
        ok: false,
        序: 4,
        state: 'volume-review-blocked',
        needsAI: false,
        gitHealth,
        dto: volumeDto,
        message: volumeDto.阻断原因,
      }
    }
    return mk(4, 'volume-review', true, `第 ${last.chapter_num} 章已收卷，进入第 ${last.volume_num} 卷复盘。`, gitHealth, volumeDto, ctx)
  }

  // 序5 体检（距上次体检 ≥ 体检周期；记录存缓存 meta，丢失重测无害。统计项随 M5.5，最小体检=health-check 命令）
  const lastCheck = await readLastHealthCheck(cache)
  if (maxChapter > 0 && maxChapter - lastCheck >= 体检周期) {
    return mk(5, 'health-check', false, `距上次体检已 ${maxChapter - lastCheck} 章（周期 ${体检周期}），进入体检。`, gitHealth, {}, ctx)
  }

  // 序6 起草新章细纲（近况=脚本，拟提案=AI）
  const draftDto = await buildDto(ctx, 6, {
    nextChapter: maxChapter + 1,
  })
  if (draftDto.阻断原因) {
    return {
      ok: false,
      序: 6,
      state: 'draft-outline-blocked',
      needsAI: false,
      gitHealth,
      dto: draftDto,
      message: draftDto.阻断原因,
    }
  }
  return mk(6, 'draft-outline', true, `起草第 ${maxChapter + 1} 章细纲。`, gitHealth, draftDto, ctx)
}

function mk(序, state, needsAI, message, gitHealth, dto, ctx = null) {
  // P1-F6：收口兜底——DTO 前各种有损降级在此统一 drain 进 dto.degraded（无事件不出键）。
  // AI 据此区分「没有数据」与「读取失败后的残缺数据」。
  const degradationEvents = ctx?.degradation?.drain() || []
  const finalDto = degradationEvents.length ? { ...dto, degraded: degradationEvents } : dto
  return { ok: true, 序, state, needsAI, message, gitHealth, dto: finalDto }
}

async function readLastHealthCheck(cache) {
  try {
    const rows = await cache.query("SELECT value FROM meta WHERE key = 'last_health_check_chapter'")
    return parseInt(rows[0]?.value || '0', 10) || 0
  } catch {
    return 0
  }
}
