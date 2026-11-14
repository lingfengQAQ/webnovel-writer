import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { assertSupportedJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { isJsonValue } from '@deepseek-ai/dsh-util-values'
import * as core from '@webnovel/core'
import { removeSync } from '../../core/src/repo/remove'
import { createNovelTools, type NovelToolsDeps, type ToolExecContext } from '../src/novel-tools'

const roots: string[] = []
afterEach(() => vi.restoreAllMocks())
afterAll(() => { for (const root of roots) removeSync(root) })
const git = (root: string, ...args: string[]) => execFileSync('git', ['--no-optional-locks', '-c', 'core.quotepath=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()

function fixture(unversioned = true) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'book-upgrade-tools-'))
  roots.push(workspace)
  const book = core.createBook({ workspaceRoot: workspace, 书名: '升级测试', concept: { 状态: '已确认', 核心创意: '旧城寻找失散同伴', 题材与目标读者: '悬疑' } })
  if (!book.ok) throw new Error(book.reason)
  const contract = path.join(book.bookRoot, core.paths.契约())
  if (unversioned) {
    fs.writeFileSync(contract, fs.readFileSync(contract, 'utf8').replace(/^书仓格式版本: 1\r?\n/m, ''))
    git(book.bookRoot, 'add', '--', core.paths.契约()); git(book.bookRoot, 'commit', '--quiet', '-m', 'fixture: legacy format')
  }
  let current: string | undefined = book.bookRoot
  const ask = vi.fn<core.AskFn>(async request => ({ answers: request.questions.map(question => ({ id: question.id, selected: ['批准'] })) }))
  const deps: NovelToolsDeps = { workspaceRoot: () => workspace, bookRootOfBookId: id => id === book.bookId ? current : undefined, askFn: ask }
  const tools = createNovelTools(deps)
  const definition = (name: string) => tools.find(tool => tool.name === name)!
  const call = async (name: string, args: Record<string, unknown> = { bookId: book.bookId }, exec?: ToolExecContext) => {
    const tool = definition(name)
    const result = await tool.execute(args, exec)
    assertSupportedJsonSchema(tool.parameters)
    assertSupportedJsonSchema(tool.output.schema)
    expect(validateJsonSchemaValue(tool.output.schema, result), JSON.stringify(result)).toEqual([])
    return result as Record<string, unknown>
  }
  return { ...book, workspace, contract, ask, tools, call, definition, rebind: (root?: string) => { current = root } }
}

function bytes(root: string): Record<string, string> {
  const found: Record<string, string> = {}
  const walk = (relative: string) => {
    const target = path.join(root, relative), stat = fs.lstatSync(target)
    if (stat.isDirectory()) {
      found[relative + '/'] = 'directory'
      for (const name of fs.readdirSync(target).sort()) walk(relative ? `${relative}/${name}` : name)
    } else found[relative] = createHash('sha256').update(fs.readFileSync(target)).digest('hex')
  }
  walk('')
  return found
}

