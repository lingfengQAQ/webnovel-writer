import { promises as fs } from 'node:fs'
import path from 'node:path'
import { assembleBookStatus } from '../prep/book-status.js'
import { BookConfigReader } from '../storage/adapters/BookConfigReader.js'
import { TimelineReader } from '../storage/adapters/TimelineReader.js'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'
import { extractImagery, extractFingerprint, styleMetrics } from '../style-stats/index.js'
import { configuredBaselineRange } from './baseline.js'

// 高频意象入 meta/报告的条数（提醒不拦截，硬编码合理默认）
const IMAGERY_TOP = 20

/**
 * 体检（spec §9/§10 序 5 的执行点，零 token）：账面汇总 + 三统计（跨章高频意象、
 * 近段句式、文体指纹基线对比）+ 缺时间锚点，报告落 工作区/体检报告.md（不入档），
 * 体检章号与高频意象清单记缓存 meta（跨重建保留，丢失重测无害）。
 * 单项统计失败不炸整个体检，节内如实说明（降级诚实）。
 * @param {{repoPath: string, cache: object}} ctx
 * @returns {Promise<{ok: boolean, filePath: string, maxChapter?: number, data?: object, error: string}>}
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

    const config = await new BookConfigReader(repoPath).read()
    const bookConfig = config.ok ? config.data : {}
    const baselineRange = config.ok ? configuredBaselineRange(bookConfig) : null
    const 体检周期 = bookConfig.体检周期 || 50
    // 近段窗口只依赖书状态不依赖 meta：缓存/体检记录丢失不改变体检输出（确定性）
    const 近段起 = Math.max(1, maxChapter - 体检周期 + 1)

    const exclude = await readExcludeNames(cache)

    // M6 阈值判定的对接面（本任务不判"过线/不过线"）；单项失败该键保持 null
    const data = {
      高频意象: null,
      句式: null,
      指纹: null,
      缺时间锚点: null,
      悬了太久: overdue,
      条目活跃率: activity.map((r) => ({ 类型: typeName[r.type] || r.type, 状态: r.status, 条数: r.c })),
      连续弱钩: status.data.连续弱钩,
    }

    // 全书语料一次读入，三统计共用；读取失败三节共同如实降级
    let corpus = []
    let corpusFail = ''
    try {
      corpus = await loadCorpus(cache)
    } catch (err) {
      corpusFail = `定稿正文读取失败：${err.message}`
    }

    // 基线是当前 book.yaml 区间的派生物。配置切换或区间未齐时，先移除所有旧 active 行，
    // 避免任何消费者继续读到历史基线；语料读不到时本轮无从判断该不该清，保留已有基线。
    if (!corpusFail) await cache.run('DELETE FROM fingerprints WHERE is_baseline = 1')

    let 意象节 = ''
    let 句式节 = ''
    let 指纹节 = ''
    if (corpusFail) {
      意象节 = 句式节 = 指纹节 = `- 该项计算失败：${corpusFail}`
    } else if (!corpus.length) {
      意象节 = 句式节 = 指纹节 = '- 还没有定稿章，暂无可统计。'
    } else {
      // 跨章高频意象（全书）：清单进 meta 供备料/机检消费
      try {
        const top = extractImagery(corpus, exclude).slice(0, IMAGERY_TOP)
        data.高频意象 = top
        await cache.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('imagery_top', ?)", [
          JSON.stringify(top),
        ])
        意象节 = top.length
          ? top
              .map(
                (t) =>
                  `- 「${t.phrase}」：全书 ${t.count} 次，${t.chapterCount} 章出现（第 ${t.firstChapter}-${t.lastChapter} 章间）`
              )
              .join('\n')
          : '- 无（未发现跨章高频复用短语）'
      } catch (err) {
        意象节 = `- 该项计算失败：${err.message}`
      }

      // 句式体检（近段窗口）
      try {
        const 近段章 = corpus.filter((c) => c.num >= 近段起)
        const metrics = styleMetrics(近段章.map((c) => c.text).join('\n\n'), exclude)
        data.句式 = { 窗口: [近段起, maxChapter], ...metrics }
        句式节 = render句式(metrics)
      } catch (err) {
        句式节 = `- 该项计算失败：${err.message}`
      }

      // 文体指纹：基线段 + 近段各算一份 upsert 入表，报告出漂移对比
      try {
        const r = await compareFingerprints(cache, corpus, exclude, {
          baselineRange,
          baselineConfigError: config.ok ? '' : config.error,
          近段起,
          maxChapter,
        })
        指纹节 = r.text
        data.指纹 = r.data
      } catch (err) {
        指纹节 = `- 该项计算失败：${err.message}`
      }
    }

    // 缺时间锚点（独立于正文语料：查 chapters 表 + 时间线文件）
    let 锚点节 = ''
    try {
      const missing = await findMissingTimeAnchors(cache, repoPath)
      data.缺时间锚点 = missing
      锚点节 = missing.length
        ? missing.map((m) => `- 第 ${m.章} 章：${m.缺.join('；')}`).join('\n')
        : '- 无（每章都有书内时间，时间线也不缺行）'
    } catch (err) {
      锚点节 = `- 该项计算失败：${err.message}`
    }

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
      '## 高频意象（跨章）',
      意象节,
      '',
      `## 句式体检（第 ${近段起}-${maxChapter} 章）`,
      句式节,
      '',
      '## 文体指纹漂移',
      指纹节,
      '',
      '## 缺时间锚点',
      锚点节,
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
    return { ok: true, filePath, maxChapter, data, error: '' }
  } catch (err) {
    return { ok: false, filePath: '', error: `体检失败：${err.message}` }
  }
}

// 全书定稿正文：chapters 表逐章读文件、剥 front matter
async function loadCorpus(cache) {
  const rows = await cache.query('SELECT chapter_num, file_path FROM chapters ORDER BY chapter_num')
  const corpus = []
  for (const r of rows) {
    const raw = await fs.readFile(r.file_path, 'utf8')
    corpus.push({ num: r.chapter_num, text: parseFrontMatter(raw).body })
  }
  return corpus
}

// 名册专名 + 别名（同机检取法）；无名册不拦体检
async function readExcludeNames(cache) {
  const names = new Set()
  try {
    for (const e of await cache.query('SELECT id FROM entities')) names.add(e.id)
    for (const a of await cache.query('SELECT alias FROM entity_aliases')) names.add(a.alias)
  } catch {
    // 名册缺失，统计不排除
  }
  return names
}

async function compareFingerprints(
  cache,
  corpus,
  exclude,
  { baselineRange, baselineConfigError, 近段起, maxChapter }
) {
  if (!baselineRange) {
    return {
      text: `- 文体基线配置无效${baselineConfigError ? `：${baselineConfigError}` : ''}，尚未建立基线。`,
      data: null,
    }
  }
  const { start: 基线起, end: 基线止 } = baselineRange
  const inRange = (s, e) => corpus.filter((c) => c.num >= s && c.num <= e)

  const baselineChapters = inRange(基线起, 基线止)
  const expectedCount = 基线止 - 基线起 + 1
  if (baselineChapters.length !== expectedCount) {
    return {
      text: `- 文体基线尚未建立：配置区间为第 ${基线起}-${基线止} 章，当前仅找到 ${baselineChapters.length}/${expectedCount} 章，暂不比较。`,
      data: null,
    }
  }

  const baseFp = extractFingerprint(baselineChapters, exclude)
  await upsertFingerprint(cache, 基线起, 基线止, 1, baseFp)
  const 基线 = fpSummary(基线起, 基线止, baseFp)

  // 基线段与近段完全重合（全书尚在基线区间内）：只落基线行，避免同主键行被近段覆盖掉基线标记
  if (基线起 === 近段起 && 基线止 === maxChapter) {
    return {
      text: [
        '- 全书尚在基线区间内，基线与近段重合，暂无漂移可比。',
        `- 基线（第 ${基线起}-${基线止} 章）：${fpLine(baseFp)}`,
      ].join('\n'),
      data: { 基线, 近段: null, delta: null },
    }
  }

  const recentFp = extractFingerprint(inRange(近段起, maxChapter), exclude)
  await upsertFingerprint(cache, 近段起, maxChapter, 0, recentFp)
  const 近段 = fpSummary(近段起, maxChapter, recentFp)
  const delta = {
    平均句长: recentFp.avg_sentence_length - baseFp.avg_sentence_length,
    句长方差: recentFp.sentence_length_variance - baseFp.sentence_length_variance,
    平均段长: recentFp.avg_paragraph_length - baseFp.avg_paragraph_length,
    词汇丰富度: recentFp.vocabulary_richness - baseFp.vocabulary_richness,
  }
  const text = [
    `- 基线（第 ${基线起}-${基线止} 章）：${fpLine(baseFp)}`,
    `- 近段（第 ${近段起}-${maxChapter} 章）：${fpLine(recentFp)}`,
    `- 漂移：平均句长 ${deltaLine(delta.平均句长, baseFp.avg_sentence_length, '字')}，句长方差 ${deltaLine(delta.句长方差, baseFp.sentence_length_variance, '')}，平均段长 ${deltaLine(delta.平均段长, baseFp.avg_paragraph_length, '字')}，词汇丰富度 ${signed(delta.词汇丰富度, 3)}`,
    `- 若感觉文风漂了：回读基线章（第 ${基线起}-${基线止} 章）找回手感；若新写法更合心意：把 book.yaml 里的 文体基线起/文体基线止 改成新章段。这一步由你决定，脚本不自动改。`,
  ].join('\n')
  return { text, data: { 基线, 近段, delta } }
}

async function upsertFingerprint(cache, start, end, isBaseline, fp) {
  await cache.run(
    `INSERT OR REPLACE INTO fingerprints
      (chapter_range_start, chapter_range_end, is_baseline, avg_sentence_length,
       sentence_length_variance, avg_paragraph_length, common_phrase_frequency,
       vocabulary_richness, fingerprint_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      start,
      end,
      isBaseline,
      fp.avg_sentence_length,
      fp.sentence_length_variance,
      fp.avg_paragraph_length,
      JSON.stringify(fp.common_phrase_frequency),
      fp.vocabulary_richness,
      JSON.stringify(fp.fingerprint_data),
    ]
  )
}

// 缺时间锚点两种缺法合并：front matter 无「书内时间」（story_time 空）/ 时间线没有该章的行
async function findMissingTimeAnchors(cache, repoPath) {
  const rows = await cache.query(
    'SELECT chapter_num, story_time, volume_num FROM chapters ORDER BY chapter_num'
  )
  if (!rows.length) return []
  const maxVol = rows.reduce((m, r) => Math.max(m, r.volume_num || 1), 1)
  const tl = await new TimelineReader(repoPath, cache).readVolumeRange(1, maxVol)
  const inTimeline = new Set()
  for (const row of tl.timeline) {
    const n = parseInt(row.章, 10)
    if (Number.isFinite(n)) inTimeline.add(n)
  }
  const missing = []
  for (const r of rows) {
    const 缺 = []
    if (!r.story_time || !String(r.story_time).trim()) 缺.push('front matter 无「书内时间」')
    if (!inTimeline.has(r.chapter_num)) 缺.push('时间线没有这章的行')
    if (缺.length) missing.push({ 章: r.chapter_num, 缺 })
  }
  return missing
}

// —— 报告渲染 ——

function render句式(m) {
  const 分布标签 = { 短: '短(≤50字)', 中: '中(51-150字)', 长: '长(151-300字)', 超长: '超长(>300字)' }
  const 分布 = Object.entries(m.段落分布)
    .map(([k, v]) => `${分布标签[k]} ${v.段数} 段（${pct(v.占比)}）`)
    .join(' / ')
  const 开头 = m.高频开头.length
    ? m.高频开头.map((o) => `「${o.开头}」${o.次数} 次（${pct(o.占比)}）`).join('、')
    : '无明显聚集'
  return [
    `- 句子：${m.句数} 句，平均句长 ${fix(m.平均句长)} 字，句长方差 ${fix(m.句长方差)}`,
    `- 段落长度分布：共 ${m.段落数} 段，平均段长 ${fix(m.平均段长)} 字；${分布}`,
    `- 高频句式开头：${开头}`,
  ].join('\n')
}

function fpSummary(start, end, fp) {
  return {
    范围: [start, end],
    平均句长: fp.avg_sentence_length,
    句长方差: fp.sentence_length_variance,
    平均段长: fp.avg_paragraph_length,
    词汇丰富度: fp.vocabulary_richness,
    常用短语: fp.common_phrase_frequency,
  }
}

function fpLine(fp) {
  return `平均句长 ${fix(fp.avg_sentence_length)} 字，句长方差 ${fix(fp.sentence_length_variance)}，平均段长 ${fix(fp.avg_paragraph_length)} 字，词汇丰富度 ${fp.vocabulary_richness.toFixed(3)}`
}

function deltaLine(delta, base, unit) {
  const head = `${signed(delta, 1)}${unit}`
  if (!base) return head
  return `${head}（${signed((delta / base) * 100, 0)}%）`
}

function signed(n, digits) {
  const v = n.toFixed(digits)
  return n >= 0 ? `+${v}` : v
}

function fix(n) {
  return n.toFixed(1)
}

function pct(x) {
  return `${Math.round(x * 100)}%`
}
