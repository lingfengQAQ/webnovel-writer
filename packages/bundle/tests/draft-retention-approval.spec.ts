import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { assertSupportedJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { isJsonValue } from '@deepseek-ai/dsh-util-values'
import * as core from '@webnovel/core'
import { listArchiveReceipts } from '../../core/src/commit/receipt'
import { removeSync } from '../../core/src/repo/remove'
import { createNovelTools, type ToolExecContext } from '../src/novel-tools'

const roots: string[] = []
const key = { 卷: 1, 章: 1, 章名: '渡口' }
const git = (root: string, ...args: string[]) => execFileSync('git', ['--no-optional-locks', '-c', 'core.quotepath=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
afterEach(() => vi.restoreAllMocks())
afterAll(() => { for (const root of roots) removeSync(root) })

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

function fixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-approval-')); roots.push(workspace)
  const book = core.createBook({ workspaceRoot: workspace, 书名: '留档确认', concept: { 状态: '已确认', 核心创意: '抵达旧渡口', 题材与目标读者: '悬疑' } })
  if (!book.ok) throw new Error(book.reason)
  const put = (relative: string, text: string) => { fs.mkdirSync(path.dirname(path.join(book.bookRoot, relative)), { recursive: true }); fs.writeFileSync(path.join(book.bookRoot, relative), text) }
  const read = (relative: string) => fs.readFileSync(path.join(book.bookRoot, relative), 'utf8')
  const draftDir = core.paths.草稿目录(key.卷, key.章名)
  const source = `${draftDir}/稿1.md`, staging = `${draftDir}/稿1.起草中.txt`, risk = `${draftDir}/稿2.md`
  put(source, core.serializeDocument({ 身份: key, 角色: '待审稿', 选定: true, 版本: 1, 父版本: null }, '林舟到达渡口，查验旧船票。'))
  put(staging, '林舟到达渡口，尚未写完的开头。')
  put(risk, core.serializeDocument({ 身份: key, 角色: '草稿', 选定: false, 版本: 2, 父版本: 1, 生成模块: '润色' }, '未选用且可能改变事实的风险稿。'))
  let current: string | undefined = book.bookRoot
  const ask = vi.fn<core.AskFn>(async request => ({ answers: request.questions.map(question => ({ id: question.id, selected: ['批准'] })) }))
  const locate = vi.fn((id: string) => id === book.bookId ? current : undefined)
  const tools = createNovelTools({ workspaceRoot: () => workspace, bookRootOfBookId: locate, askFn: ask })
  const args = { bookId: book.bookId, ...key }
  const definition = (name: string) => tools.find(tool => tool.name === name)!
  const call = async (name: string, params: Record<string, unknown> = args, exec?: ToolExecContext) => {
    const tool = definition(name), result = await tool.execute(params, exec)
    assertSupportedJsonSchema(tool.parameters); assertSupportedJsonSchema(tool.output.schema)
    expect(isJsonValue(result), JSON.stringify(result)).toBe(true)
    expect(validateJsonSchemaValue(tool.output.schema, result), JSON.stringify(result)).toEqual([])
    return result as Record<string, unknown>
  }
  const prepare = () => {
    const result = core.preparePack(book.bookRoot, key)
    expect(result.ok, result.reason).toBe(true)
    return result.dir
  }
  const legacy = () => {
    const final = core.paths.定稿章(key.卷, key.章, key.章名), summary = core.paths.章摘要(key.卷, key.章, key.章名)
    const parsed = core.parseDocument(read(source))
    if (!parsed.ok) throw new Error(parsed.detail)
    put(final, core.serializeDocument({ 身份: key, 状态: '已定稿', 章号: key.章, 版本: 1, 父版本: null, 生成模块: '定稿入档', 恢复信息: { 来源草稿: source }, 来源快照: { 来源草稿: source } }, parsed.data.body))
    put(summary, '# 章摘要\n\n林舟抵达渡口。\n')
    git(book.bookRoot, 'add', '--', final, summary); git(book.bookRoot, 'commit', '--quiet', '-m', 'ch: historical chapter')
    return { final, summary }
  }
  return { ...book, workspace, put, read, source, staging, risk, draftDir, ask, locate, args, definition, call, prepare, legacy, rebind: (root?: string) => { current = root } }
}

describe('定稿与留档使用同一次真实作者裁决', { timeout: 30_000 }, () => {
  it('准备前半稿和未选风险稿在同一次问答中完整呈报，批准后可核对开章', async () => {
    const f = fixture(), packageDir = f.prepare(), originals = [f.source, f.staging, f.risk].map(f.read)
    const manifest = JSON.parse(f.read(`${packageDir}/清单.json`))['草稿留档'] as core.DraftRetentionManifest
    f.ask.mockImplementationOnce(async request => {
      expect(request.questions).toHaveLength(1)
      const question = request.questions[0]!, detail = question.detail!
      expect(question.id).toBe('定稿入档')
      const review = JSON.parse(detail.slice(detail.indexOf('json\n') + 5, detail.lastIndexOf('\n```')))
      expect(review.来源稿).toBe(f.source); expect(review.草稿留档).toEqual(manifest.files)
      expect(detail).toContain('同次确认')
      expect(fs.existsSync(path.join(f.bookRoot, '.webnovel/book.lock'))).toBe(false)
      return { answers: [{ id: '定稿入档', selected: ['批准'] }] }
    })
    expect(await f.call('novel_settle_chapter', { ...f.args, summary: '本章完成' })).toMatchObject({ ok: true })
    expect(f.ask).toHaveBeenCalledTimes(1)
    expect([f.source, f.staging, f.risk].map(f.read)).toEqual(originals)
    expect(git(f.bookRoot, 'status', '--porcelain')).toBe('')
    const opening = core.inspectChapterOpening(f.bookRoot)
    expect(opening.状态, JSON.stringify(opening)).toBe('边界已核对')
  })

  it.each(['new', 'changed', 'missing', 'old-package'] as const)('准备后的%s在问答前拒绝，不刷新批准清单', async kind => {
    const f = fixture(), packageDir = f.prepare()
    if (kind === 'new') f.put(`${f.draftDir}/稿3.起草中.txt`, '新写的开头。')
    if (kind === 'changed') fs.appendFileSync(path.join(f.bookRoot, f.risk), '\n后来改写。')
    if (kind === 'missing') fs.unlinkSync(path.join(f.bookRoot, f.staging))
    if (kind === 'old-package') {
      const manifest = JSON.parse(f.read(`${packageDir}/清单.json`)); delete manifest['草稿留档']
      f.put(`${packageDir}/清单.json`, JSON.stringify(manifest))
    }
    const before = bytes(f.bookRoot)
    expect(await f.call('novel_settle_chapter', { ...f.args, summary: '待核对' })).toMatchObject({ ok: false, code: 'source-conflict' })
    expect(f.ask).not.toHaveBeenCalled(); expect(bytes(f.bookRoot)).toEqual(before)
  })

  it('提交中断后缺失非来源稿，在问答前提供精确人工恢复指引并可用开章入口核对结果', async () => {
    const f = fixture(); f.prepare()
    git(f.bookRoot, 'config', 'core.hooksPath', '.git/hooks')
    const hook = path.join(f.bookRoot, '.git/hooks/pre-commit')
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n'); fs.chmodSync(hook, 0o755)
    const args = { ...f.args, summary: '本章完成' }
    expect(await f.call('novel_settle_chapter', args)).toMatchObject({ ok: false, code: 'partial-commit' })
    const receipt = listArchiveReceipts(f.bookRoot)[0]!
    fs.unlinkSync(path.join(f.bookRoot, f.risk))
    f.ask.mockClear()
    const before = bytes(f.bookRoot), retry = await f.call('novel_settle_chapter', args)
    expect(retry).toMatchObject({ ok: false, code: 'source-conflict', reason: expect.stringContaining('非来源留档已缺失'), next: expect.stringContaining('一次性手动提交') })
    for (const output of receipt.outputs) expect(retry.next).toContain(output.relPath)
    expect(retry.next).toContain(`${receipt.scope}.json`)
    expect(retry.next).toContain('模型不要执行 Git 写入')
    expect(retry.next).toContain('novel_begin_chapter')
    expect(f.ask).not.toHaveBeenCalled()
    expect(bytes(f.bookRoot)).toEqual(before)
    fs.unlinkSync(hook)
    git(f.bookRoot, '--literal-pathspecs', 'commit', '--only', '--quiet', '-m', '作者核对原收据后一次补交', '--', ...receipt.outputs.map(output => output.relPath))
    const head = git(f.bookRoot, 'rev-parse', 'HEAD')
    const verified = await f.call('novel_begin_chapter', { bookId: f.bookId })
    expect(verified).toMatchObject({ ok: true, 开章核对: { 状态: '边界已核对', 问题: [] } })
    expect(git(f.bookRoot, 'rev-parse', 'HEAD')).toBe(head)
    expect(listArchiveReceipts(f.bookRoot)).toEqual([receipt])
  }, 60_000)

  it('缺稿同时存在输出冲突时，预检保留证据且不提供手动补交建议', async () => {
    const f = fixture(); f.prepare()
    git(f.bookRoot, 'config', 'core.hooksPath', '.git/hooks')
    const hook = path.join(f.bookRoot, '.git/hooks/pre-commit')
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n'); fs.chmodSync(hook, 0o755)
    const args = { ...f.args, summary: '本章完成' }
    expect(await f.call('novel_settle_chapter', args)).toMatchObject({ ok: false, code: 'partial-commit' })
    fs.unlinkSync(path.join(f.bookRoot, f.risk))
    const output = core.paths.定稿章(key.卷, key.章, key.章名)
    fs.appendFileSync(path.join(f.bookRoot, output), '\n作者后来改过。')
    f.ask.mockClear()
    const before = bytes(f.bookRoot), retry = await f.call('novel_settle_chapter', args)
    expect(retry).toMatchObject({ ok: false, code: 'source-conflict', reason: expect.stringContaining('目标冲突'), next: expect.stringContaining('不要重新准备') })
    expect(retry.next).not.toContain('一次性手动提交')
    expect(f.ask).not.toHaveBeenCalled()
    expect(bytes(f.bookRoot)).toEqual(before)
  })

  it.each(['source', 'new'] as const)('等待批准时%s变化使旧批准失效，后来字节保留', async kind => {
    const f = fixture(); f.prepare()
    const initialHead = git(f.bookRoot, 'rev-parse', 'HEAD')
    f.ask.mockImplementationOnce(async () => {
      if (kind === 'source') fs.appendFileSync(path.join(f.bookRoot, f.source), '\n作者等待期间改写。')
      else f.put(`${f.draftDir}/稿3.起草中.txt`, '等待时出现的新稿。')
      return { answers: [{ id: '定稿入档', selected: ['批准'] }] }
    })
    const result = await f.call('novel_settle_chapter', { ...f.args, summary: '本章' })
    expect(result).toMatchObject({ ok: false, code: 'approval-stale' })
    expect(fs.existsSync(path.join(f.bookRoot, core.paths.定稿章(1, 1, key.章名)))).toBe(false)
    expect(git(f.bookRoot, 'rev-parse', 'HEAD')).toBe(initialHead)
    expect(f.read(kind === 'source' ? f.source : `${f.draftDir}/稿3.起草中.txt`)).toContain(kind === 'source' ? '作者等待期间改写' : '等待时出现的新稿')
  })

  it('等待期间草稿变化后作者退回，仍记录退回裁决且不入档', async () => {
    const f = fixture(), packageDir = f.prepare()
    f.ask.mockImplementationOnce(async () => {
      fs.appendFileSync(path.join(f.bookRoot, f.risk), '\n作者等待期间改写。')
      return { answers: [{ id: '定稿入档', selected: ['退回'] }] }
    })
    expect(await f.call('novel_settle_chapter', { ...f.args, summary: '本章' })).toMatchObject({ ok: false, code: 'author-declined' })
    expect(JSON.parse(f.read(`${packageDir}/清单.json`))['裁决']).toBe('已退回')
    expect(fs.existsSync(path.join(f.bookRoot, core.paths.定稿章(1, 1, key.章名)))).toBe(false)
  })

  it('定稿取消不写裁决、收据或正文，迟到批准不生效', async () => {
    const f = fixture(); f.prepare()
    const before = bytes(f.bookRoot), controller = new AbortController()
    let answer!: (value: core.AskResponse) => void
    f.ask.mockImplementationOnce(async () => new Promise(resolve => { answer = resolve }))
    const pending = f.call('novel_settle_chapter', { ...f.args, summary: '取消' }, { signal: controller.signal })
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, code: 'author-cancelled' })
    answer({ answers: [{ id: '定稿入档', selected: ['批准'] }] }); await Promise.resolve()
    expect(bytes(f.bookRoot)).toEqual(before)
  })
})