// The first case alone takes ~26-28 s on Windows (base v8 and this branch); 30 s flaked under full-suite load.
describe('整仓升级工具的预览与批准', { timeout: 90_000 }, () => {
  it('实际旧契约预览零写入，作者看到同一份完整差异，批准后一次提交', async () => {
    const f = fixture(), before = bytes(f.bookRoot), previousHead = git(f.bookRoot, 'rev-parse', 'HEAD')
    const preview = await f.call('novel_preview_book_upgrade')
    expect(preview).toMatchObject({ ok: true, state: 'ready', bookId: f.bookId, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(preview).toMatchObject({ inspectionBefore: { 书仓格式: { ok: false, kind: 'unversioned' } }, inspectionAfter: { 书仓格式: { ok: true, version: 1 } } })
    expect(preview).not.toHaveProperty('inspection')
    expect(bytes(f.bookRoot)).toEqual(before)
    expect(f.ask).not.toHaveBeenCalled()
    const exec = { agent: { id: 'upgrade-agent', session: { header: { id: 'upgrade-session' } } }, signal: new AbortController().signal, callId: 'upgrade-call', name: 'novel_apply_book_upgrade' }
    f.ask.mockImplementationOnce(async request => {
      expect(request.agent).toBe(exec.agent); expect(request.signal).toBe(exec.signal)
      expect(request.questions[0]?.id).toBe('书仓升级')
      const detail = request.questions[0]?.detail ?? ''
      expect(detail).toMatch(/^书id：[^\n]+\n\n`{3,}json\n/)
      expect(detail).toContain(String(preview.fingerprint))
      for (const change of preview.changes as core.UpgradeChange[]) {
        expect(detail).toContain(JSON.stringify(change.before)); expect(detail).toContain(JSON.stringify(change.after))
      }
      expect(fs.existsSync(path.join(f.bookRoot, '.webnovel/book.lock'))).toBe(false)
      expect(fs.existsSync(path.join(f.bookRoot, '.webnovel/writer.lock'))).toBe(false)
      return { answers: [{ id: '书仓升级', selected: ['批准'] }] }
    })
    const result = await f.call('novel_apply_book_upgrade', { bookId: f.bookId, fingerprint: preview.fingerprint }, exec)
    expect(result).toMatchObject({ ok: true, state: 'committed', operationId: preview.fingerprint })
    expect(git(f.bookRoot, 'rev-parse', 'HEAD')).not.toBe(previousHead)
    expect(git(f.bookRoot, 'diff', '--name-only', `${previousHead}..HEAD`)).toBe(core.paths.契约())
    expect(core.readBookFormatVersion(f.bookRoot)).toEqual({ ok: true, version: 1 })
    const after = bytes(f.bookRoot), replay = await f.call('novel_resume_book_upgrade', { bookId: f.bookId, operationId: result.operationId })
    expect(replay).toMatchObject({ ok: true, state: 'already-committed' })
    expect(f.ask).toHaveBeenCalledTimes(1)
    expect(bytes(f.bookRoot)).toEqual(after)
  }, 90_000)

  it.each(['unknown', 'dirty', 'locked'] as const)('整仓存在%s时不批准局部变换', async kind => {
    const f = fixture()
    if (kind === 'unknown') {
      const dir = path.join(f.bookRoot, '草稿区/批次/旧批次'); fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, '批次.json'), '{"schemaVersion":1}')
    } else if (kind === 'dirty') fs.appendFileSync(f.contract, '\n作者新写的说明。\n')
    else {
      const dir = path.join(f.bookRoot, '.webnovel'); fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'book.lock'), '{}')
    }
    const before = bytes(f.bookRoot), preview = await f.call('novel_preview_book_upgrade')
    expect(preview).toMatchObject({ ok: true, state: 'blocked', changes: [] })
    expect(preview.fingerprint).toBeUndefined()
    expect(await f.call('novel_apply_book_upgrade', { bookId: f.bookId, fingerprint: 'a'.repeat(64) })).toMatchObject({ ok: false, state: 'blocked' })
    expect(f.ask).not.toHaveBeenCalled(); expect(bytes(f.bookRoot)).toEqual(before)
  })

  it('章内合法工件保留在预览和作者批准内容中，不冒充已收尾', async () => {
    const f = fixture()
    const dir = path.join(f.bookRoot, '草稿区/草稿/卷01-正在写'); fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, '稿1.起草中.txt'), '保留未完成原文。')
    const before = bytes(f.bookRoot), preview = await f.call('novel_preview_book_upgrade')
    expect(preview).toMatchObject({ state: 'ready', activeWork: [{ 种类: '起草暂存' }] })
    f.ask.mockImplementationOnce(async request => {
      expect(request.questions[0]?.detail).toContain('保留未完工件')
      expect(request.questions[0]?.detail).toContain('暂停写作')
      return { answers: [{ id: '书仓升级', selected: ['退回'] }] }
    })
    expect(await f.call('novel_apply_book_upgrade', { bookId: f.bookId, fingerprint: preview.fingerprint })).toMatchObject({ code: 'author-declined' })
    expect(bytes(f.bookRoot)).toEqual(before)
  })

  // #213：宿主按无损 JSON 快照工具结果，值为 undefined 的键会让整条结果被拒收，作者看不到阻断原因。
  it.each([
    ['预览中途抛错', (f: ReturnType<typeof fixture>) => {
      const dir = path.join(f.bookRoot, '草稿区/.maintenance-receipts'); fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'unexpected.txt'), 'x')
    }, 'UPGRADE_PREVIEW_FAILED'],
    ['契约缺书id', (f: ReturnType<typeof fixture>) => {
      fs.writeFileSync(f.contract, fs.readFileSync(f.contract, 'utf8').replace(/^书id:.*\r?\n/m, ''))
      git(f.bookRoot, 'commit', '--quiet', '-am', 'fixture: no id')
    }, 'UPGRADE_BOOK_IDENTITY'],
  ] as const)('提前阻断（%s）仍以无损 JSON 呈报阻断原因', async (_name, setup, code) => {
    const f = fixture(); setup(f)
    const before = bytes(f.bookRoot), preview = await f.call('novel_preview_book_upgrade')
    expect(isJsonValue(preview), JSON.stringify(preview)).toBe(true)
    expect(preview).toMatchObject({ ok: true, state: 'blocked', changes: [], issues: [expect.objectContaining({ 代码: code })] })
    expect(preview).not.toHaveProperty('fingerprint')
    expect(bytes(f.bookRoot)).toEqual(before); expect(f.ask).not.toHaveBeenCalled()
  })

  it('工具出口剔除值为 undefined 的键，未来同类遗漏也不会被宿主拒收', async () => {
    const f = fixture()
    vi.spyOn(core, 'previewBookUpgrade').mockReturnValue({ ok: true, state: 'blocked', ruleVersion: 2, bookId: undefined, baseHead: undefined, changes: [], effects: [],
      issues: [{ 代码: 'UPGRADE_PREVIEW_FAILED', 路径: '.', 说明: '模拟阻断', 字段: undefined }], inspectionBefore: undefined, resumable: [] })
    const preview = await f.call('novel_preview_book_upgrade')
    expect(isJsonValue(preview), JSON.stringify(preview)).toBe(true)
    expect(preview).toStrictEqual({ maintenance: 'book-upgrade', ok: true, state: 'blocked', ruleVersion: 2, changes: [], effects: [],
      issues: [{ 代码: 'UPGRADE_PREVIEW_FAILED', 路径: '.', 说明: '模拟阻断' }], resumable: [], message: expect.any(String) })
  })

  it('未变化和过期指纹不发起作者问答', async () => {
    const current = fixture(false)
    expect(await current.call('novel_preview_book_upgrade')).toMatchObject({ ok: true, state: 'unchanged' })
    expect(await current.call('novel_apply_book_upgrade', { bookId: current.bookId, fingerprint: 'a'.repeat(64) })).toMatchObject({ ok: false })
    expect(current.ask).not.toHaveBeenCalled()
    const old = fixture(), before = bytes(old.bookRoot)
    expect(await old.call('novel_apply_book_upgrade', { bookId: old.bookId, fingerprint: 'a'.repeat(64) })).toMatchObject({ ok: false, code: 'approval-stale' })
    expect(old.ask).not.toHaveBeenCalled(); expect(bytes(old.bookRoot)).toEqual(before)
  })

  it.each(['退回', '其他意见'])('作者回答%s不授权任何写入', async selected => {
    const f = fixture(), preview = await f.call('novel_preview_book_upgrade'), before = bytes(f.bookRoot)
    f.ask.mockResolvedValueOnce({ answers: [{ id: '书仓升级', selected: [selected] }] })
    expect(await f.call('novel_apply_book_upgrade', { bookId: f.bookId, fingerprint: preview.fingerprint })).toMatchObject({ ok: false, code: 'author-declined' })
    expect(bytes(f.bookRoot)).toEqual(before)
  })

  it('批准等待时原文件变化，保留后来字节并拒绝旧批准', async () => {
    const f = fixture(), preview = await f.call('novel_preview_book_upgrade')
    let changed: Record<string, string> | undefined
    f.ask.mockImplementationOnce(async () => {
      fs.appendFileSync(f.contract, '\n等待期间作者写下的文字。\n'); changed = bytes(f.bookRoot)
      return { answers: [{ id: '书仓升级', selected: ['批准'] }] }
    })
    expect(await f.call('novel_apply_book_upgrade', { bookId: f.bookId, fingerprint: preview.fingerprint })).toMatchObject({ ok: false, code: 'UPGRADE_STALE' })
    expect(bytes(f.bookRoot)).toEqual(changed)
  })

  it('作者问答之后书id改绑，拒绝改写原书和新书', async () => {
    const f = fixture(), other = fixture(), preview = await f.call('novel_preview_book_upgrade')
    const before = bytes(f.bookRoot), otherBefore = bytes(other.bookRoot)
    f.ask.mockImplementationOnce(async () => {
      f.rebind(other.bookRoot)
      return { answers: [{ id: '书仓升级', selected: ['批准'] }] }
    })
    expect(await f.call('novel_apply_book_upgrade', { bookId: f.bookId, fingerprint: preview.fingerprint })).toMatchObject({ ok: false, code: 'approval-stale' })
    expect(bytes(f.bookRoot)).toEqual(before); expect(bytes(other.bookRoot)).toEqual(otherBefore)
  })

  it('迟到批准不能跨越取消；预取消不触发定位与问答', async () => {
    const f = fixture(), preview = await f.call('novel_preview_book_upgrade'), before = bytes(f.bookRoot)
    const controller = new AbortController()
    let resolve!: (value: core.AskResponse) => void
    f.ask.mockImplementationOnce(async () => new Promise(answer => { resolve = answer }))
    const pending = f.call('novel_apply_book_upgrade', { bookId: f.bookId, fingerprint: preview.fingerprint }, { signal: controller.signal })
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, code: 'author-cancelled' })
    resolve({ answers: [{ id: '书仓升级', selected: ['批准'] }] })
    await Promise.resolve()
    expect(bytes(f.bookRoot)).toEqual(before)
    expect(await f.call('novel_preview_book_upgrade', { bookId: f.bookId }, { signal: controller.signal })).toMatchObject({ ok: false, code: 'author-cancelled' })
    expect(f.ask).toHaveBeenCalledTimes(1)
  })

  it('参数和输出 schema 闭合，不接受自填批准或任意目标', async () => {
    const f = fixture(), before = bytes(f.bookRoot)
    const previewSpy = vi.spyOn(core, 'previewBookUpgrade'), resumeSpy = vi.spyOn(core, 'previewBookUpgradeResume')
    for (const name of ['novel_preview_book_upgrade', 'novel_apply_book_upgrade', 'novel_resume_book_upgrade']) {
      const args = name.includes('apply') ? { bookId: f.bookId, fingerprint: 'a'.repeat(64) } : name.includes('resume') ? { bookId: f.bookId, operationId: 'a'.repeat(64) } : { bookId: f.bookId }
      for (const extra of [{ approved: true }, { paths: [f.contract] }, { content: '覆盖' }, { partial: true }]) expect(await f.call(name, { ...args, ...extra })).toMatchObject({ ok: false, code: 'invalid-argument' })
    }
    expect(previewSpy).not.toHaveBeenCalled(); expect(resumeSpy).not.toHaveBeenCalled()
    expect(f.ask).not.toHaveBeenCalled(); expect(bytes(f.bookRoot)).toEqual(before)
  })

  it('升级计划的作者原文不能关闭代码围栏，呈报仍可无损还原', async () => {
    const f = fixture(), fingerprint = 'a'.repeat(64), before = bytes(f.bookRoot)
    const original = '原文\r\n``````\n# 正文标题\u2028```\n尾部  '
    const target = '目标\n```````json\n[作者扩展]\n'
    vi.spyOn(core, 'previewBookUpgrade').mockReturnValue({ ok: true, state: 'ready', bookId: f.bookId, fingerprint, ruleVersion: 2, changes: [{ relPath: core.paths.契约(), before: original, after: target, rules: ['C6-v1'], evidence: ['测试原始表示'] }], effects: [], issues: [], resumable: [] })
    f.ask.mockImplementationOnce(async request => {
      const detail = request.questions[0]?.detail ?? ''
      const lines = detail.split('\n'), fence = lines[2]!.replace(/json$/, '')
      expect(lines[0]).toBe(`书id：${f.bookId}`)
      expect(lines[1]).toBe('')
      expect(fence.length).toBeGreaterThan(7)
      expect(lines.at(-1)).toBe(fence)
      const presented = JSON.parse(lines.slice(3, -1).join('\n'))
      expect(presented.文件差异[0]).toMatchObject({ 原文: original, 目标: target })
      return { answers: [{ id: '书仓升级', selected: ['退回'] }] }
    })
    expect(await f.call('novel_apply_book_upgrade', { bookId: f.bookId, fingerprint })).toMatchObject({ ok: false, code: 'author-declined' })
    expect(bytes(f.bookRoot)).toEqual(before)
  })
})

describe('维护收据续办接线', { timeout: 90_000 }, () => {
  it('真实提交失败后新工具实例按原编号请求续办，只补一次提交', async () => {
    const f = fixture()
    git(f.bookRoot, 'config', 'core.hooksPath', '.git/hooks')
    const hook = path.join(f.bookRoot, '.git/hooks/pre-commit')
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    const preview = await f.call('novel_preview_book_upgrade'), head = git(f.bookRoot, 'rev-parse', 'HEAD')
    const failed = await f.call('novel_apply_book_upgrade', { bookId: f.bookId, fingerprint: preview.fingerprint })
    expect(failed).toMatchObject({ ok: false, state: 'written-pending-commit', operationId: preview.fingerprint })
    expect(git(f.bookRoot, 'rev-parse', 'HEAD')).toBe(head)
    const contractBytes = fs.readFileSync(f.contract, 'utf8')
    fs.unlinkSync(hook)
    const ask = vi.fn<core.AskFn>(async request => {
      expect(request.questions[0]?.id).toBe('书仓升级续办')
      expect(request.questions[0]?.detail).toContain(String(failed.operationId))
      expect(request.questions[0]?.detail).toContain('核对已落盘批次')
      expect(request.questions[0]?.detail).toContain('不重新转换')
      expect(request.questions[0]?.detail).toContain(createHash('sha256').update(contractBytes).digest('hex'))
      expect(request.questions[0]?.detail).toContain('受影响工件')
      return { answers: [{ id: '书仓升级续办', selected: ['批准'] }] }
    })
    const tools = createNovelTools({ workspaceRoot: () => f.workspace, bookRootOfBookId: id => id === f.bookId ? f.bookRoot : undefined, askFn: ask })
    const resumed = await tools.find(tool => tool.name === 'novel_resume_book_upgrade')!.execute({ bookId: f.bookId, operationId: failed.operationId })
    expect(resumed).toMatchObject({ ok: true, state: 'committed' })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(fs.readFileSync(f.contract, 'utf8')).toBe(contractBytes)
    expect(git(f.bookRoot, 'rev-list', '--count', `${head}..HEAD`)).toBe('1')
    // This case performs complete Git-backed previews, an actual hook failure
    // and a new tool instance's continuation. Match the other process-heavy
    // maintenance cases' bounded Windows allowance; all state assertions stay.
  }, 90_000)

  it('未知收据和作者后改输出不询问批准，也不覆盖文件', async () => {
    const f = fixture(), before = bytes(f.bookRoot)
    expect(await f.call('novel_resume_book_upgrade', { bookId: f.bookId, operationId: 'a'.repeat(64) })).toMatchObject({ ok: false, state: 'blocked' })
    expect(f.ask).not.toHaveBeenCalled(); expect(bytes(f.bookRoot)).toEqual(before)
    const preview = await f.call('novel_preview_book_upgrade')
    const result = await f.call('novel_apply_book_upgrade', { bookId: f.bookId, fingerprint: preview.fingerprint })
    expect(result.ok).toBe(true)
    fs.appendFileSync(f.contract, '\n升级后作者新增。\n')
    const changed = bytes(f.bookRoot)
    expect(await f.call('novel_resume_book_upgrade', { bookId: f.bookId, operationId: result.operationId })).toMatchObject({ ok: false, state: 'blocked' })
    expect(f.ask).toHaveBeenCalledTimes(1); expect(bytes(f.bookRoot)).toEqual(changed)
  }, 90_000)
})
