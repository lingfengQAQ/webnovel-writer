import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { stageChapter } from '../../src/staging/index.js'
import { prepareChapterMaterials } from '../../src/prep/index.js'
import { assembleReviewInput } from '../../src/review/index.js'
import { mechanicalCheck } from '../../src/mechanical-check/index.js'
import { repoCtx } from '../commands/_helper.js'
import { writeReviewArtifacts } from './_helper.js'
import { minimalWorkContract } from '../state-machine/_helper.js'

// —— AC2 批内依赖：第 3 章预登记（新条目/新角色/时间线/信息差）→ 第 4 章备料/审稿输入/机检可见 ——

const 定稿章 = (num) =>
  `---\n章号: ${num}\n标题: 第${num}章\n卷: 1\n视角: 林晚\n书内时间: 春月初${num}\n字数: 100\n章定位: 推进\n钩子: 危机钩-强\n情绪定位: 铺垫\n---\n\n林晚在第${num}章遇到了新的麻烦，她收剑而立。`

const 角色卡 = `---\n姓名: 林晚\n别名:\n  - 晚晚\n状态: 在世\n位置: 青云宗\n境界: 练气三层\n最后变更章: 1\n---\n## 设定\n外门弟子。\n\n## 典型对话\n"本姑娘才不怕！"\n\n## 关系\n无。\n`

const bookFiles = () => ({
  'book.yaml':
    'spec_version: "7.0"\n书名: 叠加测试\n类型: 玄幻\n每章目标字数: 3000\n卷规模: 40\n连写批次大小: 8\n',
  '作品契约/作品契约.md': minimalWorkContract(),
  '作品契约/知识选择记录.md': '# 知识选择记录\n',
  '定稿/正文/0001-第1章.md': 定稿章(1),
  '定稿/正文/0002-第2章.md': 定稿章(2),
  '定稿/设定/名册.md': '| 正名 | 别名 | 类型 | 首现章 |\n|--|--|--|--|\n| 林晚 | 晚晚 | character | 1 |\n',
  '定稿/设定/角色/林晚.md': 角色卡,
  '定稿/设定/时间线/第01卷.md':
    '| 章 | 书内时间 | 一句话事件 | 在场 |\n|----|----|----|----|\n| 1 | 春月初一 | 遇袭 | 林晚 |\n| 2 | 春月初二 | 追查 | 林晚 |\n',
  '大纲/卷纲/第01卷.md': '# 第01卷\n追查古钟之谜。\n',
  '大纲/伏笔/伏笔-001-旧案.md': '---\n强度: 高\n状态: 进行\n开启章: 1\n最后推进章: 2\n---\n## 描述\n旧案。\n\n## 履历\n- 第1章：埋下\n',
})

async function stageChapter3(ctx) {
  const payload = {
    frontMatter: {
      章号: 3,
      标题: '闻钟',
      卷: 1,
      视角: '林晚',
      书内时间: '春月初三',
      字数: 120,
      章定位: '推进',
      钩子: '悬念钩-强',
      情绪定位: '铺垫',
      伏笔: ['埋下 伏笔-009', '推进 伏笔-001'],
    },
    body: '林晚夜里听见后山钟声，古钟长老现身拦路。她记下了钟声的方位，决定天亮再探。',
    summary: '林晚闻钟遇古钟长老。',
    threadCreates: [
      {
        id: '伏笔-009',
        短题: '古钟',
        frontMatter: { 强度: '中', 状态: '进行', 开启章: 3, 最后推进章: 3 },
        body: '## 描述\n古钟的来历。\n\n## 履历\n- 第3章：埋下\n',
      },
    ],
    threadUpdates: [{ id: '伏笔-001', updates: { 最后推进章: 3 }, history: '第3章：推进' }],
    rosterUpserts: [{ 正名: '古钟长老', 别名: '钟叟', 类型: 'character', 首现章: 3 }],
    characterUpdates: [{ name: '林晚', updates: { 最后变更章: 3, 境界: '练气四层' } }],
    timelineRows: [
      { volumeNum: 1, row: { 章: 3, 书内时间: '春月初三', 一句话事件: '闻钟遇长老', 在场: '林晚' } },
    ],
    secretWrites: [
      {
        id: '信息差-002-钟声',
        frontMatter: { 读者已知: false, 登记章: 3, 短题: '钟声有古怪', 知情人: ['古钟长老'], 关键词: ['古钟'] },
        content: '## 内容\n钟声是封印松动的征兆。\n',
      },
    ],
    commitLines: {},
    workspaceFiles: [],
  }
  await writeReviewArtifacts(ctx.repoPath, 3, [], [], payload)
  const r = await stageChapter(ctx, { chapterNum: 3, payload })
  assert.equal(r.ok, true, r.error)
}

test('AC2 备料叠加：第 4 章材料含批内近况/结尾/时间线/信息差', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles())
  try {
    await stageChapter3(ctx)
    const r = await prepareChapterMaterials(ctx, { chapterNum: 4 })
    assert.equal(r.ok, true, r.error)
    assert.match(r.content, /批内已暂存：第 3-3 章共 1 章/)
    assert.match(r.content, /### 第3章结尾（批内暂存）\n[\s\S]*天亮再探/)
    assert.match(r.content, /### 第2章结尾/) // 不足两章回定稿补
    assert.match(r.content, /- 3 闻钟遇长老（批内预登记）/)
    assert.match(r.content, /- 信息差-002-钟声（批内预登记）：知情人=古钟长老；关键词=古钟；内容：钟声是封印松动的征兆。/)
  } finally {
    await cleanup()
  }
})