// Each confirm spawns ~160 Git processes (preview, locked re-check, commit proof); alone these cases take 30-55 s on Windows.
describe('旧章节留档预览与当前确认工具', { timeout: 180_000 }, () => {
  it('预览零写入，作者看到同一清单与完整差异；确认仅改变定稿元数据', async () => {
    const f = fixture(), { final, summary } = f.legacy(), before = bytes(f.bookRoot), head = git(f.bookRoot, 'rev-parse', 'HEAD')
    const originalSummary = f.read(summary), preview = await f.call('novel_preview_draft_retention')
    expect(preview).toMatchObject({ ok: true, state: 'ready', action: 'confirm', bookId: f.bookId, chapter: key })
    expect(bytes(f.bookRoot)).toEqual(before); expect(f.ask).not.toHaveBeenCalled()
    const exec = { agent: { id: 'retention-agent', session: { header: { id: 'retention-session' } } }, callId: 'retention-call', name: 'novel_confirm_draft_retention', signal: new AbortController().signal }
    f.ask.mockImplementationOnce(async request => {
      expect(request.agent).toBe(exec.agent); expect(request.signal).toBe(exec.signal)
      const detail = request.questions[0]?.detail ?? ''
      const lines = detail.split('\n'), review = JSON.parse(lines.slice(3, -1).join('\n'))
      expect(request.questions[0]?.id).toBe('草稿留档确认')
      expect(review.留档清单).toEqual(preview.manifest); expect(review.文件差异).toEqual(preview.change)
      expect(detail).toContain('不补造过去的作者批准')
      expect(fs.existsSync(path.join(f.bookRoot, '.webnovel/book.lock'))).toBe(false)
      return { answers: [{ id: '草稿留档确认', selected: ['批准'] }] }
    })
    const result = await f.call('novel_confirm_draft_retention', { ...f.args, fingerprint: preview.fingerprint }, exec)
    expect(result).toMatchObject({ ok: true, state: 'committed' })
    expect(git(f.bookRoot, 'diff', '--name-only', `${head}..HEAD`)).toBe(final)
    expect(git(f.bookRoot, 'log', '-1', '--format=%s')).toMatch(/^fix:/)
    expect(f.read(summary)).toBe(originalSummary)
    const after = bytes(f.bookRoot), replay = await f.call('novel_confirm_draft_retention', { ...f.args, fingerprint: preview.fingerprint })
    expect(replay).toMatchObject({ ok: true, state: 'already-committed' })
    expect(f.ask).toHaveBeenCalledTimes(1); expect(bytes(f.bookRoot)).toEqual(after)
  })

  it('参数闭合，非法参数不解析书仓、不预览、不询问作者', async () => {
    const f = fixture(); f.legacy()
    const preview = vi.spyOn(core, 'previewDraftRetention')
    f.locate.mockClear()
    for (const name of ['novel_preview_draft_retention', 'novel_confirm_draft_retention']) {
      const base = { ...f.args, ...(name.includes('confirm') ? { fingerprint: 'a'.repeat(64) } : {}) }
      for (const extra of [{ approved: true }, { paths: [f.source] }, { manifest: {} }, { content: '改写' }, { 卷: '1' }, { 章: 0 }, { 章: 1.5 }, { 章名: '../逃逸' }, { bookId: '' }]) {
        expect(await f.call(name, { ...base, ...extra })).toMatchObject({ ok: false, code: 'invalid-argument' })
      }
    }
    expect(preview).not.toHaveBeenCalled(); expect(f.locate).not.toHaveBeenCalled(); expect(f.ask).not.toHaveBeenCalled()
  })

  it('过期指纹和作者退回均零写入，不能以错误答案替代确认', async () => {
    const f = fixture(); f.legacy()
    const before = bytes(f.bookRoot), preview = await f.call('novel_preview_draft_retention')
    expect(await f.call('novel_confirm_draft_retention', { ...f.args, fingerprint: 'a'.repeat(64) })).toMatchObject({ ok: false, code: 'approval-stale' })
    expect(f.ask).not.toHaveBeenCalled()
    f.ask.mockResolvedValueOnce({ answers: [{ id: '草稿留档确认', selected: ['退回'] }] })
    expect(await f.call('novel_confirm_draft_retention', { ...f.args, fingerprint: preview.fingerprint })).toMatchObject({ ok: false, code: 'author-declined' })
    expect(bytes(f.bookRoot)).toEqual(before)
  })

  it('等待期间源稿变化不写元数据，书id改绑也拒绝旧批准', async () => {
    const f = fixture(), { final } = f.legacy(), preview = await f.call('novel_preview_draft_retention'), original = f.read(final)
    f.ask.mockImplementationOnce(async () => {
      fs.appendFileSync(path.join(f.bookRoot, f.source), '\n后来文字。')
      return { answers: [{ id: '草稿留档确认', selected: ['批准'] }] }
    })
    expect(await f.call('novel_confirm_draft_retention', { ...f.args, fingerprint: preview.fingerprint })).toMatchObject({ ok: false, state: 'blocked' })
    expect(f.read(final)).toBe(original); expect(f.read(f.source)).toContain('后来文字')
    const other = fixture(); other.legacy()
    const otherPreview = await other.call('novel_preview_draft_retention'), before = bytes(other.bookRoot)
    other.ask.mockImplementationOnce(async () => { other.rebind(f.bookRoot); return { answers: [{ id: '草稿留档确认', selected: ['批准'] }] } })
    expect(await other.call('novel_confirm_draft_retention', { ...other.args, fingerprint: otherPreview.fingerprint })).toMatchObject({ ok: false, code: 'approval-stale' })
    expect(bytes(other.bookRoot)).toEqual(before)
  })

  it('预取消不定位，等待取消与迟到批准均不写入', async () => {
    const f = fixture(); f.legacy()
    const preview = await f.call('novel_preview_draft_retention'), before = bytes(f.bookRoot), controller = new AbortController()
    let answer!: (value: core.AskResponse) => void
    f.ask.mockImplementationOnce(async () => new Promise(resolve => { answer = resolve }))
    const pending = f.call('novel_confirm_draft_retention', { ...f.args, fingerprint: preview.fingerprint }, { signal: controller.signal })
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, code: 'author-cancelled' })
    answer({ answers: [{ id: '草稿留档确认', selected: ['批准'] }] }); await Promise.resolve()
    f.locate.mockClear()
    expect(await f.call('novel_preview_draft_retention', f.args, { signal: controller.signal })).toMatchObject({ ok: false, code: 'author-cancelled' })
    expect(f.locate).not.toHaveBeenCalled(); expect(bytes(f.bookRoot)).toEqual(before)
  })

  it('提交失败后新预览只续办原清单；新文件不能被原续办吞入', async () => {
    const f = fixture(); f.legacy()
    const preview = await f.call('novel_preview_draft_retention')
    const hook = path.join(f.bookRoot, '.git/hooks/pre-commit')
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n'); fs.chmodSync(hook, 0o755)
    const failed = await f.call('novel_confirm_draft_retention', { ...f.args, fingerprint: preview.fingerprint })
    expect(failed).toMatchObject({ ok: false, state: 'written-pending-commit', operationId: expect.any(String) })
    fs.unlinkSync(hook)
    const resume = await f.call('novel_preview_draft_retention')
    expect(resume).toMatchObject({ ok: true, state: 'ready', action: 'resume', operationId: failed.operationId, manifest: preview.manifest })
    expect(resume.fingerprint).not.toBe(preview.fingerprint)
    const drift = `${f.draftDir}/稿3.起草中.txt`
    f.put(drift, '新进展。')
    expect(await f.call('novel_preview_draft_retention')).toMatchObject({ ok: false, state: 'blocked' })
    fs.unlinkSync(path.join(f.bookRoot, drift))
    const exact = await f.call('novel_preview_draft_retention')
    f.ask.mockImplementationOnce(async request => {
      expect(request.questions[0]?.detail).toContain('只补原提交，不扩大清单')
      expect(request.questions[0]?.detail).toContain(String(failed.operationId))
      return { answers: [{ id: '草稿留档确认', selected: ['批准'] }] }
    })
    expect(await f.call('novel_confirm_draft_retention', { ...f.args, fingerprint: exact.fingerprint })).toMatchObject({ ok: true, state: 'committed', operationId: failed.operationId })
  })

  it('稳定缺失的非来源留档提示可无损输出，新增或改稿继续阻断', async () => {
    const f = fixture(); f.legacy()
    const preview = await f.call('novel_preview_draft_retention')
    expect(await f.call('novel_confirm_draft_retention', { ...f.args, fingerprint: preview.fingerprint })).toMatchObject({ ok: true })
    fs.unlinkSync(path.join(f.bookRoot, f.staging))
    const missing = await f.call('novel_preview_draft_retention')
    expect(missing).toMatchObject({ ok: true, state: 'unchanged', issues: [], notices: [expect.objectContaining({ 路径: f.staging })] })
    f.put(`${f.draftDir}/稿3.起草中.txt`, '新写草稿。')
    expect(await f.call('novel_preview_draft_retention')).toMatchObject({ ok: false, state: 'blocked' })
    expect(f.ask).toHaveBeenCalledTimes(1)
  })

  it('作者原文无法关闭确认详情的代码围栏', async () => {
    const f = fixture(); f.legacy()
    const fingerprint = 'a'.repeat(64)
    const preview = core.previewDraftRetention(f.bookRoot, key)
    const before = '旧文\r\n``````\n# 标题\n', after = '新文\n```````json\n'
    vi.spyOn(core, 'previewDraftRetention').mockReturnValue({ ...preview, ok: true, state: 'ready', action: 'confirm', fingerprint, bookId: f.bookId, change: { relPath: core.paths.定稿章(1, 1, key.章名), before, after } })
    f.ask.mockImplementationOnce(async request => {
      const lines = request.questions[0]!.detail!.split('\n'), fence = lines[2]!.replace(/json$/, '')
      expect(fence.length).toBeGreaterThan(7); expect(lines.at(-1)).toBe(fence)
      expect(JSON.parse(lines.slice(3, -1).join('\n')).文件差异).toMatchObject({ before, after })
      return { answers: [{ id: '草稿留档确认', selected: ['退回'] }] }
    })
    expect(await f.call('novel_confirm_draft_retention', { ...f.args, fingerprint })).toMatchObject({ ok: false, code: 'author-declined' })
  })
})
