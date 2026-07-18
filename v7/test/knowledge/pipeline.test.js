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
import { stageChapter } from '../../src/staging/index.js'
import { writeReviewArtifacts } from '../staging/_helper.js'

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
  '本章场景：拍卖会、自定义梦境回廊',
  '本章技法：限制视角误导',
  '本章追读：悬念钩',
  '知识变体：拍卖会只写会后余波，不写逐口竞价',
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
    // 声明命中：四维选择只注入各自的「落笔时」节
    assert.match(c, /### 本章节拍：PA-001 压抑蓄力爆发/)
    assert.match(c, /爆发必须改写局面/)
    assert.match(c, /### 本章场景：拍卖会/)
    assert.match(c, /竞价过程写节点不写流水/)
    assert.match(c, /### 本章追读：悬念钩/)
    // 自定义声明降级：声明本身即知识
    assert.match(c, /### 本章场景：自定义梦境回廊\n（自定义选择，按细纲声明执行）/)
    assert.match(c, /### 本章技法：限制视角误导\n（自定义选择，按细纲声明执行）/)
    assert.match(c, /### 知识变体\n- 拍卖会只写会后余波，不写逐口竞价/)
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
    assert.ok(r.input.知识审查.some((item) => item.includes('【技法·自定义】')))
    assert.ok(r.input.知识审查.some((item) => item.includes('【知识变体】')))
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

test('序6 DTO：四维只给按本章语料命中的少量候选，不暴露全量菜单', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    ctx.packageRoot = packageRoot
    await fs.appendFile(
      path.join(ctx.repoPath, '大纲', '卷纲', '第01卷.md'),
      '\n- 第3章安排拍卖会竞价，先抑后扬，章尾使用悬念钩。\n',
      'utf8'
    )
    const dto = await buildDto(ctx, 6, { nextChapter: 3 })
    assert.ok(dto.章级知识候选.节拍.some((item) => item.编号 === 'PA-001'))
    assert.ok(dto.章级知识候选.场景.some((item) => item.名称 === '拍卖会'))
    assert.ok(dto.章级知识候选.追读.some((item) => item.名称 === '悬念钩'))
    for (const entries of Object.values(dto.章级知识候选)) {
      assert.ok(entries.length <= 3)
      assert.ok(entries.every((item) => item.来源.includes('@sha256:')))
      assert.ok(entries.every((item) => !('文件' in item)))
    }
    assert.equal(dto.节拍索引, undefined)
    assert.equal(dto.钩子清单, undefined)
    assert.equal(dto.场景索引, undefined)
    assert.match(dto.期望产物, /本章节拍/)
    assert.match(dto.期望产物, /本章技法/)
    assert.match(dto.期望产物, /完全自定义/)
  } finally {
    await cleanup()
  }
})

test('序6 DTO：批内前章选择只触发软重复信号，不硬排除合法复用', async () => {
  const { ctx, cleanup } = await tempBookCtx()
  try {
    ctx.packageRoot = packageRoot
    const stagedOutline = [
      '# 第 3 章细纲',
      '## 本章提案',
      '本章场景：拍卖会',
      '知识变体：第 3 章只写竞价，第 4 章承接会后追踪',
      '## 本章要写到的事（确认即生效）',
      '- [ ] 完成拍卖竞价',
    ].join('\n')
    await fs.writeFile(path.join(ctx.repoPath, '工作区', '细纲.md'), stagedOutline, 'utf8')
    await writeReviewArtifacts(ctx.repoPath, 3)
    const staged = await stageChapter(ctx, {
      chapterNum: 3,
      payload: {
        frontMatter: {
          章号: 3,
          标题: '拍卖落槌',
          卷: 1,
          书内时间: '春月初三',
          字数: 100,
          章定位: '推进',
          钩子: '悬念钩-中',
          情绪定位: '抬升',
        },
        body: '竞价落槌后，林晚发现有人跟踪。',
      },
    })
    assert.equal(staged.ok, true, staged.error)
    await fs.appendFile(
      path.join(ctx.repoPath, '大纲', '卷纲', '第01卷.md'),
      '\n- 第4章继续拍卖会余波，追查竞价者。\n',
      'utf8'
    )

    const dto = await buildDto(ctx, 6, { nextChapter: 4 })
    const auction = dto.章级知识候选.场景.find((item) => item.名称 === '拍卖会')
    assert.ok(auction, '近期用过的合适候选仍须保留')
    assert.deepEqual(auction.近期使用, [
      { 章号: 3, 变体: '第 3 章只写竞价，第 4 章承接会后追踪' },
    ])
    assert.match(auction.重复提醒, /软降权/)
  } finally {
    await cleanup()
  }
})

test('序6 DTO：技法维度使用同一候选接口，并把规划切片交给真实消费者', async () => {
  const packageFixture = await mkdtemp(path.join(os.tmpdir(), 'wnw-technique-ref-'))
  const { ctx, cleanup } = await tempBookCtx()
  try {
    const dir = path.join(packageFixture, 'references', '技法')
    await mkdir(dir, { recursive: true })
    await writeFile(
      path.join(dir, '限制视角误导.md'),
      [
        '---',
        '名称: 限制视角误导',
        '类别: 视角',
        '作用层级: 场景',
        '触发问题:',
        '  - 信息误导',
        '一句话: 只给视角人物能确认的信息',
        '---',
        '## 规划这一章时',
        '先列出视角人物知道与不知道的事实。',
        '## 落笔时',
        '不得越过视角人物认知补叙真相。',
        '## 审稿时',
        '核对是否出现越权信息。',
      ].join('\n'),
      'utf8'
    )
    ctx.packageRoot = packageFixture
    const dto = await buildDto(ctx, 6, {
      nextChapter: 3,
      本章任务: '本章用限制视角误导隐藏真相',
    })
    assert.equal(dto.章级知识候选.技法[0].名称, '限制视角误导')
    assert.match(dto.章级知识候选.技法[0].规划, /知道与不知道/)
    assert.match(dto.章级知识候选.技法[0].来源, /^技法\/限制视角误导\.md@sha256:/)
  } finally {
    await cleanup()
    await rm(packageFixture, { recursive: true, force: true })
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
  for (const name of ['维度宪章.md', '调用者与字段矩阵.md', '策展规则.md']) {
    assert.ok(files[`.webnovel/docs/knowledge/${name}`], `安装包缺治理文档 ${name}`)
  }
  const readme = files['.webnovel/references/README.md']
  const governanceLinks = [...readme.matchAll(/\]\((\.\.\/docs\/knowledge\/[^)]+)\)/g)]
  assert.equal(governanceLinks.length, 3, 'references README 应明确链接三份治理真源')
  for (const match of governanceLinks) {
    const target = path.posix.normalize(path.posix.join('.webnovel/references', match[1]))
    assert.ok(files[target], `references README 链接失效：${match[1]}`)
  }
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
      assert.ok(!dto6.章级知识候选)
    } finally {
      await cleanup()
    }
  } finally {
    await rm(empty, { recursive: true, force: true })
  }
})
