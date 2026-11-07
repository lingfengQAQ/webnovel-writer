import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { assertSupportedJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import * as core from '@webnovel/core'
import { removeSync } from '../../core/src/repo/remove'
import { createNovelTools, type ToolExecContext } from '../src/novel-tools'
import * as statusService from '../src/story-status'
import { MAINTENANCE_OUTPUT } from '../src/maintenance-output'

const roots: string[] = []
afterEach(() => vi.restoreAllMocks())
afterAll(() => { for (const root of roots) removeSync(root) })

function fixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'opening-tools-'))
  roots.push(workspace)
  const created = core.createBook({ workspaceRoot: workspace, 书名: '只读开章', concept: { 状态: '已确认', 核心创意: '寻找故人', 题材与目标读者: '悬疑' } })
  if (!created.ok) throw new Error(created.reason)
  const writes = vi.fn(), asks = vi.fn(), indexManage = vi.fn()
  const tools = createNovelTools({ workspaceRoot: () => workspace, bookRootOfBookId: id => id === created.bookId ? created.bookRoot : undefined, nativeWrite: writes, askFn: asks, indexManage })
  const call = (name: string, args: Record<string, unknown> = { bookId: created.bookId }, context?: ToolExecContext) => tools.find(tool => tool.name === name)!.execute(args, context)
  return { ...created, tools, call, writes, asks, indexManage }
}

function filesystem(root: string): Record<string, string> {
  const result: Record<string, string> = {}
  const visit = (relative: string) => {
    const absolute = path.join(root, relative), stat = fs.lstatSync(absolute)
    if (stat.isDirectory()) {
      result[relative + '/'] = 'directory'
      for (const name of fs.readdirSync(absolute).sort()) visit(relative ? `${relative}/${name}` : name)
    } else if (stat.isSymbolicLink()) result[relative] = `link:${fs.readlinkSync(absolute)}`
    else result[relative] = createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')
  }
  visit('')
  return result
}

const snapshot = { 开始时间: '2026-10-31T00:00:00Z', 结束时间: '2026-10-31T00:00:00Z', 指纹: 'test-snapshot', 稳定: true, 文件数: 1, 目录数: 1, 变更: [] }
const healthy = (): core.BookInspection => ({ 状态: '已检查', 结论: '未发现已知问题', 书仓格式: { ok: true, version: 1 }, 规则版本: 1, 受检范围: [], 未检范围: [], 类型覆盖: [], 问题: [], 快照: snapshot })
const ready = (): core.ChapterOpeningInspection => ({ 状态: '边界已核对', 规则版本: 1, 问题: [], 在途项: [], 快照: snapshot })
const issue = { 代码: 'TEST_PENDING', 路径: '草稿区/草稿/卷01-未完/稿1.起草中.txt', 说明: '存在未收尾暂存' }

function checkSchema(value: unknown) {
  assertSupportedJsonSchema(MAINTENANCE_OUTPUT.schema)
  expect(validateJsonSchemaValue(MAINTENANCE_OUTPUT.schema, value)).toEqual([])
}

