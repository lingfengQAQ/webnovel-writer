import { BookConfigReader } from '../storage/adapters/BookConfigReader.js'
import { configuredBaselineRange, readCurrentBaselineFingerprint } from '../health-check/baseline.js'

/**
 * report-style-drift → 当前指纹 vs 基线的差异
 * fingerprints 表由体检填充（M5.5）：基线段 + 最近周期章段各一行。
 * 表为空 → 返回友好中文错误。契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const config = await new BookConfigReader(ctx.repoPath).read()
  if (!config.ok) return { ok: false, error: config.error }
  const baseline = await readCurrentBaselineFingerprint(ctx.cache, config.data)
  const recent = await ctx.cache.query(
    'SELECT * FROM fingerprints WHERE is_baseline = 0 ORDER BY chapter_range_end DESC LIMIT 1'
  )

  if (!baseline || recent.length === 0) {
    return {
      ok: false,
      error: await explainNoDrift(ctx.cache, config.data, baseline),
    }
  }

  const b = baseline
  const r = recent[0]
  const drift = {
    基线章段: [b.chapter_range_start, b.chapter_range_end],
    最近章段: [r.chapter_range_start, r.chapter_range_end],
    avg_sentence_length_delta: (r.avg_sentence_length ?? 0) - (b.avg_sentence_length ?? 0),
    sentence_length_variance_delta:
      (r.sentence_length_variance ?? 0) - (b.sentence_length_variance ?? 0),
    avg_paragraph_length_delta: (r.avg_paragraph_length ?? 0) - (b.avg_paragraph_length ?? 0),
    vocabulary_richness_delta: (r.vocabulary_richness ?? 0) - (b.vocabulary_richness ?? 0),
  }
  return { ok: true, output: JSON.stringify(drift, null, 2) }
}

/**
 * 没有可比数据时说清成因和作者该做什么：区间还没写满时再跑体检也建不出基线，
 * 只有区间已齐却没跑过体检才该去跑体检（错误处理规范 §4.2）。
 */
async function explainNoDrift(cache, config, baseline) {
  const range = configuredBaselineRange(config)
  if (!range) {
    return '文体基线配置无效：book.yaml 的「文体基线起」「文体基线止」都要写正整数，且起不能大于止，改好后再跑一次体检。'
  }
  const 应有 = range.end - range.start + 1
  const 已定稿 = await countFinalized(cache, range)
  if (已定稿 < 应有) {
    return `文体基线尚未建立：配置区间为第 ${range.start}-${range.end} 章，当前只定稿了其中 ${已定稿}/${应有} 章。区间内每章都定稿后跑一次体检才会建立基线，在那之前没有文风漂移可比。`
  }
  if (baseline) {
    return `暂无可比的近段：文体基线（第 ${range.start}-${range.end} 章）已建立，但还没有基线区间之外的定稿章。写过第 ${range.end} 章后再跑一次体检，就能看到漂移。`
  }
  return '缺少指纹数据：fingerprints 表为空或不全，请先运行体检以提取文体特征。'
}

async function countFinalized(cache, range) {
  const rows = await cache.query(
    'SELECT COUNT(*) AS c FROM chapters WHERE chapter_num >= ? AND chapter_num <= ?',
    [range.start, range.end]
  )
  return rows[0]?.c || 0
}
