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

// 真源知识库（v7 包根）——样例条目即夹具
const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')

const 契约 = [
  '---',
  '题材: 玄幻',
  '流派:',
  '  - 系统流',
  '恩怨清算: 有仇必报',
  '来源:',
  '  - 题材/玄幻.md@abc123',
  '---',
  '## 骨架约定',
  '- 一卷一层递进',
  '## 差异化点',
  '- 系统会说谎',
  '- 主角境界靠偷',
  '- 反派全程知情',
  '## 本书专属毒点',
  '- 主角不得靠系统白给渡过主线危机',
  '## 节奏参数',
  '- 首打章数：3',
].join('\n')

const 细纲带声明 = [
  '# 第 3 章细纲',
  '## 全书近况（脚本生成）',
  '- 位置：第 1 卷 2/40 章',
  '## 本章提案',
  '本章定位：推进章。',
  '本章节拍：PA-001 压抑蓄力爆发',
  '章尾钩子：悬念钩',
  '本章场景：拍卖会、自定义小巷伏击',
  '## 本章要写到的事（确认即生效）',
  '- [ ] 林晚查到玉佩的第一条线索',
  '## 备选',
  '（无）',
].join('\n')

test('备料注入：契约常驻 + 声明命中切片 + 自定义声明降级（A2）', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    ctx.packageRoot = packageRoot
    await fs.writeFile(path.join(ctx.repoPath, '文风', '题材流派指导.md'), 契约, 'utf8')
    await fs.writeFile(path.join(ctx.repoPath, '工作区', '细纲.md'), 细纲带声明, 'utf8')
    const r = await prepareChapterMaterials(ctx, { chapterNum: 3 })
    assert.equal(r.ok, true)
    const c = r.content
    // 契约常驻锚点（替代文风铁律反和解）
    assert.match(c, /## 题材流派契约（本书写作契约）/)
    assert.match(c, /恩怨清算档位：有仇必报/)
    assert.match(c, /主角不得靠系统白给渡过主线危机/)
    // 声明命中：节拍/钩子/场景的「落笔时」节
    assert.match(c, /### 本章节拍：PA-001 压抑蓄力爆发/)
    assert.match(c, /爆发必须改写局面/)
    assert.match(c, /### 章尾钩子：悬念钩/)
    assert.match(c, /### 本章场景：拍卖会/)
    assert.match(c, /竞价过程写节点不写流水/)
    // 自定义声明降级：声明本身即知识
    assert.match(c, /### 本章场景：自定义小巷伏击\n（知识库无此条目，按声明执行）/)
  } finally {
    await cleanup()
  }
})

test('备料降级：无契约无声明的旧书照常，走文风铁律反和解沿用（A3）', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    ctx.packageRoot = packageRoot
    const r = await prepareChapterMaterials(ctx, { chapterNum: 3 })
    assert.equal(r.ok, true)
    assert.match(r.content, /## 恩怨清算规则/)
    assert.ok(!r.content.includes('本章知识切片'))
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

test('审稿输入毒点清单：契约 + 题材/流派 + 声明命中条目（A2）', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    ctx.packageRoot = packageRoot
    await fs.writeFile(path.join(ctx.repoPath, '文风', '题材流派指导.md'), 契约, 'utf8')
    await fs.writeFile(path.join(ctx.repoPath, '工作区', '细纲.md'), 细纲带声明, 'utf8')
    // book.yaml 类型=玄幻（fixture 自带）；流派留空走契约与声明源
    await fs.writeFile(path.join(ctx.repoPath, '工作区', '草稿-A.md'), '---\n标题: 试稿\n---\n正文。', 'utf8')
    const r = await assembleReviewInput(ctx, { chapterNum: 3, draftPath: path.join('工作区', '草稿-A.md') })
    assert.equal(r.ok, true)
    const 毒点 = r.input.毒点清单
    assert.ok(Array.isArray(毒点) && 毒点.length > 0)
    assert.ok(毒点.some((p) => p.includes('恩怨清算档位：有仇必报')))
    assert.ok(毒点.some((p) => p.startsWith('【契约】主角不得靠系统白给')))
    assert.ok(毒点.some((p) => p.startsWith('【玄幻】')))
    assert.ok(毒点.some((p) => p.startsWith('【压抑蓄力爆发】')))
    assert.ok(毒点.some((p) => p.startsWith('【拍卖会】')))
  } finally {
    await cleanup()
  }
})

test('审稿输入降级：无契约无声明 → 毒点清单只剩题材源或为空，零报错（A3）', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    ctx.packageRoot = packageRoot
    await fs.writeFile(path.join(ctx.repoPath, '工作区', '草稿-A.md'), '---\n标题: 试稿\n---\n正文。', 'utf8')
    const r = await assembleReviewInput(ctx, { chapterNum: 3, draftPath: path.join('工作区', '草稿-A.md') })
    assert.equal(r.ok, true)
    assert.ok(Array.isArray(r.input.毒点清单))
    assert.ok(r.input.毒点清单.every((p) => !p.startsWith('【契约】')))
  } finally {
    await cleanup()
  }
})

test('序1 DTO：知识路由菜单 + 蒸馏期望产物（A1）', async () => {
  const dto = await buildDto({ repoPath: null, cache: null, packageRoot }, 1)
  assert.ok(dto.知识路由.题材.includes('玄幻'))
  assert.ok(dto.知识路由.流派.includes('退婚流'))
  assert.match(dto.知识材料命令, /knowledge-pack/)
  assert.match(dto.期望产物, /题材流派指导/)
  assert.match(dto.期望产物, /差异化点≥3/)
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

test('persist-book 契约落盘：题材流派指导 → 文风/题材流派指导.md；缺省不写（A1）', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'wnw-book-create-'))
  try {
    const r = await persistCreateBook(
      { repoPath: tmp },
      { book: { 书名: '测试书', 类型: '玄幻', 流派: ['系统流'] }, 总纲: '总纲', 卷纲: '卷纲', 题材流派指导: 契约 }
    )
    assert.equal(r.ok, true)
    const saved = await fs.readFile(path.join(tmp, '文风', '题材流派指导.md'), 'utf8')
    assert.match(saved, /恩怨清算: 有仇必报/)
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