describe('只读检查与开章工具的实际接线', () => {
  it('新书正常开章只读取，重复调用不生成runtime、Git变更或章节', async () => {
    const f = fixture()
    removeSync(path.join(f.bookRoot, '.webnovel'))
    const before = filesystem(f.bookRoot)
    expect(fs.existsSync(path.join(f.bookRoot, '.webnovel'))).toBe(false)
    const inspect = vi.spyOn(core, 'inspectBookDocuments')
    const opening = vi.spyOn(core, 'inspectChapterOpening')
    const status = vi.spyOn(statusService, 'readStoryStatus')
    for (let count = 0; count < 2; count++) {
      const result = await f.call('novel_begin_chapter')
      expect(result).toMatchObject({ ok: true, 状态读取: { ok: true }, 开章核对: { 状态: '边界已核对' }, 书仓检查: { 状态: '已检查', 结论: '未发现已知问题' } })
      checkSchema(result)
    }
    expect(inspect).toHaveBeenCalledTimes(2)
    expect(opening).toHaveBeenCalledTimes(4)
    expect(status).toHaveBeenCalledTimes(2)
    expect(filesystem(f.bookRoot)).toEqual(before)
    expect(f.writes).not.toHaveBeenCalled(); expect(f.asks).not.toHaveBeenCalled(); expect(f.indexManage).not.toHaveBeenCalled()
  })

  it('普通状态保持原事实与审核哈希，不进入任何维护检查', async () => {
    const f = fixture(), before = filesystem(f.bookRoot)
    const selection = core.selectCurrentVolume(f.bookRoot)
    const derived = core.deriveDesign(core.scanDesign(f.bookRoot, selection.kind === 'active' ? selection.卷 : selection.kind === 'planning' ? selection.规划卷 : 1))
    const empty = core.listConfirmedEmpty(core.scanDesignDetail(f.bookRoot))
    const diagnostic = core.diagnoseBookRuntime(f.bookRoot)
    const expected = {
      ok: true, bookId: f.bookId, design: empty.length === 0 ? derived : { ...derived, 已确认无内容: empty },
      chapters: core.listResumable(f.bookRoot).map(r => ({ key: r.key, 建议: r.derived.建议, 事实项: r.derived.事实项, 叠加标记: r.derived.叠加标记, statusCard: core.renderStatusCard(f.bookRoot, r.key), ...(r.facts.审核记录哈希 === undefined ? {} : { 审核记录哈希: r.facts.审核记录哈希 }) })),
      ...(diagnostic.length === 0 ? {} : { 书仓诊断: diagnostic }),
    }
    const inspect = vi.spyOn(core, 'inspectBookDocuments'), opening = vi.spyOn(core, 'inspectChapterOpening')
    expect(await f.call('novel_get_story_status')).toEqual(expected)
    expect(inspect).not.toHaveBeenCalled(); expect(opening).not.toHaveBeenCalled()
    expect(filesystem(f.bookRoot)).toEqual(before)
    const value = { design: expected.design, chapters: [{ key: { 卷: 1, 章: 1, 章名: '待改' }, 建议: '改稿' as const, 事实项: [], 叠加标记: [], statusCard: '待改', 审核记录哈希: 'fresh-review-hash' }] }
    vi.spyOn(statusService, 'readStoryStatus').mockReturnValue(value)
    expect(await f.call('novel_get_story_status')).toEqual({ ok: true, bookId: f.bookId, ...value })
    expect(inspect).not.toHaveBeenCalled(); expect(opening).not.toHaveBeenCalled()
  })

  it('新章只有起草中暂存时转恢复；主动检查仍可报告，不删除暂存', async () => {
    const f = fixture()
    const dir = path.join(f.bookRoot, '草稿区/草稿/卷01-未完')
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, '稿1.起草中.txt'), '尚未写完。')
    const before = filesystem(f.bookRoot), inspect = vi.spyOn(core, 'inspectBookDocuments')
    const begun = await f.call('novel_begin_chapter')
    expect(begun).toMatchObject({ ok: true, 开章核对: { 状态: '需恢复' }, 书仓检查: { 状态: '未检查' } })
    expect(inspect).not.toHaveBeenCalled()
    checkSchema(begun)
    const manual = await f.call('novel_check_book')
    expect(manual).toMatchObject({ ok: true, 书仓检查: { 规则版本: 1 } })
    expect(inspect).toHaveBeenCalledTimes(1)
    checkSchema(manual)
    expect(filesystem(f.bookRoot)).toEqual(before)
  })

  it('每次手动检查读取当前格式，旧/未来标记不被补写或当健康', async () => {
    const f = fixture(), contract = path.join(f.bookRoot, '作品契约/契约.md')
    const initial = fs.readFileSync(contract, 'utf8')
    for (const value of [initial.replace(/书仓格式版本: 1\r?\n/, ''), initial.replace('书仓格式版本: 1', '书仓格式版本: 99')]) {
      fs.writeFileSync(contract, value)
      const before = filesystem(f.bookRoot), result = await f.call('novel_check_book')
      expect(result).toMatchObject({ ok: true, 书仓检查: { 书仓格式: { ok: false } } })
      expect((result as { 待核对: string[] }).待核对.length).toBeGreaterThan(0)
      checkSchema(result)
      expect(filesystem(f.bookRoot)).toEqual(before)
    }
  })

  it.each(['draft', 'transaction'])('文档检查后新增%s，末端复验不沿用旧开章边界', async kind => {
    const f = fixture(), original = core.inspectBookDocuments
    vi.spyOn(core, 'inspectBookDocuments').mockImplementation(root => {
      const result = original(root)
      const target = kind === 'draft' ? '草稿区/草稿/卷01-后来开写/稿1.起草中.txt' : '.webnovel/transactions/inflight/manifest.json'
      const absolute = path.join(root, target)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, kind === 'draft' ? '其他写入者新建暂存。' : '{}')
      return result
    })
    const result = await f.call('novel_begin_chapter') as { 开章核对: { 状态: string }; 待核对: string[] }
    expect(result.开章核对.状态).not.toBe('边界已核对')
    expect(result.待核对.length).toBeGreaterThan(0)
    checkSchema(result)
  })
})

