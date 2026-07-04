import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  splitSentences,
  splitParagraphs,
  styleMetrics,
  extractImagery,
  extractFingerprint,
  windowTTR,
} from '../../src/style-stats/index.js'

// —— 分句 / 分段 ——

test('分句 引号收尾/省略号/分号都断句，闭引号收编进句尾', () => {
  const r = splitSentences('「站住！」林晚喝道。她愣住……随即冷笑；转身便走。')
  assert.deepEqual(r, ['「站住', '林晚喝道', '她愣住', '随即冷笑', '转身便走'])
})

test('分句 空文本与无终结标点', () => {
  assert.deepEqual(splitSentences(''), [])
  assert.deepEqual(splitSentences(null), [])
  assert.deepEqual(splitSentences('还没写完的半句'), ['还没写完的半句'])
})

test('分段 换行断段，连续空行不产生空段', () => {
  assert.deepEqual(splitParagraphs('第一段\n\n\n第二段\n第三段'), ['第一段', '第二段', '第三段'])
  assert.deepEqual(splitParagraphs(''), [])
})

// —— 句式指标（小样本手算对照）——

test('句式指标 均值方差手算对照：句长 [3,5,7] → 均 5 方差 8/3', () => {
  const m = styleMetrics('一二三。一二三四五。一二三四五六七。')
  assert.equal(m.句数, 3)
  assert.equal(m.平均句长, 5)
  assert.ok(Math.abs(m.句长方差 - 8 / 3) < 1e-12)
})

test('句式指标 段落数/平均段长/段落分布', () => {
  const m = styleMetrics('第一段有六字\n\n短段\n第三段落有七个字')
  assert.equal(m.段落数, 3)
  assert.ok(Math.abs(m.平均段长 - 16 / 3) < 1e-12)
  assert.equal(m.段落分布.短.段数, 3)
  assert.equal(m.段落分布.短.占比, 1)
  assert.equal(m.段落分布.超长.段数, 0)
})

test('句式指标 高频开头：人名前缀排除、句首引号跳过', () => {
  const m = styleMetrics('林晚冷笑。林晚转身。今日无事。今日有雨。“今日大吉。”', new Set(['林晚']))
  assert.deepEqual(m.高频开头, [{ 开头: '今日', 次数: 3, 占比: 1 }])
})

test('句式指标 空文本不炸，全零', () => {
  const m = styleMetrics('')
  assert.equal(m.句数, 0)
  assert.equal(m.平均句长, 0)
  assert.equal(m.句长方差, 0)
  assert.deepEqual(m.高频开头, [])
})

// —— 跨章高频意象 ——

const imageryChapters = (n1, n2, n3, unit = '空气仿佛凝固，') => [
  { num: 1, text: unit.repeat(n1) },
  { num: 2, text: unit.repeat(n2) },
  { num: 3, text: unit.repeat(n3) },
]

test('意象 阈值边界：全书 10 次报、9 次不报', () => {
  const hit = extractImagery(imageryChapters(4, 3, 3))
  assert.deepEqual(hit, [
    { phrase: '空气仿佛凝固', count: 10, chapterCount: 3, firstChapter: 1, lastChapter: 3 },
  ])
  assert.deepEqual(extractImagery(imageryChapters(3, 3, 3)), [])
})

test('意象 跨章条件：12 次但只出现在 2 章 → 不出', () => {
  const chapters = [
    { num: 1, text: '空气仿佛凝固，'.repeat(6) },
    { num: 2, text: '空气仿佛凝固，'.repeat(6) },
    { num: 3, text: '风平浪静。' },
  ]
  assert.deepEqual(extractImagery(chapters), [])
})

