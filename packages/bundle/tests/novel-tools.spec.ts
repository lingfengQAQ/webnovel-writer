import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawnSync } from 'node:child_process'
import { createNovelTools, NOVEL_TEST_TOOL_NAMES, NOVEL_TOOL_NAMES } from '../src/novel-tools'
import { EDITOR_CANCELLED_REASON, EDITOR_DUPLICATE_REASON, EDITOR_UNKNOWN_REASON, EditorRequestHub, type EditorIntent, type EditorRequestSnapshot } from '../src/study/editor-requests'
import { createBook, scanDesign, writeContract, 契约六部 } from '@webnovel/core'
import { nativeWriteStub } from './fixtures/native-write-stub'

const roots: string[] = []
function mkRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-tools-'))
  roots.push(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

describe('主 Agent 专用 Tools (方案 A)', () => {
  it('契约篇幅非法时不调用原生写入，合法子项随原契约工具保存', async () => {
    const ws = mkRoot()
    const root = path.join(ws, '篇幅约定')
    let writes = 0
    const tools = createNovelTools({ workspaceRoot: () => ws, bookRootOfBookId: () => root,
      nativeWrite: async (...args) => { writes++; await nativeWriteStub(...args) } })
    const created = await tools.find(t => t.name === 'novel_create_book')!.execute({ bookName: '篇幅约定', concept: { 状态: '已确认', 核心创意: '小铺经营', 题材与目标读者: '仙侠' } }) as { ok: boolean; bookId: string }
    expect(created.ok).toBe(true)
    const contract = path.join(root, '作品契约/契约.md')
    const before = fs.readFileSync(contract, 'utf8')
    const initialWrites = writes
    const tool = tools.find(t => t.name === 'novel_update_contract')!
    const args = { bookId: created.bookId, partName: '阅读体验与情绪承诺', state: '已确认', content: '### 章节篇幅\n- 目标汉字数: 2000\n- 下限汉字数: 1600\n- 上限汉字数: 2400' }
    expect(await tool.execute({ ...args, content: args.content.replace('1600', '2600') })).toMatchObject({ ok: false, reason: expect.stringContaining('下限') })
    expect(writes).toBe(initialWrites)
    expect(fs.readFileSync(contract, 'utf8')).toBe(before)
    expect(await tool.execute(args)).toMatchObject({ ok: true, commitState: 'committed' })
    expect(writes).toBe(initialWrites + 1)
    expect(fs.readFileSync(contract, 'utf8')).toContain(args.content)
  })

  it.each(['# 模块声明\n', null])('旧书声明 %s：确认后登记、状态闭环、同次提交且重跑幂等', async (initial) => {
    const ws = mkRoot()
    const bookRoot = path.join(ws, '旧书')
    const tools = createNovelTools({ nativeWrite: nativeWriteStub, workspaceRoot: () => ws, bookRootOfBookId: () => bookRoot })
    const call = async (name: string, args: Record<string, unknown>) => tools.find(t => t.name === name)!.execute(args) as Promise<any>
    const created = await call('novel_create_book', { bookName: '旧书', concept: { 状态: '已确认', 核心创意: '寻找失踪家人', 题材与目标读者: '悬疑' } })
    expect(created.ok).toBe(true)
    writeContract(bookRoot, Object.fromEntries(契约六部.map(name => [name, { state: '已确认' as const, body: '围绕裴笑寻找妹妹展开悬疑故事。' }])))
    const declaration = path.join(bookRoot, '世界书/模块声明.md')
    if (initial === null) fs.unlinkSync(declaration)
    else fs.writeFileSync(declaration, initial)
    expect(spawnSync('git', ['add', '--', '世界书/模块声明.md'], { cwd: bookRoot, windowsHide: true }).status).toBe(0)
    expect(spawnSync('git', ['commit', '-m', 'test: legacy declaration'], { cwd: bookRoot, windowsHide: true }).status).toBe(0)
    const args = { bookId: created.bookId, 模块: '人物档案', 名称: '裴笑', 类型: '人物', 性质: '计划', 状态: '已确认', 来源: '作者确认', 正文: '裴笑寻找失踪的妹妹。' }
    const failing = createNovelTools({ nativeWrite: async () => { throw new Error('FS_STALE_VERSION') }, workspaceRoot: () => ws, bookRootOfBookId: () => bookRoot })
    expect(await failing.find(t => t.name === 'novel_confirm_worldbook_entry')!.execute(args)).toMatchObject({ ok: false })
    expect(fs.existsSync(declaration) ? fs.readFileSync(declaration, 'utf8') : null).toBe(initial)
    expect(await call('novel_confirm_worldbook_entry', args)).toMatchObject({ ok: true })
    const committed = spawnSync('git', ['-c', 'core.quotepath=false', 'show', '--pretty=', '--name-only', 'HEAD'], { cwd: bookRoot, encoding: 'utf8', windowsHide: true }).stdout
    expect(committed).toContain('世界书/模块声明.md')
    expect(committed).toContain('世界书/人物档案/裴笑.md')
    expect((await call('novel_get_story_status', { bookId: created.bookId })).design.事实项).toContainEqual({ 名称: '世界书最小模块足够', 事实: false })
    expect(await call('novel_confirm_worldbook_entry', { ...args, 模块: '世界规则', 名称: '灵力', 类型: '规则', 正文: '灵力只能通过睡眠恢复。' })).toMatchObject({ ok: true })
    expect((await call('novel_get_story_status', { bookId: created.bookId })).design.事实项).toContainEqual({ 名称: '世界书最小模块足够', 事实: true })
    expect((await call('novel_get_story_status', { bookId: created.bookId })).design.建议).toBe('故事骨架')
    fs.appendFileSync(declaration, '\n作者说明：保留地方风俗。\n')
    const custom = { ...args, 模块: '地方风俗', 名称: '祭典' }
    expect(await call('novel_confirm_worldbook_entry', custom)).toMatchObject({ ok: true })
    const text = fs.readFileSync(declaration, 'utf8')
    expect(text).toContain('作者说明：保留地方风俗。')
    expect(text).toContain('- 地方风俗')
    expect(await call('novel_confirm_worldbook_entry', custom)).toMatchObject({ ok: true, commitState: 'unchanged' })
    expect(fs.readFileSync(declaration, 'utf8')).toBe(text)
  })

  it('#167 契约无改动是完成态，提交失败才允许补试，重跑不制造提交', async () => {
    const ws = mkRoot()
    const bookRoot = path.join(ws, '循环回归')
    const tools = createNovelTools({ nativeWrite: nativeWriteStub, workspaceRoot: () => ws, bookRootOfBookId: () => bookRoot })
    const created = await tools.find(t => t.name === 'novel_create_book')!.execute({
      bookName: '循环回归', concept: { 状态: '已确认', 核心创意: 'x', 题材与目标读者: 'x', 主角核心欲望: 'x', 主要冲突: 'x', 核心看点: 'x', 差异化方向: 'x', 明确不要什么: 'x' },
    }) as { ok: boolean; bookId: string }
    expect(created.ok).toBe(true)
    const update = tools.find(t => t.name === 'novel_update_contract')!
    const args = { bookId: created.bookId, partName: '创作禁区与不可妥协项', state: '已确认', content: '不增加无关支线。' }
    expect(await update.execute(args)).toMatchObject({ ok: true, commitState: 'committed', retryable: false })
    const head = () => spawnSync('git', ['rev-parse', 'HEAD'], { cwd: bookRoot, encoding: 'utf8', windowsHide: true }).stdout.trim()
    const committed = head()
    expect(await update.execute(args)).toMatchObject({ ok: true, commitState: 'unchanged', retryable: false })
    expect(head()).toBe(committed)
    fs.writeFileSync(path.join(bookRoot, '.git/index.lock'), '')
    const next = { ...args, content: '不增加无关支线，也不改主角原则。' }
    try {
      expect(await update.execute(next)).toMatchObject({ ok: false, commitState: 'failed', retryable: true })
      expect(head()).toBe(committed)
    } finally { fs.unlinkSync(path.join(bookRoot, '.git/index.lock')) }
    expect(await update.execute(next)).toMatchObject({ ok: true, commitState: 'committed', retryable: false })
    expect(head()).not.toBe(committed)
    expect(await update.execute({ ...next, state: '暂定' })).toMatchObject({ ok: true, commitState: 'not-required', retryable: false })
  })

  it('novel_create_book & novel_select_book & novel_seed_min_design & novel_update_contract & novel_get_story_status 闭环', async () => {
    const ws = mkRoot()
    const tools = createNovelTools({
      nativeWrite: nativeWriteStub,
      workspaceRoot: () => ws,
      bookRootOfBookId: (id) => path.join(ws, '仙途长生'),
      testTools: true,
    })

    const createTool = tools.find((t) => t.name === 'novel_create_book')!
    const selectTool = tools.find((t) => t.name === 'novel_select_book')!
    const seedTool = tools.find((t) => t.name === 'novel_seed_min_design')!
    const contractTool = tools.find((t) => t.name === 'novel_update_contract')!
    const statusTool = tools.find((t) => t.name === 'novel_get_story_status')!

    // 1. 建书
    const createRes = (await createTool.execute({
      bookName: '仙途长生',
      concept: {
        状态: '已确认',
        核心创意: '凡人流修仙与上古残魂',
        题材与目标读者: '古典仙侠',
        主角核心欲望: '求长生与道心坚定',
        主要冲突: '宗门倾轧与魔修劫难',
        核心看点: '稳健发育与步步为营',
        差异化方向: '无系统纯智商博弈',
        明确不要什么: '无脑倒贴与战力崩塌',
      },
    }, { agent: { id: 'agent-1', session: { append: () => {} } } })) as { ok: boolean; bookId: string }

    expect(createRes.ok).toBe(true)
    expect(createRes.bookId).toMatch(/^b-/)

    // 2. 更新契约（题材与读者定位）
    const contractRes = (await contractTool.execute({
      bookId: createRes.bookId,
      partName: '题材与读者定位',
      state: '已确认',
      content: '练气九层、筑基三阶、金丹九品。',
    })) as { ok: boolean }
    expect(contractRes.ok).toBe(true)

    // 验证契约内容与书id未丢失
    const contractContent = fs.readFileSync(path.join(ws, '仙途长生', '作品契约/契约.md'), 'utf-8')
    expect(contractContent).toContain(`书id: ${createRes.bookId}`)
    expect(contractContent).toContain('练气九层、筑基三阶、金丹九品。')

    // 3. 最小设计
    const seedRes = (await seedTool.execute({ bookId: createRes.bookId })) as { ok: boolean }
    expect(seedRes.ok).toBe(true)

    // 4. 读取真源状态
    const statusRes = (await statusTool.execute({ bookId: createRes.bookId })) as { ok: boolean; chapters: any[] }
    expect(statusRes.ok).toBe(true)
    expect(statusRes.chapters.length).toBeGreaterThan(0)
    // seed 只写占位确认态:不再建议开写就绪，同时列出缺少正文的分部(#165)
    const design = (statusRes as unknown as { design: { 建议: string; 已确认无内容?: string[] } }).design
    expect(design.建议).toBe('作品定调')
    expect(design.已确认无内容).toEqual(expect.arrayContaining(['故事骨架·主角目标与成长轨迹', '世界书·人物档案/主角']))
  })

  it('seed 只供测试/走查：默认不注册、不进 NOVEL_TOOL_NAMES，testTools 开启才注册', () => {
    const deps = { nativeWrite: nativeWriteStub, workspaceRoot: () => undefined, bookRootOfBookId: () => undefined }
    const names = createNovelTools(deps).map((t) => t.name)
    expect(names).toEqual([...NOVEL_TOOL_NAMES])
    for (const name of NOVEL_TEST_TOOL_NAMES) {
      expect(names).not.toContain(name)
      expect(NOVEL_TOOL_NAMES).not.toContain(name)
    }
    const withTest = createNovelTools({ ...deps, testTools: true }).map((t) => t.name)
    expect(withTest).toEqual(expect.arrayContaining([...NOVEL_TOOL_NAMES, ...NOVEL_TEST_TOOL_NAMES]))
    expect(withTest).toHaveLength(NOVEL_TOOL_NAMES.length + NOVEL_TEST_TOOL_NAMES.length)
  })

  it('建书即登记最小模块：不经 seed，世界书工具确认条目后即过「世界构建」', async () => {
    const ws = mkRoot()
    const bookRoot = path.join(ws, '工具书')
    const tools = createNovelTools({ nativeWrite: nativeWriteStub, workspaceRoot: () => ws, bookRootOfBookId: () => bookRoot })
    const call = async (name: string, args: Record<string, unknown>) =>
      (await tools.find((t) => t.name === name)!.execute(args, { agent: { id: 'agent-1', session: { append: () => {} } } })) as { ok: boolean; bookId?: string }
    const created = await call('novel_create_book', {
      bookName: '工具书',
      concept: { 状态: '已确认', 核心创意: 'x', 题材与目标读者: 'x', 主角核心欲望: 'x', 主要冲突: 'x', 核心看点: 'x', 差异化方向: 'x', 明确不要什么: 'x' },
    })
    expect(created.ok).toBe(true)
    const declared = fs.readFileSync(path.join(bookRoot, '世界书/模块声明.md'), 'utf-8')
    expect(declared).toContain('- 人物档案')
    expect(declared).toContain('- 世界规则')
    expect(scanDesign(bookRoot).世界书最小模块足够).toBe(false)
    for (const [模块, 名称, 类型] of [['人物档案', '主角', '人物'], ['世界规则', '修炼体系', '规则']] as const) {
      const r = await call('novel_confirm_worldbook_entry', {
        bookId: created.bookId, 模块, 名称, 类型, 性质: '计划', 状态: '已确认', 来源: '对谈共创', 正文: `# ${名称}\n\n设定正文。\n`,
      })
      expect(r.ok, 模块).toBe(true)
    }
    expect(scanDesign(bookRoot).世界书最小模块足够).toBe(true)
  })

  it('novel_prepare_pack & novel_settle_chapter 守卫：无待审稿报错、无裁决通道拒绝沉淀', async () => {
    const ws = mkRoot()
    const tools = createNovelTools({
      nativeWrite: nativeWriteStub,
      workspaceRoot: () => ws,
      bookRootOfBookId: () => path.join(ws, '守卫书'),
    })
    const createTool = tools.find((t) => t.name === 'novel_create_book')!
    const prepareTool = tools.find((t) => t.name === 'novel_prepare_pack')!
    const settleTool = tools.find((t) => t.name === 'novel_settle_chapter')!

    const createRes = (await createTool.execute({
      bookName: '守卫书',
      concept: {
        状态: '已确认',
        核心创意: 'x', 题材与目标读者: 'x', 主角核心欲望: 'x', 主要冲突: 'x',
        核心看点: 'x', 差异化方向: 'x', 明确不要什么: 'x',
      },
    }, { agent: { id: 'agent-1', session: { append: () => {} } } })) as { ok: boolean; bookId: string }

    // 无待审稿：组装定稿包失败
    const prepareRes = (await prepareTool.execute({ bookId: createRes.bookId, 卷: 1, 章: 1, 章名: '第一章' })) as { ok: boolean; reason?: string }
    expect(prepareRes.ok).toBe(false)
    expect(prepareRes.reason).toContain('待审稿')

    // 未注入裁决通道：拒绝沉淀（裁决 14：审批不可由模型自证，详见 settle-approval.spec.ts）
    const noChannel = (await settleTool.execute({ bookId: createRes.bookId, 卷: 1, 章: 1, 章名: '第一章', summary: 'x' })) as { ok: boolean; reason?: string }
    expect(noChannel.ok).toBe(false)
    expect(noChannel.reason).toContain('裁决通道')
  })

  it('提交点跟随作者确认(拍板 1/2/7)：契约已确认→design: 提交；暂定→不提交；seed→整批一次提交且重跑幂等', async () => {
    const ws = mkRoot()
    const tools = createNovelTools({
      nativeWrite: nativeWriteStub,
      workspaceRoot: () => ws,
      bookRootOfBookId: (id) => path.join(ws, '提交纪律书'),
      testTools: true,
    })
    const createTool = tools.find((t) => t.name === 'novel_create_book')!
    const seedTool = tools.find((t) => t.name === 'novel_seed_min_design')!
    const contractTool = tools.find((t) => t.name === 'novel_update_contract')!

    const createRes = (await createTool.execute({
      bookName: '提交纪律书',
      concept: {
        状态: '已确认',
        核心创意: 'x', 题材与目标读者: 'x', 主角核心欲望: 'x', 主要冲突: 'x',
        核心看点: 'x', 差异化方向: 'x', 明确不要什么: 'x',
      },
    }, { agent: { id: 'agent-1', session: { append: () => {} } } })) as { ok: boolean; bookId: string }

    const git = (args: string[]) => spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: path.join(ws, '提交纪律书'), encoding: 'utf-8' })
    const count = () => git(['rev-list', '--count', 'HEAD']).stdout?.trim()

    // 暂定态：只写文件,不产生提交
    const tentative = (await contractTool.execute({
      bookId: createRes.bookId,
      partName: '题材与读者定位', state: '暂定', content: '暂定内容',
    })) as { ok: boolean }
    expect(tentative.ok).toBe(true)
    const afterTentative = count()
    expect(git(['log', '-1', '--pretty=%s', '--', '作品契约/契约.md']).stdout?.trim()).not.toMatch(/^design:/)

    // 已确认：产生 design: 提交
    const confirmed = (await contractTool.execute({
      bookId: createRes.bookId,
      partName: '题材与读者定位', state: '已确认', content: '练气九层、筑基三阶。',
    })) as { ok: boolean }
    expect(confirmed.ok).toBe(true)
    const confirmedLog = git(['log', '-1', '--pretty=%s', '--', '作品契约/契约.md']).stdout?.trim()
    expect(confirmedLog).toMatch(/^design: /)
    expect(Number(count())).toBe(Number(afterTentative) + 1)

    // seed:整批一次 design: 提交
    const beforeSeed = count()
    const seedRes = (await seedTool.execute({ bookId: createRes.bookId })) as { ok: boolean }
    expect(seedRes.ok).toBe(true)
    expect(Number(count())).toBe(Number(beforeSeed) + 1)
    const seedShow = git(['show', '--name-only', '--pretty=format:', 'HEAD']).stdout?.split('\n').map((l) => l.trim()).filter((l) => l !== '')
    expect(seedShow?.length).toBeGreaterThan(1)
    expect(seedShow).toContain('大纲/故事骨架.md')

    // 重跑 seed:幂等,无新提交
    const seedReplay = (await seedTool.execute({ bookId: createRes.bookId })) as { ok: boolean }
    expect(seedReplay.ok).toBe(true)
    expect(Number(count())).toBe(Number(beforeSeed) + 1)
  })
})

