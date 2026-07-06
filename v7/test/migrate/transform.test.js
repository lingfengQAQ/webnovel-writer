import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readV6Project } from '../../src/migrate/read-v6.js'
import { transformV6 } from '../../src/migrate/transform.js'
import { parseFrontMatter } from '../../src/storage/parsers/front-matter.js'
import { tempV6, tempV6Sqlite, inlineFixture } from './_v6.js'

function fileOf(plan, p) {
  const f = plan.files.find((x) => x.path === p)
  assert.ok(f, `缺文件 ${p}；实有：\n${plan.files.map((x) => x.path).join('\n')}`)
  return f.content
}

async function inlinePlan() {
  const { v6Path, cleanup } = await tempV6(inlineFixture)
  try {
    const r = await readV6Project(v6Path)
    assert.equal(r.ok, true, r.error)
    return transformV6(r.facts)
  } finally {
    await cleanup()
  }
}

test('inline → 正文补 front matter：迁移标记、钩子映射、卷号推断、标题兜底', async () => {
  const plan = await inlinePlan()

  const ch1 = parseFrontMatter(fileOf(plan, '定稿/正文/0001-残剑出鞘.md'))
  assert.equal(ch1.ok, true, ch1.error)
  assert.equal(ch1.data.章号, 1)
  assert.equal(ch1.data.卷, 1)
  assert.equal(ch1.data.章定位, '迁移')
  assert.equal(ch1.data.钩子, '危机钩-强') // chapter_meta strong→强
  assert.deepEqual(ch1.data.本章要写到的事, ['迁移'])
  assert.ok(ch1.data.字数 > 0)
  assert.equal(ch1.data.书内时间, undefined) // 无源省略，不编造
  assert.match(ch1.body, /晨雾未散/)

  const ch2 = parseFrontMatter(fileOf(plan, '定稿/正文/0002-第2章.md'))
  assert.equal(ch2.data.标题, '第2章') // 遗留无标题兜底
  assert.equal(ch2.data.钩子, undefined) // 无 hook 数据省略

  const ch3 = parseFrontMatter(fileOf(plan, '定稿/正文/0003-剑灵初醒.md'))
  assert.equal(ch3.data.钩子, '悬念钩-中')
})