test('AC2 审稿输入叠加：第 4 章相关条目/名册/角色/时间线/信息差看到第 3 章预登记', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles())
  try {
    await stageChapter3(ctx)
    const draftPath = path.join(ctx.repoPath, '工作区', '草稿-A.md')
    await fs.writeFile(
      draftPath,
      '---\n章号: 4\n标题: 探钟\n卷: 1\n字数: 60\n章定位: 推进\n钩子: 危机钩-强\n情绪定位: 铺垫\n伏笔:\n  - 推进 伏笔-009\n---\n林晚天亮后去探古钟，山道上又见古钟长老。',
      'utf8'
    )
    const r = await assembleReviewInput(ctx, { chapterNum: 4, draftPath })
    assert.equal(r.ok, true, r.error)
    const t = r.input.相关条目.find((x) => x.id === '伏笔-009')
    assert.ok(t, JSON.stringify(r.input.相关条目))
    assert.equal(t.批内预登记, true)
    assert.equal(t.开启章, 3)
    const old = r.input.相关条目.find((x) => x.id === '伏笔-001')
    assert.equal(old.最后推进章, 3, '批内推进要刷进相关条目')
    assert.ok(r.input.名册.some((x) => x.正名 === '古钟长老' && x.别名.includes('钟叟')))
    const 林晚 = r.input.相关角色.find((x) => x.正名 === '林晚')
    assert.ok(林晚, '草稿提到林晚应命中角色')
    assert.equal(林晚.境界, '练气四层', '批内角色变更要叠加')
    assert.ok(r.input.时间线片段.some((x) => String(x.事件).includes('批内预登记')))
    assert.ok(r.input.信息差候选.some((x) => x.id === '信息差-002-钟声'))
    assert.match(r.input.全书近况, /批内已暂存/)
  } finally {
    await cleanup()
  }
})

test('重审受影响章不倒灌：第 3 章自己的审稿输入看不到第 3 章预登记', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles())
  try {
    await stageChapter3(ctx)
    const draftPath = path.join(ctx.repoPath, '工作区', '草稿-A.md')
    await fs.writeFile(
      draftPath,
      '---\n章号: 3\n标题: 闻钟\n卷: 1\n字数: 40\n章定位: 推进\n钩子: 悬念钩-强\n情绪定位: 铺垫\n---\n林晚夜里听见后山钟声。',
      'utf8'
    )
    const r = await assembleReviewInput(ctx, { chapterNum: 3, draftPath })
    assert.equal(r.ok, true, r.error)
    assert.ok(!r.input.相关条目.some((x) => x.id === '伏笔-009'))
    assert.ok(!r.input.名册.some((x) => x.正名 === '古钟长老'))
    assert.doesNotMatch(r.input.全书近况, /批内已暂存/)
  } finally {
    await cleanup()
  }
})

test('AC2 机检叠加：推进批内新条目零误报、批内新角色不报新专名、批内信息差出候选', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles())
  try {
    await stageChapter3(ctx)
    const draftPath = path.join(ctx.repoPath, '工作区', '草稿-B.md')
    await fs.writeFile(
      draftPath,
      '---\n章号: 4\n标题: 探钟\n卷: 1\n字数: 3000\n章定位: 推进\n钩子: 危机钩-强\n情绪定位: 铺垫\n伏笔:\n  - 推进 伏笔-009\n---\n' +
        '古钟长老道：“你不该来。”林晚握紧短刀盯着古钟出神，山风吹动她的衣角。'.repeat(1) +
        '她沿着山道慢慢往上走，一步一步踩着碎石，心里盘算着夜里听到的那阵钟声到底从哪里来。'.repeat(1),
      'utf8'
    )
    const r = await mechanicalCheck(ctx, { chapterNum: 4, draftPath })
    assert.equal(r.ok, true, r.error)
    assert.deepEqual(
      r.issues.filter((i) => i.check === '条目变动'),
      [],
      JSON.stringify(r.issues)
    )
    assert.ok(!r.candidates.some((c) => c.type === '新专名' && c.value === '古钟长老'), JSON.stringify(r.candidates))
    assert.ok(r.candidates.some((c) => c.type === '信息差候选' && c.value === '信息差-002-钟声'), JSON.stringify(r.candidates))
  } finally {
    await cleanup()
  }
})

test('AC7 缓存不变量：批次进行中删缓存全量重建，备料输出不变', async () => {
  const { ctx, cleanup } = await repoCtx(null, bookFiles())
  try {
    await stageChapter3(ctx)
    const before = await prepareChapterMaterials(ctx, { chapterNum: 4 })
    assert.equal(before.ok, true, before.error)
    const rb = await ctx.cache.rebuildFromSource(ctx.repoPath)
    assert.equal(rb.ok, true, rb.errors?.join('；'))
    const after = await prepareChapterMaterials(ctx, { chapterNum: 4 })
    assert.equal(after.ok, true, after.error)
    assert.equal(after.content, before.content)
  } finally {
    await cleanup()
  }
})
