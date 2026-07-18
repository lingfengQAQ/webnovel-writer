import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { promises as fs } from 'node:fs'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { prepareChapterMaterials } from '../../src/prep/index.js'
import { assembleReviewInput } from '../../src/review/index.js'
import { buildDto } from '../../src/state-machine/dto.js'
import { persistCreateBook } from '../../src/state-machine/persist.js'
import { collectRuntimeFiles } from '../../src/installer/vendor.js'
import { run as knowledgePack } from '../../src/commands/knowledge-pack.js'
import { tempBookCtx } from '../commands/_helper.js'
import { minimalCreateBookPayload } from '../state-machine/_helper.js'

// 真源知识库（v7 包根）——样例条目即夹具
const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')

const 契约 = [
  '---',
  '类型: 玄幻',
  '副题材:',
  '流派:',
  '  - 系统流',
  '创意约束:',
  '  - 系统会说谎',
  '来源版本:',
  '  - 作者自定义',
  '  - 对谈共创',
  '  - 作者自定义',
  '契约版本: 1',
  '生效起章: 1',
  '更新原因: 初始建书',
  '变更类型: 建书',
  '---',
  '## 核心读者承诺',
  '系统信息不可靠，主角必须靠选择与代价逼近真相。',
  '## 骨架约定',
  '- 一卷一层递进',
  '## 题材融合协议',
  '系统流只提供信息差，不替主角完成关键选择。',
  '## 创意约束落地',
  '系统会说谎，但每次谎言都有可回查的前置信号。',
  '## 差异化点',
  '- 系统会说谎',
  '- 主角境界靠偷',
  '- 反派全程知情',
  '## 冲突与关系结算原则',
  '- 主角底线：不牺牲无辜换取系统奖励。',
  '- 伤害后果：造成真实伤害者承担可见责任。',
  '- 和解条件：责任明确且修复行动已经发生。',
  '- 救赎条件：持续付出代价并改变后续选择。',
  '- 允许余地：合理克制、宽恕与关系修复可以成立。',
  '## 本书专属毒点',
  '- 主角不得靠系统白给渡过主线危机',
  '## 节奏与兑现参数',
  '- 首打章数：3',
].join('\n')

const 知识选择 = [
  { 维度: '题材', 名称: '玄幻', 来源: '作者自定义' },
  { 维度: '流派', 名称: '系统流', 来源: '对谈共创' },
  { 维度: '创意约束', 名称: '系统会说谎', 来源: '作者自定义' },
]

const 细纲带声明 = [
  '# 第 3 章细纲',
  '## 全书近况（脚本生成）',
  '- 位置：第 1 卷 2/40 章',
  '## 本章提案',
  '本章定位：推进章。',
  '本章节拍：PA-001 压抑蓄力爆发',
  '章尾钩子：悬念钩',
  '本章场景：拍卖会、自定义梦境回廊',
  '## 本章要写到的事（确认即生效）',
  '- [ ] 林晚查到玉佩的第一条线索',
  '## 备选',
  '（无）',
].join('\n')

test('备料注入：契约常驻 + 声明命中切片 + 自定义声明降级（A2）', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    ctx.packageRoot = packageRoot
    await fs.writeFile(path.join(ctx.repoPath, '作品契约', '作品契约.md'), 契约, 'utf8')
    await fs.writeFile(path.join(ctx.repoPath, '工作区', '细纲.md'), 细纲带声明, 'utf8')
    const r = await prepareChapterMaterials(ctx, { chapterNum: 3 })
    assert.equal(r.ok, true)
    const c = r.content
    assert.match(c, /## 作品契约（本章所需）/)
    assert.match(c, /系统信息不可靠/)
    assert.match(c, /主角不得靠系统白给渡过主线危机/)
    assert.doesNotMatch(c, /恩怨清算档位/)
    // 声明命中：节拍/钩子/场景的「落笔时」节
    assert.match(c, /### 本章节拍：PA-001 压抑蓄力爆发/)
    assert.match(c, /爆发必须改写局面/)
    assert.match(c, /### 章尾钩子：悬念钩/)
    assert.match(c, /### 本章场景：拍卖会/)
    assert.match(c, /竞价过程写节点不写流水/)
    // 自定义声明降级：声明本身即知识
    assert.match(c, /### 本章场景：自定义梦境回廊\n（知识库无此条目，按声明执行）/)
  } finally {
    await cleanup()
  }
})

test('备料阻断：作品契约缺失时不从文风旧路径补造', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    ctx.packageRoot = packageRoot
    await fs.rm(path.join(ctx.repoPath, '作品契约', '作品契约.md'))
    await fs.writeFile(path.join(ctx.repoPath, '文风', '题材流派指导.md'), '旧路径内容。', 'utf8')
    const r = await prepareChapterMaterials(ctx, { chapterNum: 3 })
    assert.equal(r.ok, false)
    assert.match(r.error, /作品契约.*不存在/)
  } finally {
    await cleanup()
  }
})

test('备料降级：无 packageRoot（知识库不可用）零报错（A3）', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    const r = await prepareChapterMaterials(ctx, { chapterNum: 3 })
    assert.equal(r.ok, true)
  } finally {
    await cleanup()
  }
})