test('inline → 伏笔条目/名册/角色卡/时间线/摘要/卷纲', async () => {
  const plan = await inlinePlan()

  const fb1 = parseFrontMatter(fileOf(plan, '大纲/伏笔/伏笔-001-残剑剑柄内藏半张古.md'))
  assert.equal(fb1.data.状态, '进行')
  assert.equal(fb1.data.强度, '高') // core→核心→高
  assert.equal(fb1.data.开启章, 1)
  assert.equal(fb1.data.预计收尾, '第30章')
  assert.match(fb1.body, /## 描述\n残剑剑柄内藏半张古图/)
  assert.match(fb1.body, /## 履历\n- 第1章：埋下（迁移）/)

  const fb2 = parseFrontMatter(fileOf(plan, '大纲/伏笔/伏笔-002-苏素识破陆沉伪装的.md'))
  assert.equal(fb2.data.状态, '已收尾')
  assert.equal(fb2.data.最后推进章, 3)

  const roster = fileOf(plan, '定稿/设定/名册.md')
  assert.match(roster, /\| 陆沉 \| 小师弟 \| 角色 \| 1 \|/)
  assert.match(roster, /\| 青云宗 \| 宗门 \| 势力 \| 1 \|/)

  const card = fileOf(plan, '定稿/设定/角色/陆沉.md')
  const cardFm = parseFrontMatter(card)
  assert.equal(cardFm.data.姓名, '陆沉')
  assert.match(card, /## 设定\n/)
  assert.match(card, /背负残剑的外门弟子/)
  assert.match(card, /## 关系\n[\s\S]*师姐弟/)

  const tl = fileOf(plan, '定稿/设定/时间线/第01卷.md')
  assert.match(tl, /\| 章 \| 书内时间 \| 一句话事件 \| 在场 \|/)
  assert.match(tl, /\| 1 \| 春末清晨 \| 演武场盘问，残剑现世 \|/)

  assert.match(fileOf(plan, '定稿/摘要/章摘要/0001.md'), /^陆沉携残剑入演武场/)

  const vol = fileOf(plan, '大纲/卷纲/第01卷.md')
  assert.match(vol, /第3章：剑灵初醒/)
  assert.match(vol, /## 迁移的剧情线\n[\s\S]*外门大比/)

  assert.match(fileOf(plan, '大纲/总纲.md'), /剑碎虚空 总纲/)
})

test('inline → book.yaml、待校对三件、报告', async () => {
  const plan = await inlinePlan()

  assert.equal(plan.bookName, '剑碎虚空')
  const yaml = fileOf(plan, 'book.yaml')
  assert.match(yaml, /书名: 剑碎虚空/)
  assert.match(yaml, /类型: 仙侠/) // xianxia 码表映射

  const mem = fileOf(plan, '定稿/设定/迁移待校对-记忆清单.md')
  assert.match(mem, /## open_loops[\s\S]*三长老着人盯梢/)
  assert.match(mem, /## story_facts[\s\S]*陆家灭门夜唯一遗物/)

  assert.match(fileOf(plan, '文风/迁移待校对-文风候选.md'), /战斗段落短句连用/)
  assert.match(fileOf(plan, '定稿/设定/迁移待校对-实体变更史.md'), /剑灵反哺/)

  assert.equal(plan.report.counts.章数, 3)
  assert.equal(plan.report.counts.伏笔, 2)
  assert.equal(plan.report.counts.角色卡, 2)
  assert.ok(plan.report.待校对.length >= 3)
})

test('sqlite → db 实体/摘要/追读力进产物；genre 未知码原样并提示', async () => {
  const { v6Path, cleanup } = await tempV6Sqlite()
  try {
    const r = await readV6Project(v6Path)
    assert.equal(r.ok, true, r.error)
    const plan = transformV6(r.facts)

    assert.match(fileOf(plan, 'book.yaml'), /类型: 都市/) // urban 码表

    const ch1 = parseFrontMatter(fileOf(plan, '定稿/正文/0001-退潮.md'))
    assert.equal(ch1.data.钩子, '悬念钩-强') // readingPower 兜底

    assert.match(fileOf(plan, '定稿/摘要/章摘要/0001.md'), /退潮滩涂拾得停摆怀表/) // db summary 兜底
    assert.match(fileOf(plan, '定稿/设定/角色/江遥.md'), /滨海市海事记者/)
    const roster = fileOf(plan, '定稿/设定/名册.md')
    assert.match(roster, /\| 江遥 \| 小江 \| 角色 \| 1 \|/)
    assert.match(roster, /\| 滨海市 \|  \| 地点 \| 1 \|/)
  } finally {
    await cleanup()
  }
})

// —— 批 2 回归：R9 / R10 / F-4（transformV6 纯函数，用最小 facts 直测）——
import { parseBookConfig } from '../../src/storage/parsers/book-config.js'

function minimalFacts(over = {}) {
  return {
    project: { title: '测', genre: '玄幻' },
    chapters: [], summaries: new Map(), dbSummaries: new Map(),
    foreshadowing: [], entities: [], relationships: [],
    protagonistState: {}, outlines: { master: '', volumes: [] },
    settingFiles: [], scratchpad: {}, patterns: [], stateChanges: [],
    chaseDebtCount: 0, warnings: [], activeThreads: [],
    readingPower: new Map(), chapterMeta: new Map(), form: 'inline',
    ...over,
  }
}

test('R9：危险书名走防呆序列化器——[ * 起首与纯数字书名都能读回', () => {
  for (const title of ['[快穿]反派', '*追读', '"引号"书', '- 开局', '12345', 'true']) {
    const plan = transformV6(minimalFacts({ project: { title, genre: '玄幻' } }))
    const cfg = parseBookConfig(fileOf(plan, 'book.yaml'))
    assert.equal(cfg.ok, true, `书名「${title}」的 book.yaml 解析失败：${cfg.error}`)
    assert.equal(cfg.data.书名, title, `书名「${title}」往返漂移成 ${JSON.stringify(cfg.data.书名)}`)
  }
})

test('R10：一对多别名降级——首实体保留、其余剥离进待校对，迁移不再硬失败', () => {
  const plan = transformV6(minimalFacts({
    entities: [
      { id: 'a', name: '张三', type: '角色', aliases: ['小明', '老张'], current: {}, firstAppearance: 1 },
      { id: 'b', name: '李四', type: '角色', aliases: ['小明'], current: {}, firstAppearance: 2 },
    ],
  }))
  const roster = fileOf(plan, '定稿/设定/名册.md')
  assert.match(roster, /\| 张三 \| 小明, 老张 \| 角色 \| 1 \|/)
  assert.match(roster, /\| 李四 \|  \| 角色 \| 2 \|/)
  const 歧义 = fileOf(plan, '定稿/设定/迁移待校对-别名歧义.md')
  assert.match(歧义, /「小明」保留给【张三】，已从【李四】剥离/)
  assert.ok(plan.report.待校对.some((s) => s.includes('别名歧义')), JSON.stringify(plan.report.待校对))
})

test('R10：同实体重复别名静默去重，不进歧义清单', () => {
  const plan = transformV6(minimalFacts({
    entities: [{ id: 'a', name: '张三', type: '角色', aliases: ['小明', '小明'], current: {}, firstAppearance: 1 }],
  }))
  const roster = fileOf(plan, '定稿/设定/名册.md')
  assert.match(roster, /\| 张三 \| 小明 \| 角色 \| 1 \|/)
  assert.ok(!plan.files.some((f) => f.path.includes('别名歧义')))
})

test('F-4：伏笔短题按码点截断，文件名不含半个代理对', () => {
  const plan = transformV6(minimalFacts({
    foreshadowing: [{ content: '💠🀄𝌆一二三四五六七八九十', tier: '核心', status: '未回收', plantedChapter: 1 }],
  }))
  const fb = plan.files.find((f) => f.path.startsWith('大纲/伏笔/伏笔-001'))
  assert.ok(fb, '伏笔文件应存在')
  const lone = fb.path.match(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
  assert.equal(lone, null, `文件名含孤代理：${JSON.stringify(fb.path)}`)
})