test('意象 专名排除：含「林晚」的短语与跨名碎片都不出', () => {
  const r = extractImagery(imageryChapters(4, 4, 4, '林晚冷笑一声，'), new Set(['林晚']))
  assert.ok(!r.some((x) => x.phrase.includes('林晚')), JSON.stringify(r))
  assert.ok(!r.some((x) => x.phrase.includes('晚冷')), JSON.stringify(r))
  // 名字切掉后剩余的通用搭配仍计数（12 次跨 3 章）
  assert.deepEqual(r.map((x) => x.phrase), ['冷笑一声'])
})

test('意象 最长优先去重：子串被父串覆盖，次数超父串 1.25 倍则独立保留', () => {
  const chapters = [
    { num: 1, text: '空气仿佛凝固，'.repeat(4) + '水面仿佛凝固，' },
    { num: 2, text: '空气仿佛凝固，'.repeat(3) + '水面仿佛凝固，' },
    { num: 3, text: '空气仿佛凝固，'.repeat(3) + '水面仿佛凝固，' },
  ]
  const r = extractImagery(chapters)
  // 仿佛凝固 13 次 > 10×1.25，突破父串覆盖独立成条；其余子串全被 空气仿佛凝固 覆盖
  assert.deepEqual(
    r.map((x) => ({ phrase: x.phrase, count: x.count })),
    [
      { phrase: '仿佛凝固', count: 13 },
      { phrase: '空气仿佛凝固', count: 10 },
    ]
  )
})

// —— 词汇丰富度（滑动窗口 TTR）——

test('TTR 窗口平均与朴素 TTR 用长短两文本区分', () => {
  const base = '一二三四五六七八九十'.repeat(100) // 恰一个 1000 字窗
  assert.ok(Math.abs(windowTTR(base) - 0.01) < 1e-12)
  const longer = base + '百千万亿' // 第二窗 4 字全异 → TTR 1.0
  assert.ok(Math.abs(windowTTR(longer) - 0.505) < 1e-12)
  const naive = new Set([...longer]).size / longer.length
  assert.ok(naive < 0.02, '朴素 TTR 被文本长度压扁，窗口平均不受影响')
})

test('TTR 剥标点空白；空文本为 0', () => {
  assert.equal(windowTTR('一，二。三！\n'), 1)
  assert.equal(windowTTR(''), 0)
  assert.equal(windowTTR('……！！'), 0)
})

// —— 指纹 ——

test('指纹 五常用列 + fingerprint_data 完整对象；章段内短语条件放宽为 ≥1 章', () => {
  const chapters = [{ num: 1, text: '空气仿佛凝固。'.repeat(10) }]
  const fp = extractFingerprint(chapters)
  assert.equal(fp.avg_sentence_length, 6)
  assert.equal(fp.sentence_length_variance, 0)
  assert.equal(fp.common_phrase_frequency['空气仿佛凝固'], 10)
  assert.ok(fp.vocabulary_richness > 0)
  assert.equal(fp.fingerprint_data.章数, 1)
  assert.equal(fp.fingerprint_data.总字数, 70)
  assert.ok(fp.fingerprint_data.段落分布)
  assert.ok(Array.isArray(fp.fingerprint_data.高频开头))
})

// —— 确定性（AC3 的根基）——

test('确定性 同输入两次调用结果深等', () => {
  const chapters = [
    { num: 1, text: '空气仿佛凝固，'.repeat(4) + '林晚冷笑一声。水面仿佛凝固。' },
    { num: 2, text: '空气仿佛凝固，'.repeat(3) + '林晚转身离去。水面仿佛凝固。' },
    { num: 3, text: '空气仿佛凝固，'.repeat(3) + '今日无事发生。水面仿佛凝固。' },
  ]
  const ex = new Set(['林晚', '晚晚'])
  assert.deepStrictEqual(extractImagery(chapters, ex), extractImagery(chapters, ex))
  assert.deepStrictEqual(extractFingerprint(chapters, ex), extractFingerprint(chapters, ex))
  assert.deepStrictEqual(styleMetrics(chapters[0].text, ex), styleMetrics(chapters[0].text, ex))
})
