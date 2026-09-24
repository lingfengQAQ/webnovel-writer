import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawnSync } from 'node:child_process'
import { createNovelTools } from '../src/novel-tools'
import { computeReview, listChecks, registerDefaultChecks } from '@webnovel/review'
import { nativeWriteStub } from './fixtures/native-write-stub'

const roots: string[] = []
function mkWs(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-chain-'))
  roots.push(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放 */ } } })

function makeTools(ws: string) {
  const tools = createNovelTools({
    nativeWrite: nativeWriteStub,
    workspaceRoot: () => ws,
    bookRootOfBookId: (id) => path.join(ws, '链路书'),
    testTools: true,
  })
  const call = async (name: string, args: Record<string, unknown>) => {
    const tool = tools.find((t) => t.name === name)!
    expect(tool, `工具 ${name} 应已注册`).toBeDefined()
    return (await tool.execute(args, { agent: { id: 'agent-1', session: { append: () => {} } } })) as Record<string, unknown> & { ok: boolean }
  }
  return { call }
}

const CONCEPT = {
  状态: '已确认',
  核心创意: 'x', 题材与目标读者: 'x', 主角核心欲望: 'x', 主要冲突: 'x',
  核心看点: 'x', 差异化方向: 'x', 明确不要什么: 'x',
}

function candidateBody(): string {
  return [
    '# 章细纲', '',
    '## 定位段', '',
    '### 来源窗口项及拆并关系', '开篇任务，单章承接', '',
    '### 章节功能', '', '- 〔硬〕开场必须点名主角现身', '',
    '### 视角与焦点', '主角视角', '',
    '### 时空锚定', '城门口，清晨', '',
    '### 起止边界', '从抵达城门到发现异状', '',
    '### 故事线与承诺分配', '推进主线承诺', '',
    '### 信息边界', '只披露主角所见', '',
    '### 情绪与节奏目标', '紧张后留钩子', '',
    '### 前置条件核对结果', '已核对来源与窗口，前置设定均非留白', '',
    '## 细纲段', '',
    '### 单元 1', '',
    '- 目标: 开场', '- 人物: 主角', '- 时空: 城门口', '- 行动/冲突: 盘问与发现', '- 信息披露: 异常线索', '- 状态变化: 从平静到警觉', '',
  ].join('\n')
}

function git(root: string, args: string[]) {
  return spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, encoding: 'utf-8' })
}

async function makeBook(ws: string, call: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown> & { ok: boolean }>) {
  const created = await call('novel_create_book', { bookName: '链路书', concept: CONCEPT })
  expect(created.ok).toBe(true)
  const bookId = (created as { bookId: string }).bookId
  await call('novel_select_book', { bookId })
  const seeded = await call('novel_seed_min_design', { bookId })
  expect(seeded.ok).toBe(true)
  return { ...created, bookId }
}

