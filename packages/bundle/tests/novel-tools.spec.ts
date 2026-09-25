import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawnSync } from 'node:child_process'
import { createNovelTools, NOVEL_TEST_TOOL_NAMES, NOVEL_TOOL_NAMES } from '../src/novel-tools'
import { createBook, scanDesign } from '@webnovel/core'
import { nativeWriteStub } from './fixtures/native-write-stub'

const roots: string[] = []
function mkRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-tools-'))
  roots.push(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

describe('主 Agent 专用 Tools (方案 A)', () => {
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
    // seed 只写占位确认态:推导照常判开写就绪,另列出只有标注没有正文的分部(#165)
    const design = (statusRes as unknown as { design: { 建议: string; 已确认无内容?: string[] } }).design
    expect(design.建议).toBe('开写就绪')
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