describe('novel_editor_suggest', () => {
  function setup(intent: EditorIntent, text = '林舟在渡口停下。', requestId = 'polish1') {
    const hub = new EditorRequestHub()
    const agent = { id: 'main' }
    const snapshot: EditorRequestSnapshot = {
      requestId, intent, dirty: false, hash: 'abc', ref: { space: 'book:fog', path: '草稿区/草稿/稿1.md' },
      document: { owner: '雾港', path: '草稿区/草稿/稿1.md', space: 'book:fog', version: 1, absolutePath: 'D:/雾港/稿1.md' },
      selection: { text, line: 2, before: '前', after: '后' },
    }
    hub.open(agent, snapshot)
    const tool = createNovelTools({
      workspaceRoot: () => { throw new Error('不应读取书仓') },
      bookRootOfBookId: () => { throw new Error('不应读取书仓') },
      editorRequests: hub,
    }).find(item => item.name === 'novel_editor_suggest')!
    const run = (args: Record<string, unknown>) => tool.execute({ requestId, ...args }, { agent })
    return { hub, agent, tool, run }
  }

  it('按意图限制回复类型，批注引文必须逐字出现，超长与空文本被拒绝', async () => {
    const polish = setup('polish')
    expect(polish.tool.description).toContain('不要直接改写文件')
    expect(polish.tool.description).toContain('不得新增行动者、立场、动作或事实')
    expect(polish.tool.description).toContain('逐字摘自请求原文')
    expect(polish.tool.description).not.toContain('10-04')
    expect(await polish.run({ kind: 'insert', text: '续写。' })).toMatchObject({ ok: false, reason: '该意图只能回复 replace 或 none。' })
    expect(await polish.run({ kind: 'comments', comments: [{ quote: '林舟在渡口停下。', note: '问题' }] })).toMatchObject({ ok: false, reason: '该意图只能回复 replace 或 none。' })
    const replaced = await polish.run({ kind: 'replace', text: '林舟在渡口站定。', note: '更稳。' }) as { ok: boolean; message: string }
    expect(replaced).toMatchObject({ ok: true, delivered: true })
    expect(JSON.stringify(polish.tool.output.render({}, replaced))).toContain('已送到编辑器')

    const same = setup('polish', '林舟在渡口停下。', 'same001')
    expect(await same.run({ kind: 'replace', text: '林舟在渡口停下。' })).toMatchObject({ ok: true })
    expect(same.hub.view(same.agent, ['same001']).items[0]?.reply).toMatchObject({ kind: 'none', note: '与原文相同，无需改动。' })
    expect(await setup('polish', '有字', 'empty1').run({ kind: 'replace', text: '' })).toMatchObject({ ok: false, reason: expect.stringContaining('不能为空') })

    const original = '短'
    const limit = Math.min(original.length * 4 + 2000, 20000)
    expect(await setup('polish', original, 'long001').run({ kind: 'replace', text: '长'.repeat(limit) })).toMatchObject({ ok: true })
    expect(await setup('polish', original, 'long002').run({ kind: 'replace', text: '长'.repeat(limit + 1) })).toMatchObject({ ok: false, reason: expect.stringContaining('替换文本过长') })
    const capped = '原'.repeat(6000)
    expect(await setup('polish', capped, 'cap0002').run({ kind: 'replace', text: '改'.repeat(20001) })).toMatchObject({ ok: false, reason: expect.stringContaining('20000') })

    const review = setup('review', '林舟在渡口停下。潮声很近。', 'rev001')
    expect(await review.run({ kind: 'replace', text: '改写整段。' })).toMatchObject({ ok: false, reason: '审读只能回复 comments 或 none。' })
    expect(await review.run({ kind: 'comments', comments: [{ quote: '潮声很近。', note: '声音太满' }] })).toMatchObject({ ok: true })
    expect(await setup('review', '林舟在渡口停下。', 'rev002').run({ kind: 'comments', comments: [{ quote: '潮声很远。', note: '没有这句' }] })).toMatchObject({ ok: false, reason: expect.stringContaining('逐字出现') })
    expect(await setup('review', '林舟在渡口停下。', 'rev003').run({ kind: 'comments', comments: [] })).toMatchObject({ ok: false, reason: '审读批注需要 1 到 12 条。' })
    expect(await setup('review', '林舟在渡口停下。', 'rev004').run({ kind: 'comments', comments: Array.from({ length: 13 }, () => ({ quote: '林舟', note: '多' })) })).toMatchObject({ ok: false, reason: '审读批注需要 1 到 12 条。' })
    expect(await setup('review', '林舟在渡口停下。', 'rev005').run({ kind: 'comments', comments: [{ quote: '林舟', note: '啊'.repeat(301) }] })).toMatchObject({ ok: false, reason: expect.stringContaining('300') })
    expect(await setup('polish', '林舟在渡口停下。', 'note001').run({ kind: 'none', note: '啊'.repeat(201) })).toMatchObject({ ok: false, reason: expect.stringContaining('200') })

    const continued = setup('continue', '', 'cont001')
    expect(await continued.run({ kind: 'replace', text: '改前文。' })).toMatchObject({ ok: false, reason: '续写只能回复 insert 或 none。' })
    expect(await continued.run({ kind: 'insert', text: '他继续往前走。' })).toMatchObject({ ok: true })
    expect(await setup('continue', '', 'cont002').run({ kind: 'none' })).toMatchObject({ ok: true })
    expect(NOVEL_TOOL_NAMES).toContain('novel_editor_suggest')
  })

  it('取消、重复和未知编号返回明确原因', async () => {
    const { hub, agent, run } = setup('polish')
    expect(await run({ requestId: 'missing', kind: 'none' })).toMatchObject({ ok: false, reason: EDITOR_UNKNOWN_REASON })
    hub.cancel(agent, ['polish1'])
    expect(await run({ kind: 'replace', text: '改过。' })).toMatchObject({ ok: false, reason: EDITOR_CANCELLED_REASON })
    const second = setup('polish', '林舟在渡口停下。', 'again01')
    expect(await second.run({ kind: 'replace', text: '改过。' })).toMatchObject({ ok: true })
    expect(await second.run({ kind: 'none' })).toMatchObject({ ok: false, reason: EDITOR_DUPLICATE_REASON })
  })
})