test('审稿输入：冻结契约 + 声明命中的审稿切片，不回读当前题材/流派', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    ctx.packageRoot = packageRoot
    await fs.writeFile(path.join(ctx.repoPath, '作品契约', '作品契约.md'), 契约, 'utf8')
    await fs.writeFile(path.join(ctx.repoPath, '工作区', '细纲.md'), 细纲带声明, 'utf8')
    // book.yaml 类型=玄幻（fixture 自带）；流派留空走契约与声明源
    await fs.writeFile(path.join(ctx.repoPath, '工作区', '草稿-A.md'), '---\n标题: 试稿\n---\n正文。', 'utf8')
    const r = await assembleReviewInput(ctx, { chapterNum: 3, draftPath: path.join('工作区', '草稿-A.md') })
    assert.equal(r.ok, true)
    assert.match(r.input.作品契约, /系统信息不可靠/)
    assert.match(r.input.作品契约, /主角不得靠系统白给/)
    assert.ok(r.input.知识审查.some((item) => item.startsWith('【压抑蓄力爆发·核对】')))
    assert.ok(r.input.知识审查.some((item) => item.startsWith('【拍卖会·核对】')))
    assert.equal(r.input.毒点清单, undefined)
  } finally {
    await cleanup()
  }
})

test('审稿输入阻断：契约损坏时不回读当前题材条目', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    ctx.packageRoot = packageRoot
    await fs.writeFile(
      path.join(ctx.repoPath, '作品契约', '作品契约.md'),
      '---\n类型: 玄幻\n---\n坏契约',
      'utf8'
    )
    await fs.writeFile(path.join(ctx.repoPath, '工作区', '草稿-A.md'), '---\n标题: 试稿\n---\n正文。', 'utf8')
    const r = await assembleReviewInput(ctx, { chapterNum: 3, draftPath: path.join('工作区', '草稿-A.md') })
    assert.equal(r.ok, false)
    assert.match(r.error, /作品契约结构不完整/)
  } finally {
    await cleanup()
  }
})

test('序1 DTO：知识路由菜单 + 蒸馏期望产物（A1）', async () => {
  const dto = await buildDto({ repoPath: null, cache: null, packageRoot }, 1)
  assert.ok(dto.知识路由.题材.includes('玄幻'))
  assert.ok(dto.知识路由.流派.includes('退婚流'))
  assert.match(dto.知识材料命令, /knowledge-pack/)
  assert.match(dto.期望产物, /作品契约/)
  assert.match(dto.期望产物, /作者已确认:true/)
})

test('序6 DTO：节拍/钩子/场景索引 + 场景候选（卷纲命中）', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    ctx.packageRoot = packageRoot
    // 卷纲里埋场景关键词 → 候选命中
    await fs.appendFile(path.join(ctx.repoPath, '大纲', '卷纲', '第01卷.md'), '\n中段安排一场拍卖会夺宝。\n', 'utf8')
    const dto = await buildDto(ctx, 6, { nextChapter: 3 })
    assert.ok(dto.节拍索引.some((s) => s.includes('PA-001')))
    assert.ok(dto.钩子清单.some((s) => s.includes('悬念钩')))
    assert.ok(dto.场景索引.some((s) => s.includes('拍卖会')))
    assert.ok(dto.场景候选.some((s) => s.includes('拍卖会')))
    assert.match(dto.期望产物, /本章节拍/)
  } finally {
    await cleanup()
  }
})

test('persist-book：作品契约与选择记录作为必需真源原子落盘', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'wnw-book-create-'))
  try {
    const r = await persistCreateBook(
      { repoPath: tmp },
      minimalCreateBookPayload({
        book: { 书名: '测试书', 流派: ['系统流'] },
        总纲: '总纲',
        卷纲: '卷纲',
        作品契约: 契约,
        知识选择,
      })
    )
    assert.equal(r.ok, true, r.error)
    const saved = await fs.readFile(path.join(tmp, '作品契约', '作品契约.md'), 'utf8')
    assert.match(saved, /系统会说谎/)
    const record = await fs.readFile(path.join(tmp, '作品契约', '知识选择记录.md'), 'utf8')
    assert.match(record, /流派：系统流/)
    await assert.rejects(() => fs.access(path.join(tmp, '文风', '题材流派指导.md')))
    const yaml = await fs.readFile(path.join(tmp, 'book.yaml'), 'utf8')
    assert.match(yaml, /流派:\n {2}- 系统流/)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('knowledge-pack 命令：归一 + 材料 + 未命中如实（A1 未命中降级）', async () => {
  const r = await knowledgePack([], { 类型: '修仙', 流派: '系统,自创门派流' }, { packageRoot })
  assert.equal(r.ok, true)
  assert.match(r.output, /归一结果：类型=仙侠；流派=系统流/)
  assert.match(r.output, /知识库未命中：自创门派流/)
  assert.match(r.output, /对谈共创/)
  const bad = await knowledgePack([], {}, { packageRoot })
  assert.equal(bad.ok, false)
})

test('installer vendoring 含 references（A4，目录结构规范 4.3）', async () => {
  const files = await collectRuntimeFiles(packageRoot)
  assert.ok(files['.webnovel/references/路由.csv'])
  assert.ok(files['.webnovel/references/节拍/PA-001-压抑蓄力爆发.md'])
})

test('知识库整体缺失时序1/序6 DTO 零报错（A3）', async () => {
  const empty = await mkdtemp(path.join(os.tmpdir(), 'wnw-noref2-'))
  try {
    const dto1 = await buildDto({ repoPath: null, cache: null, packageRoot: empty }, 1)
    assert.deepEqual(dto1.知识路由, { 题材: [], 流派: [] })
    const { ctx, cleanup } = await tempBookCtx()
    try {
      ctx.packageRoot = empty
      const dto6 = await buildDto(ctx, 6, { nextChapter: 3 })
      assert.equal(dto6.state, 'draft-outline')
      assert.ok(!dto6.节拍索引)
    } finally {
      await cleanup()
    }
  } finally {
    await rm(empty, { recursive: true, force: true })
  }
})
