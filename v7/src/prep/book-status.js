import { ThreadLedgerReader } from '../storage/adapters/ThreadLedgerReader.js'
import { BookConfigReader } from '../storage/adapters/BookConfigReader.js'
import { isWeakHook } from '../util/hooks.js'

/**
 * 组装全书近况（喂细纲 step1 与备料 step3）。复用 M1 缓存与读端口，派生值查询时算。
 * @param {{repoPath: string, cache: object}} ctx
 * @returns {Promise<{ok: boolean, data: object|null, markdown: string, error: string}>}
 */
export async function assembleBookStatus(ctx) {
  try {
    const { cache, repoPath } = ctx
    const config = await new BookConfigReader(repoPath).read()
    const bookConfig = config.ok ? config.data : {}

    const volRow = await cache.query('SELECT MAX(volume_num) AS v FROM chapters')
    const 当前卷 = volRow[0]?.v || 1
    const inVol = await cache.query(
      'SELECT COUNT(*) AS c FROM chapters WHERE volume_num = ?',
      [当前卷]
    )
    const stats = await cache.query(
      'SELECT COUNT(*) AS c, COALESCE(SUM(word_count), 0) AS w FROM chapters'
    )
    const th = await cache.query('SELECT COUNT(*) AS c FROM threads')
    const en = await cache.query("SELECT COUNT(*) AS c FROM entities WHERE type = 'character'")

    // 连续弱钩（查询时算）
    const hookRows = await cache.query(
      'SELECT hook_type FROM chapters ORDER BY chapter_num DESC LIMIT 20'
    )
    let 连续弱钩 = 0
    for (const r of hookRows) {
      if (isWeakHook(r.hook_type)) 连续弱钩++
      else break
    }

    // 悬了太久（查询时算，阈值从 book.yaml）
    const overdue = await new ThreadLedgerReader(repoPath, cache).listOverdue(bookConfig)

    const 卷规模 = bookConfig.卷规模 || 40
    const data = {
      当前卷,
      卷内进度: { 写到: inVol[0]?.c || 0, 卷规模 },
      总章数: stats[0].c,
      总字数: stats[0].w,
      条目数: th[0].c,
      角色数: en[0].c,
      连续弱钩,
      悬了太久: overdue,
    }

    return { ok: true, data, markdown: renderBookStatus(data), error: '' }
  } catch (err) {
    return { ok: false, data: null, markdown: '', error: `组装全书近况失败：${err.message}` }
  }
}

/**
 * 全书近况 → Markdown（assembleBookStatus 与批次叠加视图共用同一渲染，不双写格式）。
 * @param {object} data assembleBookStatus 的 data 形状
 * @param {string[]} [extraLines] 追加在位置行之后的额外行（如批内暂存概况）
 */
export function renderBookStatus(data, extraLines = []) {
  const overdueLine = data.悬了太久.length
    ? data.悬了太久.map((t) => `${t.id}（悬了 ${t.overdue_count} 章）`).join('、')
    : '无'
  return [
    '## 全书近况（脚本生成）',
    `- 位置：第 ${data.当前卷} 卷 ${data.卷内进度.写到}/${data.卷内进度.卷规模} 章`,
    ...extraLines,
    `- 悬了太久：${overdueLine}`,
    `- 连续弱钩：${data.连续弱钩} 章`,
    `- 全书：${data.总章数} 章 / ${data.总字数} 字 / ${data.条目数} 条目 / ${data.角色数} 角色`,
  ].join('\n')
}
