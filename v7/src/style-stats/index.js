/**
 * style-stats：体检统计算法（spec §9，M5.5）。纯函数、零依赖、无 IO；
 * 全部固定排序纯计数、无时间戳无随机——同输入任何时候重算结果逐字段一致
 * （「删缓存全量重建后指纹不变」的根基）。
 */

// 跨章高频意象口径：全书 ≥10 次且 ≥3 章出现才算高频（报告是提醒不拦截，硬编码合理默认）
export const IMAGERY_MIN_COUNT = 10
export const IMAGERY_MIN_CHAPTERS = 3

// 句式偏离容差（单章机检 vs 基线、批次质检共用同一口径，不双写）
export const AVG_SENTENCE_LEN_TOLERANCE = 0.3
export const SENTENCE_VARIANCE_TOLERANCE = 0.5

const MIN_GRAM = 4
const MAX_GRAM = 8
const TTR_WINDOW = 1000

/**
 * 分句：按中文句终标点切分，句尾收编随后的闭引号（「站住！」→ 一句）。
 * @param {string} text
 * @returns {string[]} 修剪后的非空句
 */
export function splitSentences(text) {
  if (!text) return []
  return text
    .split(/[。！？；…]+[”』」]?/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 分段：一段一换行的网文约定，空行同样断段。
 * @param {string} text
 * @returns {string[]} 修剪后的非空段
 */
export function splitParagraphs(text) {
  if (!text) return []
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/**
 * 句式指标（单章机检与章段体检复用，口径一致）。长度一律取去空白字符数。
 * @param {string} text 正文
 * @param {Set<string>} exclude 名册专名/别名——句首开头统计排除人名前缀（「林晚…」是人名不是句式）
 * @returns {{句数, 平均句长, 句长方差, 段落数, 平均段长, 段落分布, 高频开头}}
 */
export function styleMetrics(text, exclude = new Set()) {
  const sentences = splitSentences(text)
  const lengths = sentences.map(countChars)
  const paragraphs = splitParagraphs(text)
  const pLengths = paragraphs.map(countChars)
  return {
    句数: sentences.length,
    平均句长: mean(lengths),
    句长方差: variance(lengths),
    段落数: paragraphs.length,
    平均段长: mean(pLengths),
    段落分布: paragraphDistribution(pLengths),
    高频开头: topOpeners(sentences, exclude),
  }
}

/**
 * 跨章高频意象：连续中文字符段内的 n-gram（n=4..8），Apriori 分层——
 * 第 n 层只数「前 n-1 字在上层已频繁」的候选，内存有界（全长度一把梭在百万字级别会爆）。
 * 专名/别名（长度 ≥2）出现处先把字符段切断：含名短语与跨名碎片（「晚冷笑一声」）都出不来，
 * 人名动作短语的重复是叙事常态不是意象复读，宁缺勿滥。
 * @param {{num: number, text: string}[]} chapters 定稿章（章号 + 正文）
 * @param {Set<string>} exclude 名册专名/别名
 * @param {{minCount?: number, minChapters?: number}} [opts] 默认全书 ≥10 次、≥3 章
 * @returns {{phrase: string, count: number, chapterCount: number, firstChapter: number, lastChapter: number}[]}
 *   按（次数 desc，字典序 asc）稳定排序的全量清单，调用方取 top-N
 */
export function extractImagery(chapters, exclude = new Set(), opts = {}) {
  const minCount = opts.minCount ?? IMAGERY_MIN_COUNT
  const minChapters = opts.minChapters ?? IMAGERY_MIN_CHAPTERS
  const names = [...exclude]
    .filter((n) => typeof n === 'string' && n.length >= 2)
    .sort((a, b) => b.length - a.length || cmp(a, b))

  const runsByChapter = chapters.map((c) => ({
    num: c.num,
    runs: cjkRuns(c.text || '', names),
  }))

  // 分层计数：phrase → 全书次数
  const frequent = new Map()
  let prevLevel = null
  for (let n = MIN_GRAM; n <= MAX_GRAM; n++) {
    const counts = new Map()
    for (const { runs } of runsByChapter) {
      for (const run of runs) {
        for (let i = 0; i + n <= run.length; i++) {
          if (prevLevel && !prevLevel.has(run.slice(i, i + n - 1))) continue
          const g = run.slice(i, i + n)
          counts.set(g, (counts.get(g) || 0) + 1)
        }
      }
    }
    const level = new Set()
    for (const [g, c] of counts) {
      if (c >= minCount) {
        level.add(g)
        frequent.set(g, c)
      }
    }
    if (!level.size) break
    prevLevel = level
  }

  // 第二遍只为频繁短语数章分布（第一遍不建 per-gram 章集合，控内存）
  const byLen = new Map()
  for (const g of frequent.keys()) {
    if (!byLen.has(g.length)) byLen.set(g.length, new Set())
    byLen.get(g.length).add(g)
  }
  const chapterSets = new Map()
  for (const { num, runs } of runsByChapter) {
    for (const run of runs) {
      for (const [len, set] of byLen) {
        for (let i = 0; i + len <= run.length; i++) {
          const g = run.slice(i, i + len)
          if (!set.has(g)) continue
          if (!chapterSets.has(g)) chapterSets.set(g, new Set())
          chapterSets.get(g).add(num)
        }
      }
    }
  }

  const candidates = []
  for (const [phrase, count] of frequent) {
    const nums = [...(chapterSets.get(phrase) || [])].sort((a, b) => a - b)
    if (nums.length < minChapters) continue
    candidates.push({
      phrase,
      count,
      chapterCount: nums.length,
      firstChapter: nums[0],
      lastChapter: nums[nums.length - 1],
    })
  }

  // 最长优先去重：子串且次数 ≤ 父串 ×1.25 视为同一意象的碎片（「气仿佛凝固」被「空气仿佛凝固」覆盖）
  candidates.sort(
    (a, b) => b.phrase.length - a.phrase.length || b.count - a.count || cmp(a.phrase, b.phrase)
  )
  const kept = []
  for (const c of candidates) {
    const covered = kept.some((k) => k.phrase.includes(c.phrase) && c.count <= k.count * 1.25)
    if (!covered) kept.push(c)
  }
  kept.sort((a, b) => b.count - a.count || cmp(a.phrase, b.phrase))
  return kept
}

/**
 * 文体指纹：章段 → fingerprints 表五常用列 + fingerprint_data 完整对象（含段落分布/高频开头/总字数/章数）。
 * 返回对象不含 JSON 字符串，序列化在落库处做。
 * @param {{num: number, text: string}[]} chapters
 * @param {Set<string>} exclude
 */
export function extractFingerprint(chapters, exclude = new Set()) {
  const combined = chapters.map((c) => c.text || '').join('\n\n')
  const metrics = styleMetrics(combined, exclude)
  // 章段内常用短语：跨章条件放宽为 ≥1（章段内统计），取 top10
  const imagery = extractImagery(chapters, exclude, { minChapters: 1 })
  const common_phrase_frequency = {}
  for (const { phrase, count } of imagery.slice(0, 10)) common_phrase_frequency[phrase] = count
  const vocabulary_richness = windowTTR(combined)
  const fingerprint_data = {
    avg_sentence_length: metrics.平均句长,
    sentence_length_variance: metrics.句长方差,
    avg_paragraph_length: metrics.平均段长,
    common_phrase_frequency,
    vocabulary_richness,
    段落分布: metrics.段落分布,
    高频开头: metrics.高频开头,
    总字数: countChars(combined),
    章数: chapters.length,
  }
  return {
    avg_sentence_length: metrics.平均句长,
    sentence_length_variance: metrics.句长方差,
    avg_paragraph_length: metrics.平均段长,
    common_phrase_frequency,
    vocabulary_richness,
    fingerprint_data,
  }
}

/**
 * 词汇丰富度：滑动窗口 TTR——剥标点空白后按 1000 字窗口求 unique/窗长 的平均（末窗用实际长度）。
 * 朴素 unique/total 对文本长度敏感，跨章段不可比。
 * @param {string} text
 * @returns {number}
 */
export function windowTTR(text) {
  const chars = [...(text || '').replace(/[^一-龥A-Za-z0-9]/g, '')]
  if (!chars.length) return 0
  const ttrs = []
  for (let i = 0; i < chars.length; i += TTR_WINDOW) {
    const win = chars.slice(i, i + TTR_WINDOW)
    ttrs.push(new Set(win).size / win.length)
  }
  return mean(ttrs)
}

// —— 内部工具（全部确定性：固定遍历顺序、码元序比较，不用 locale）——

function countChars(s) {
  return [...s.replace(/\s+/g, '')].length
}

function mean(nums) {
  if (!nums.length) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function variance(nums) {
  if (!nums.length) return 0
  const m = mean(nums)
  return nums.reduce((acc, n) => acc + (n - m) * (n - m), 0) / nums.length
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

// 连续中文字符段（标点断开），段内再按专名出现处切断
function cjkRuns(text, names) {
  const raw = text.match(/[一-龥]+/g) || []
  if (!names.length) return raw
  let runs = raw
  for (const name of names) {
    const next = []
    for (const run of runs) {
      if (run.includes(name)) next.push(...run.split(name).filter(Boolean))
      else next.push(run)
    }
    runs = next
  }
  return runs
}

function paragraphDistribution(lengths) {
  const total = lengths.length
  const buckets = { 短: 0, 中: 0, 长: 0, 超长: 0 }
  for (const n of lengths) {
    if (n <= 50) buckets.短++
    else if (n <= 150) buckets.中++
    else if (n <= 300) buckets.长++
    else buckets.超长++
  }
  const dist = {}
  for (const [k, v] of Object.entries(buckets)) {
    dist[k] = { 段数: v, 占比: total ? v / total : 0 }
  }
  return dist
}

// 句首 2 字聚合 top5；跳过句首非中文字符（引号等），人名前缀不算句式开头
function topOpeners(sentences, exclude) {
  const names = [...exclude].filter((n) => typeof n === 'string' && n.length >= 2)
  const counts = new Map()
  let total = 0
  for (const s of sentences) {
    const m = s.match(/^[^一-龥]*([一-龥]{2})/)
    if (!m) continue
    const opener = m[1]
    if (names.some((name) => name.startsWith(opener))) continue
    total++
    counts.set(opener, (counts.get(opener) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
    .slice(0, 5)
    .map(([开头, 次数]) => ({ 开头, 次数, 占比: total ? 次数 / total : 0 }))
}