describe('运行链路接线(工具面验收)', () => {
  it('确认细纲:design(chNNNN): 提交;批次文件同提交;幂等重放不重写不重复提交', async () => {
    const ws = mkWs()
    const { call } = makeTools(ws)
    const { bookId } = await makeBook(ws, call)
    const bookRoot = path.join(ws, '链路书')
    const count = () => git(bookRoot, ['rev-list', '--count', 'HEAD']).stdout?.trim()

    // 候选细纲(草稿区,不过工具提交)
    const draft = await call('novel_new_outline_draft', { bookId, 卷: 1, 章: 1, 章名: '开篇任务', 正文: candidateBody(), 来源引用: ['作品契约/契约.md@1', '世界书/人物档案/主角.md@1'] })
    expect(draft.ok).toBe(true)
    const candidateCount = count()

    // 同批整改文件:先改动分卷布局(上游提案的下游整改),随确认整批一次提交
    const layout = path.join(bookRoot, '大纲/分卷布局.md')
    fs.writeFileSync(layout, `${fs.readFileSync(layout, 'utf-8')}- 卷02 〔留白〕\n`, 'utf-8')

    const confirmed = await call('novel_confirm_outline', {
      bookId, 卷: 1, 章: 1, 章名: '开篇任务', 批次文件: ['大纲/分卷布局.md'],
    })
    expect(confirmed.ok).toBe(true)
    const subject = git(bookRoot, ['log', '-1', '--pretty=%s', '--', '大纲/卷规划/卷01/章细纲/0001-开篇任务.md']).stdout?.trim()
    expect(subject).toBe('design(ch0001): 确认细纲·开篇任务')
    const names = git(bookRoot, ['-c', 'core.quotepath=false', 'show', '--name-only', '--pretty=format:', 'HEAD']).stdout?.split('\n').map((l) => l.trim())
    expect(names).toContain('大纲/分卷布局.md')
    expect(Number(count())).toBe(Number(candidateCount) + 1)

    // 幂等重放:候选已删、真源已落位 → 补提交通道跑一次,无改动无新提交
    const replay = await call('novel_confirm_outline', { bookId, 卷: 1, 章: 1, 章名: '开篇任务' })
    expect(replay.ok).toBe(true)
    expect(String(replay.message)).toMatch(/幂等重放|无改动/)
    expect(count()).toBe(String(Number(candidateCount) + 1))
    expect(fs.existsSync(path.join(bookRoot, '草稿区/章细纲/卷01-开篇任务.md'))).toBe(false)
  })

  it('窗口滚动与设计侧更新产生 design: 提交;新建书状态含 design 段', async () => {
    const ws = mkWs()
    const { call } = makeTools(ws)
    const { bookId } = await makeBook(ws, call)
    const bookRoot = path.join(ws, '链路书')

    const status = await call('novel_get_story_status', { bookId })
    expect(status.ok).toBe(true)
    // R1:get_story_status 返回事实清单形状——design 段含逐项事实与建议
    const design = status.design as { 事实项?: ReadonlyArray<{ 名称: string; 事实: boolean }>; 建议?: string }
    expect(Array.isArray(design.事实项)).toBe(true)
    expect(design.事实项!.length).toBeGreaterThan(0)
    expect(typeof design.建议).toBe('string')

    const roll = await call('novel_roll_window', { bookId, 卷: 1, action: '标已消费', 名称: '开篇任务' })
    expect(roll.ok).toBe(true)
    const log = git(bookRoot, ['log', '-1', '--pretty=%s', '--', '大纲/卷规划/卷01/近期窗口.md']).stdout?.trim()
    expect(log).toMatch(/^design: 近期窗口·标已消费/)

    const append = await call('novel_roll_window', { bookId, 卷: 1, action: '追加', 名称: '第二章风波' })
    expect(append.ok).toBe(true)

    const skeleton = await call('novel_update_skeleton', { bookId, 正文: '# 故事骨架\n\n- 第一幕 〔已确认〕\n' })
    expect(skeleton.ok).toBe(true)
    expect(git(bookRoot, ['log', '-1', '--pretty=%s', '--', '大纲/故事骨架.md']).stdout?.trim()).toMatch(/^design: 故事骨架/)

    const worldbook = await call('novel_confirm_worldbook_entry', {
      bookId, 模块: '人物档案', 名称: '配角甲', 类型: '人物', 性质: '计划', 状态: '已确认', 来源: '对谈共创',
    })
    expect(worldbook.ok).toBe(true)
    expect(git(bookRoot, ['log', '-1', '--pretty=%s', '--', '世界书/人物档案/配角甲.md']).stdout?.trim()).toMatch(/^design: 世界书条目·配角甲/)
  })

  it('novel_record_review_findings 回写与未注册模块拒绝', async () => {
    const ws = mkWs()
    const { call } = makeTools(ws)
    const { bookId } = await makeBook(ws, call)

    const bad = await call('novel_record_review_findings', { bookId, 卷: 1, 章: 1, 章名: '开篇任务', 模块名: '不存在的模块', 发现项: [] })
    expect(bad.ok).toBe(false)

    // Review evidence must have a current manuscript to bind to.
    const draftDir = path.join(ws, '链路书', '草稿区/草稿/卷01-开篇任务')
    fs.mkdirSync(draftDir, { recursive: true })
    fs.writeFileSync(path.join(draftDir, '稿1.md'), '---\n角色: 待审稿\n---\n\n主角走进城门。\n', 'utf-8')

    const r = await call('novel_record_review_findings', {
      bookId, 卷: 1, 章: 1, 章名: '开篇任务', 模块名: '章节结构审读',
      发现项: [{ 严重程度: '中', 证据位置: '草稿区/草稿/卷01-开篇任务/稿1.md:1', 问题说明: '开场未点名主角', 所依据材料及版本: '稿1@1', 影响范围: '本章', 修改建议: '补点名', 建议返回节点: '改稿', 建议复审模块: '', 不确定性说明: '', 材料完整性: '完整' }],
    })
    expect(r.ok).toBe(true)
    // 仅回写一个模块:其余模块未回写,审核不判完成
    expect(r.完成).toBe(false)
  })

  it('审核回写:待回写模块与完成同源;重置后报出暂存待继承的处置条数(#162)', async () => {
    const ws = mkWs()
    const { call } = makeTools(ws)
    const { bookId } = await makeBook(ws, call)
    const bookRoot = path.join(ws, '链路书')
    const draft = path.join(bookRoot, '草稿区/草稿/卷01-开篇任务/稿1.md')
    fs.mkdirSync(path.dirname(draft), { recursive: true })
    fs.writeFileSync(draft, '---\n角色: 待审稿\n---\n\n主角走进城门。\n', 'utf-8')
    registerDefaultChecks()
    const all = listChecks().filter((c) => c.执行形态 !== '作者').map((c) => c.名称)
    const chapter = { 卷: 1, 章: 1, 章名: '开篇任务' }
    const kept = { 问题说明: '开场偏慢', 证据位置: '首段', 影响范围: '正文', 处置: '作者保留' }

    for (const [i, 模块名] of all.entries()) {
      const r = await call('novel_record_review_findings', { bookId, ...chapter, 模块名, 发现项: 模块名 === '章节结构审读' ? [kept] : [] })
      expect(r.ok, 模块名).toBe(true)
      expect(r.待回写模块).toEqual(all.slice(i + 1))
      expect(r.完成).toBe(i === all.length - 1)
      if (i === 0) expect(r.message).toContain(`尚待回写模块：${all.slice(1).join('、')}`)
    }

    // 改稿后带当轮指纹回写第一个模块:旧轮次重置,其余模块全部列为待回写,上一轮处置暂存待继承
    fs.writeFileSync(draft, '---\n角色: 待审稿\n---\n\n主角走进城门，看见告示。\n', 'utf-8')
    const fingerprint = computeReview(bookRoot, chapter).record!.审读指纹
    const reset = await call('novel_record_review_findings', { bookId, ...chapter, 模块名: all[0], 发现项: [], 审读指纹: fingerprint })
    expect(reset.ok).toBe(true)
    expect(reset.完成).toBe(false)
    expect(reset.待回写模块).toEqual(all.slice(1))
    expect(reset.待继承处置数).toBe(1)
    expect(reset.message).toContain('上一轮已给处置 1 条暂存待继承')
  })

  it('novel_record_memory 落书房,不进书仓 git;索引与条目一致', async () => {
    const ws = mkWs()
    const { call } = makeTools(ws)
    const { bookId } = await makeBook(ws, call)
    const bookRoot = path.join(ws, '链路书')

    const r = await call('novel_record_memory', {
      bookId, 名称: '反派动机-折剑人', 描述: '作者拍板:折剑人毁剑是为阻止剑灾', 类: '决策',
      标签: ['链路书', '卷01', '人物动机'], 来源: '对谈', 正文: '[[主角]] 与折剑人的冲突根源。',
    })
    expect(r.ok).toBe(true)
    const entry = path.join(ws, '书房/作者记忆/反派动机-折剑人.md')
    expect(fs.existsSync(entry)).toBe(true)
    const index = fs.readFileSync(path.join(ws, '书房/作者记忆/索引.md'), 'utf-8')
    expect(index).toContain('反派动机-折剑人')
    expect(index).toContain('作者拍板:折剑人毁剑是为阻止剑灾')
    // 作者层资产不在书仓工作树状态中
    const status = git(bookRoot, ['status', '--porcelain']).stdout ?? ''
    expect(status).not.toContain('书房')
    expect(git(bookRoot, ['ls-files']).stdout ?? '').not.toContain('作者记忆')

    // 进度卡:未决偏离 = 对账偏离 − 作者层已处置(拍板 4)
    const progress1 = await call('novel_get_book_progress', { bookId })
    expect(progress1.ok).toBe(true)
    const before = (progress1.未决偏离 as string[]).length
    expect(before).toBeGreaterThan(0)
    const devName = (progress1.未决偏离 as string[])[0]!
    await call('novel_record_memory', {
      bookId, 名称: `偏离处置-${devName}`, 描述: `作者接受偏离:${devName}`, 类: '决策',
      标签: ['链路书', '卷01'], 来源: '对谈', 正文: `偏离项「${devName}」处置:接受偏离,不改后续计划。`,
    })
    const progress2 = await call('novel_get_book_progress', { bookId }) as { ok: boolean; 未决偏离: string[] }
    expect(progress2.ok).toBe(true)
    expect(progress2.未决偏离).not.toContain(devName)
    expect(progress2.未决偏离.length).toBe(before - 1)
    const rendered = String(progress1.渲染)
    expect(rendered).toContain('【书级进度卡】')
    expect(rendered).toContain('未绑定章')
  })

  it('任务21:卷摘要确认(design:/版本协议)＋进度卡待核对/规划卷＋设计检查规划卷', async () => {
    const ws = mkWs()
    const { call } = makeTools(ws)
    const { bookId } = await makeBook(ws, call)
    const bookRoot = path.join(ws, '链路书')

    // 件一:卷摘要 首次 v1→design: 提交;原样重跑复用;变更 v2 父版本 1
    const body1 = '# 卷摘要\n\n## 章摘要汇编\n\n### 第0001章 开篇任务\n\n摘要：开场。\n'
    const c1 = await call('novel_confirm_volume_outline', { bookId, 卷: 1, 目标: '卷摘要', 正文: body1, summary: '卷摘要·卷01' })
    expect(c1.ok).toBe(true)
    const sumRel = '大纲/卷规划/卷01/卷摘要.md'
    const sum1 = fs.readFileSync(path.join(bookRoot, sumRel), 'utf-8')
    expect(sum1).toMatch(/版本:\s*1/)
    expect(sum1).toMatch(/状态:\s*已确认/)
    expect(sum1).toMatch(/生成模块:\s*卷摘要确认/)
    expect(git(bookRoot, ['log', '-1', '--pretty=%s', '--', sumRel]).stdout?.trim()).toMatch(/^design: 卷摘要·卷01/)
    const c2 = await call('novel_confirm_volume_outline', { bookId, 卷: 1, 目标: '卷摘要', 正文: body1 })
    expect(c2.ok).toBe(true)
    const c3 = await call('novel_confirm_volume_outline', { bookId, 卷: 1, 目标: '卷摘要', 正文: `${body1}\n补一行修订。\n` })
    expect(c3.ok).toBe(true)
    const sum3 = fs.readFileSync(path.join(bookRoot, sumRel), 'utf-8')
    expect(sum3).toMatch(/版本:\s*2/)
    expect(sum3).toMatch(/父版本:\s*1/)

    // B3 消费映射:卷1证完成(3章定稿)→ planning(1,2);B1:章级计划无事实→待核对
    fs.writeFileSync(path.join(bookRoot, '大纲/卷规划/卷01/卷纲.md'), ['# 卷纲', '', '卷01｜1 案／3 章，单章约 100 字', '', '## 叙事结构 〔已确认〕', '', 'x', '', '## 弧线 〔留白〕', '', '## 线索推进 〔留白〕', '', '## 卷末兑现 〔留白〕', ''].join('\n'), 'utf-8')
    for (let n = 1; n <= 3; n += 1) {
      const fin = path.join(bookRoot, `定稿/卷01/${String(n).padStart(4, '0')}-第${n}章.md`)
      fs.mkdirSync(path.dirname(fin), { recursive: true })
      fs.writeFileSync(fin, `---\n状态: 已定稿\n---\n第${n}章正文\n`, 'utf-8')
    }
    fs.writeFileSync(path.join(bookRoot, '大纲/卷规划/卷01/计划时间线.md'), '# 计划时间线\n\n## 窗口覆盖\n- 第三章 渡口\n', 'utf-8')

    const progress = await call('novel_get_book_progress', { bookId }) as { ok: boolean; 卷: number; 规划卷?: number; 待核对?: { 名称: string; 章号: number; 本章事实: string[] }[]; 渲染: string }
    expect(progress.ok).toBe(true)
    expect(progress.卷).toBe(1) // 默认对账保留已完成卷
    expect(progress.规划卷).toBe(2) // 呈报规划目标卷
    expect(progress.待核对).toEqual([{ 名称: '第三章 渡口', 章号: 3, 本章事实: [] }])
    expect(progress.渲染).toContain('章级待核对：1 条')
    expect(progress.渲染).not.toContain('无偏离')

    // scanDesign 消费规划卷(2):卷2 未分配 → 建议停在分卷布局;若错用卷1 会报当前卷规划
    const status = await call('novel_get_story_status', { bookId })
    expect(status.ok).toBe(true)
    const design = status.design as { 建议?: string }
    expect(design.建议).toBe('分卷布局')
  })
})