describe('只读入口的分域错误与取消', () => {
  it.each(['novel_check_book', 'novel_begin_chapter'])('%s 严格只收明确书id，失败时不读其他范围', async name => {
    const f = fixture(), inspect = vi.spyOn(core, 'inspectBookDocuments'), opening = vi.spyOn(core, 'inspectChapterOpening')
    for (const args of [{}, { bookId: '' }, { bookId: 1 }, { bookId: f.bookId, path: f.bookRoot }, { bookId: f.bookId, approved: true }, { bookId: f.bookId, 章: 1 }, { bookId: 'missing' }]) {
      const result = await f.call(name, args)
      expect(result).toMatchObject({ ok: false, reason: expect.any(String), code: expect.any(String), next: expect.any(String) })
      checkSchema(result)
    }
    expect(inspect).not.toHaveBeenCalled(); expect(opening).not.toHaveBeenCalled()
  })

  it('安全定位失败不接受绝对路径兜底，不吞掉身份错误', async () => {
    const tools = createNovelTools({ workspaceRoot: () => undefined, bookRootOfBookId: () => { throw new Error('书id重复') } })
    for (const name of ['novel_check_book', 'novel_begin_chapter']) {
      expect(await tools.find(tool => tool.name === name)!.execute({ bookId: 'duplicate' })).toMatchObject({ ok: false, code: 'book-not-found', reason: expect.stringContaining('书id重复') })
    }
  })

  it.each(['需恢复', '无法核实'] as const)('开章%s保留状态但不伪造全仓检查', async state => {
    const f = fixture(), inspect = vi.spyOn(core, 'inspectBookDocuments')
    vi.spyOn(core, 'inspectChapterOpening').mockReturnValue({ ...ready(), 状态: state, 问题: [issue], 在途项: [{ 路径: issue.路径, 种类: '起草暂存', 说明: issue.说明 }] })
    const result = await f.call('novel_begin_chapter')
    expect(result).toMatchObject({ ok: true, 状态读取: { ok: true }, 开章核对: { 状态: state }, 书仓检查: { 状态: '未检查' }, 待核对: expect.arrayContaining([issue.说明]) })
    expect(inspect).not.toHaveBeenCalled(); checkSchema(result)
  })

  it('状态读取异常不擦掉独立诊断；检查异常也保留已得状态', async () => {
    const f = fixture()
    vi.spyOn(core, 'inspectChapterOpening').mockReturnValue(ready())
    const inspect = vi.spyOn(core, 'inspectBookDocuments').mockReturnValue({ ...healthy(), 结论: '需处理', 问题: [issue] })
    const status = vi.spyOn(statusService, 'readStoryStatus').mockImplementation(() => { throw new Error('状态资料不可读') })
    const first = await f.call('novel_begin_chapter')
    expect(first).toMatchObject({ ok: true, 状态读取: { ok: false, reason: expect.stringContaining('状态资料不可读') }, 书仓检查: { 结论: '需处理' } })
    checkSchema(first)
    status.mockRestore()
    inspect.mockImplementation(() => { throw new Error('目录枚举失败') })
    const second = await f.call('novel_begin_chapter')
    expect(second).toMatchObject({ ok: true, 状态读取: { ok: true }, 开章核对: { 状态: '边界已核对' }, 书仓检查: { 状态: '部分失败', 原因: expect.stringContaining('目录枚举失败') } })
    checkSchema(second)
  })

  it('开章证据读取异常是无法核实，不转成空在途或健康', async () => {
    const f = fixture(), inspect = vi.spyOn(core, 'inspectBookDocuments')
    vi.spyOn(core, 'inspectChapterOpening').mockImplementation(() => { throw new Error('收据不可读') })
    const result = await f.call('novel_begin_chapter')
    expect(result).toMatchObject({ ok: true, 开章核对: { 状态: '无法核实', 原因: expect.stringContaining('收据不可读') }, 书仓检查: { 状态: '未检查' } })
    expect(inspect).not.toHaveBeenCalled(); checkSchema(result)
  })

  it('两个各自稳定但指纹不同的开章快照不能组合为通过', async () => {
    const f = fixture()
    vi.spyOn(core, 'inspectBookDocuments').mockReturnValue(healthy())
    vi.spyOn(core, 'inspectChapterOpening').mockReturnValueOnce(ready()).mockReturnValue({ ...ready(), 快照: { ...snapshot, 指纹: 'changed' } })
    const result = await f.call('novel_begin_chapter')
    expect(result).toMatchObject({ ok: true, 开章核对: { 状态: '无法核实', 快照: { 稳定: false }, 问题: [expect.objectContaining({ 代码: 'opening-snapshot-changed' })] } })
    checkSchema(result)
  })

  it.each(['novel_check_book', 'novel_begin_chapter'])('%s 预取消不继续定位或检查', async name => {
    const resolve = vi.fn(), inspect = vi.spyOn(core, 'inspectBookDocuments'), opening = vi.spyOn(core, 'inspectChapterOpening')
    const tools = createNovelTools({ workspaceRoot: () => undefined, bookRootOfBookId: resolve })
    const controller = new AbortController(); controller.abort()
    const result = await tools.find(tool => tool.name === name)!.execute({ bookId: 'cancelled' }, { signal: controller.signal })
    expect(result).toMatchObject({ ok: false, code: 'author-cancelled' }); checkSchema(result)
    expect(resolve).not.toHaveBeenCalled(); expect(inspect).not.toHaveBeenCalled(); expect(opening).not.toHaveBeenCalled()
  })

  it('核对中取消后不读取状态或全仓检查，也不将已读结果报告成功', async () => {
    const f = fixture(), controller = new AbortController()
    vi.spyOn(core, 'inspectChapterOpening').mockImplementation(() => { controller.abort(); return ready() })
    const inspect = vi.spyOn(core, 'inspectBookDocuments'), status = vi.spyOn(statusService, 'readStoryStatus')
    const result = await f.call('novel_begin_chapter', { bookId: f.bookId }, { signal: controller.signal })
    expect(result).toMatchObject({ ok: false, code: 'author-cancelled', 开章核对: { 状态: '边界已核对' } })
    expect(inspect).not.toHaveBeenCalled(); expect(status).not.toHaveBeenCalled(); checkSchema(result)
  })
})
