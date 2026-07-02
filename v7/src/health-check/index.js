import { promises as fs } from 'node:fs'
import path from 'node:path'
import { assembleBookStatus } from '../prep/book-status.js'

/**
 * 最小体检（spec 0.9 §10 序 5 的执行点）：汇总既有可算项落 工作区/体检报告.md，
 * 并把本次体检章号记入缓存 meta——序 5 的"距上次体检"判定依赖该记录。
 * 文体统计项（指纹/高频意象/句式）随 M5.5 落地，报告中如实占位（降级诚实）。
 * @param {{repoPath: string, cache: object}} ctx
 * @returns {Promise<{ok: boolean, filePath: string, maxChapter?: number, error: string}>}
 */
export async function runHealthCheck(ctx) {
  try {
    const { repoPath, cache } = ctx
    const status = await assembleBookStatus(ctx)
    if (!status.ok) return { ok: false, filePath: '', error: status.error }

    const rows = await cache.query('SELECT MAX(chapter_num) AS m FROM chapters')
    const maxChapter = rows[0]?.m || 0

    const activity = await cache.query(
      'SELECT type, status, COUNT(*) AS c FROM threads GROUP BY type, status ORDER BY type, status'
    )
    const typeName = { foreshadow: '伏笔', suspense: '悬念', romance: '感情线' }
    const 活跃行 = activity.length
      ? activity.map((r) => `- ${typeName[r.type] || r.type}·${r.status}：${r.c} 条`).join('\n')
      : '- （无条目）'

    const overdue = status.data.悬了太久
    const 悬行 = overdue.length
      ? overdue.map((t) => `- ${t.id}：悬了 ${t.overdue_count} 章`).join('\n')
      : '- 无'

    const content = [
      `# 体检报告（第 ${maxChapter} 章）`,
      '',
      status.markdown,
      '',
      '## 悬了太久（提醒不是错误）',
      悬行,
      '',
      '## 条目活跃率',
      活跃行,
      '',
      '## 连续弱钩',
      `- ${status.data.连续弱钩} 章`,
      '',
      '## 文体指纹 / 高频意象 / 句式体检',
      '- 随 M5.5 体检里程碑落地，本版不含。',
      '',
    ].join('\n')

    const dir = path.join(repoPath, '工作区')
    await fs.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, '体检报告.md')
    await fs.writeFile(filePath, content, 'utf8')

    await cache.run(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_health_check_chapter', ?)",
      [String(maxChapter)]
    )
    return { ok: true, filePath, maxChapter, error: '' }
  } catch (err) {
    return { ok: false, filePath: '', error: `体检失败：${err.message}` }
  }
}
