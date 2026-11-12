import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import childProcess, { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { syncBuiltinESMExports } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scaffoldBookFiles } from '../src/book/scaffold'
import { paths } from '../src/repo/paths'
import { removeSync } from '../src/repo/remove'
import { contentHash } from '../src/commit/receipt'
import { parseDocument } from '../src/repo/frontmatter'
import { previewBookUpgrade } from '../src/maintenance/upgrade-plan'
import { applyBookUpgrade, previewBookUpgradeResume, resumeBookUpgrade } from '../src/maintenance/upgrade'
import { inspectBookDocuments } from '../src/maintenance/inspection'
import { inspectChapterOpening } from '../src/maintenance/opening'
import { queryLedger, queryMemory } from '../src/ledger'
import { UPGRADE_RECEIPT_DIR } from '../src/maintenance/upgrade-reader'
import { readUpgradeReceipt, serializeUpgradeReceipt, upgradeReceiptPath } from '../src/maintenance/upgrade-receipt'
import { createReadonlyBookSnapshot } from '../src/maintenance/snapshot'
import { uniqueMaintenanceIssues } from '../src/maintenance/types'

const fixtures = fileURLToPath(new URL('./fixtures/maintenance-upgrade/', import.meta.url))
const temp = fs.realpathSync.native(os.tmpdir())
let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(temp, 'book-upgrade-flow-')) })
afterEach(() => {
  vi.restoreAllMocks(); syncBuiltinESMExports()
  if (path.dirname(root) !== temp || !path.basename(root).startsWith('book-upgrade-flow-')) throw new Error('Unsafe test cleanup')
  removeSync(root)
})
const get = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8')
const put = (relative: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true }); fs.writeFileSync(path.join(root, relative), text) }
const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
function init(legacy = true, memory = false): void {
  scaffoldBookFiles(root, { 状态: '已确认', 核心创意: '渡口来客寻找旧船票。', 题材与目标读者: '面向成年读者的幻想故事。' }, { bookId: 'upgrade-fixture' })
  if (legacy) {
    put(paths.契约(), '\uFEFF' + get(paths.契约()).replace('书仓格式版本: 1\n', '').replace(/\n/g, '\r\n'))
    for (const [kind, name] of [['线索', 'clue'], ['时间线', 'timeline']]) put(`账本/${kind}.md`, fs.readFileSync(path.join(fixtures, `historical-${name}.md`), 'utf8'))
  }
  if (memory) {
    put('本书记忆/决策.md', fs.readFileSync(path.join(fixtures, 'historical-memory.md'), 'utf8'))
    put('本书记忆/索引.md', '# 本书记忆索引\n\n保留作者说明。\n- [决策](决策.md) — 分类入口\n')
  }
  git('init', '--quiet'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid')
  git('config', 'commit.gpgsign', 'false'); git('config', 'core.hooksPath', '.git/hooks')
  git('config', 'core.autocrlf', 'false'); git('add', '.'); git('commit', '--quiet', '-m', 'vol: fixture')
}
function allBytes(): Record<string, string> {
  const result: Record<string, string> = {}
  const walk = (relative: string): void => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const file = path.posix.join(relative, entry.name)
      if (entry.isSymbolicLink()) result[file] = `link:${fs.readlinkSync(path.join(root, file))}`
      else if (entry.isDirectory()) { result[`${file}/`] = ''; walk(file) }
      else result[file] = contentHash(fs.readFileSync(path.join(root, file)))
    }
  }
  walk(''); return result
}
function ready(): ReturnType<typeof previewBookUpgrade> & { fingerprint: string } {
  const result = previewBookUpgrade(root)
  expect(result.state, JSON.stringify(result.issues)).toBe('ready')
  expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  return result as typeof result & { fingerprint: string }
}
function apply(fingerprint: string) { return applyBookUpgrade(root, { bookId: 'upgrade-fixture', fingerprint }) }
function resume(operationId: string) {
  const preview = previewBookUpgradeResume(root, operationId)
  expect(preview.ok, preview.reason).toBe(true)
  return resumeBookUpgrade(root, { bookId: 'upgrade-fixture', operationId, fingerprint: preview.fingerprint! })
}

describe('whole-book maintenance preview and execution', { timeout: 90_000 }, () => {
  it('previews historical producers with no file or Git metadata writes', () => {
    init(true, true)
    const before = allBytes()
    for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'unlinkSync'] as const) vi.spyOn(fs, name).mockImplementation(() => { throw new Error(`unexpected ${name}`) })
    syncBuiltinESMExports()
    const plan = ready()
    expect(plan.inspectionBefore?.书仓格式).toMatchObject({ ok: false, kind: 'unversioned' })
    expect(plan.inspectionBefore?.问题.some(issue => issue.代码 === 'LEGACY_SHAPE')).toBe(true)
    expect(plan.inspectionAfter?.书仓格式).toEqual({ ok: true, version: 1 })
    expect(plan.inspectionAfter?.结论).toBe('未发现已知问题')
    expect(plan).not.toHaveProperty('inspection')
    expect(plan.changes.map(change => change.relPath)).toContain(paths.契约())
    expect(plan.changes.some(change => change.rules.includes('C5-v1'))).toBe(true)
    vi.restoreAllMocks(); syncBuiltinESMExports()
    expect(allBytes()).toEqual(before)
  })

  it('commits marker and all transformations together, preserves source bytes and current consumers', () => {
    init(true, true)
    const plan = ready(), initial = git('rev-parse', 'HEAD')
    const result = apply(plan.fingerprint)
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, state: 'committed', operationId: plan.fingerprint })
    expect(git('rev-list', '--count', `${initial}..HEAD`)).toBe('1')
    const changed = git('-c', 'core.quotepath=false', 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n').sort()
    expect(changed).toEqual(plan.changes.map(change => change.relPath).sort())
    for (const change of plan.changes) expect(get(change.relPath)).toBe(change.after)
    expect(get(paths.契约()).startsWith('\uFEFF---\r\n')).toBe(true)
    expect(parseDocument(get(paths.契约()))).toMatchObject({ ok: true, data: { fields: { 书仓格式版本: 1 } } })
    expect(queryLedger(root, { 分类: '线索' }).entries[0]?.字段['预期兑现区间']).toBe('第4-8章')
    expect(queryLedger(root, { 分类: '时间线' }).entries[0]?.字段['事件']).toContain('林舟')
    const memory = queryMemory(root)
    expect(memory.ok).toBe(true); expect(memory.entries.every(entry => entry.格式 !== '旧')).toBe(true)
    expect(git('status', '--porcelain')).toBe('')
    expect(git('ls-files', '--', UPGRADE_RECEIPT_DIR)).toBe('')
    expect(inspectBookDocuments(root).结论).toBe('未发现已知问题')
    expect(inspectChapterOpening(root).状态).toBe('边界已核对')
    expect(previewBookUpgrade(root).state).toBe('unchanged')
    const completed = git('rev-parse', 'HEAD')
    expect(resume(plan.fingerprint)).toMatchObject({ ok: true, state: 'already-committed' })
    expect(git('rev-parse', 'HEAD')).toBe(completed)
  })

  it('leaves an already current clean book unchanged', () => {
    init(false)
    const before = allBytes()
    expect(previewBookUpgrade(root)).toMatchObject({ state: 'unchanged', changes: [], issues: [] })
    expect(allBytes()).toEqual(before)
  })

  it('keeps both inspection stages on blocked drafts and removes duplicate shared diagnostics', () => {
    init()
    const draft = '草稿区/草稿/卷01-未完成/稿1.md'
    put(draft, '---\n身份: 卷01-未完成\n版本: 8\n---\n原文保留。\n')
    const before = allBytes(), result = previewBookUpgrade(root)
    expect(result).toMatchObject({ state: 'blocked', changes: [] })
    expect(result.fingerprint).toBeUndefined()
    expect(result.inspectionBefore?.书仓格式).toMatchObject({ ok: false, kind: 'unversioned' })
    expect(result.inspectionAfter?.书仓格式).toMatchObject({ ok: true, version: 1 })
    expect(result.issues.filter(issue => issue.代码 === 'OPENING_DRAFT_IDENTITY' && issue.路径 === draft)).toHaveLength(1)
    expect(result.inspectionBefore?.问题.some(issue => issue.路径 === draft && issue.字段 === '身份')).toBe(true)
    expect(result.inspectionAfter?.问题.some(issue => issue.路径 === draft && issue.字段 === '身份')).toBe(true)
    expect(result.issues).toEqual(uniqueMaintenanceIssues(result.issues))
    expect(allBytes()).toEqual(before)
  })

  // #213: an early block used to carry undefined-valued keys, which the host rejects as non-lossless JSON.
  it.each([
    ['an unreadable receipt directory throws mid-preview', () => put(`${UPGRADE_RECEIPT_DIR}/.DS_Store`, 'x'), 'UPGRADE_PREVIEW_FAILED', true],
    ['the contract has no book identity', () => { put(paths.契约(), get(paths.契约()).replace(/^书id:.*\r?\n/m, '')); git('commit', '--quiet', '-am', 'fixture: no id') }, 'UPGRADE_BOOK_IDENTITY', false],
  ] as const)('omits unavailable keys when %s', (_name, setup, code, identified) => {
    init(); setup()
    const before = allBytes(), result = previewBookUpgrade(root)
    expect(result).toMatchObject({ ok: true, state: 'blocked', changes: [], issues: [expect.objectContaining({ 代码: code })] })
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result)
    for (const key of ['fingerprint', 'inspectionBefore', 'inspectionAfter']) expect(result).not.toHaveProperty(key)
    if (identified) expect(result).toMatchObject({ bookId: 'upgrade-fixture', baseHead: git('rev-parse', 'HEAD') })
    else for (const key of ['bookId', 'baseHead']) expect(result).not.toHaveProperty(key)
    expect(allBytes()).toEqual(before)
  })

  it('deduplicates exact issues without merging different fields, lines or explanations', () => {
    const a = { 代码: 'DOCUMENT_INVALID', 路径: '账本/线索.md', 说明: '字段冲突', 字段: '状态', 行: 5 }
    const b = { ...a, 行: 15 }, c = { ...a, 字段: '来源' }, d = { ...a, 说明: '字段为空' }
    expect(uniqueMaintenanceIssues([a, { ...a }, b, c, d, { ...b }])).toEqual([a, b, c, d])
  })

  it.each(['世界书/人物档案/坏.md', '草稿区/批次/未知/批次.json'])('blocks all writes if any document is unsupported or damaged: %s', relative => {
    init(); put(relative, relative.endsWith('.json') ? '{"schemaVersion":1}' : '---\n类型: [\n---\n正文')
    if (!relative.startsWith('草稿区/')) { git('add', '.'); git('commit', '--quiet', '-m', 'fixture: invalid input') }
    const before = allBytes(), result = previewBookUpgrade(root)
    expect(result).toMatchObject({ state: 'blocked', changes: [] })
    expect(result.fingerprint).toBeUndefined(); expect(allBytes()).toEqual(before)
  })

  it('reports missing source data instead of silently skipping one legacy category', () => {
    init(); put('本书记忆/决策.md', '# 决策\n## 缺来源\n类：决策\n状态：已确认\n### 正文\n不能补造出处。\n')
    git('add', '.'); git('commit', '--quiet', '-m', 'fixture: missing memory source')
    expect(previewBookUpgrade(root)).toMatchObject({ state: 'blocked', changes: [] })
  })

  it.each(['untracked', 'staged', 'invalid-draft', 'hidden-index', 'future'])('refuses non-executable window: %s', kind => {
    init()
    if (kind === 'untracked') put('note.txt', '其他未提交文件。')
    if (kind === 'staged') { put('note.txt', '其他暂存文件。'); git('add', 'note.txt') }
    if (kind === 'invalid-draft') put('草稿区/草稿/卷01-未完成/稿1.起草中.txt', '---\n身份: 无法定位\n---\n未完成稿。')
    if (kind === 'hidden-index') git('update-index', '--assume-unchanged', '账本/线索.md')
    if (kind === 'future') { put(paths.契约(), get(paths.契约()).replace('书id:', '书仓格式版本: 2\r\n书id:')); git('add', '.'); git('commit', '--quiet', '-m', 'fixture: future version') }
    const before = allBytes(); expect(previewBookUpgrade(root).state).toBe('blocked'); expect(allBytes()).toEqual(before)
  })

  it('detects changes to an unrelated ignored source while waiting for approval', () => {
    init(); const plan = ready()
    put('草稿区/草稿/卷01-新增/稿1.起草中.txt', '新增工件。')
    const before = get('账本/线索.md')
    expect(apply(plan.fingerprint)).toMatchObject({ ok: false, code: 'UPGRADE_STALE' })
    expect(get('账本/线索.md')).toBe(before)
  })

  it('checks identity and cancellation before acquiring a writing lock', () => {
    init(); const plan = ready(), before = allBytes()
    const controller = new AbortController(); controller.abort()
    expect(applyBookUpgrade(root, { bookId: 'upgrade-fixture', fingerprint: plan.fingerprint, signal: controller.signal }).ok).toBe(false)
    expect(applyBookUpgrade(root, { bookId: 'another-book', fingerprint: plan.fingerprint }).ok).toBe(false)
    expect(applyBookUpgrade(root, { bookId: 'upgrade-fixture', fingerprint: plan.fingerprint, validateIdentity: () => false }).ok).toBe(false)
    expect(allBytes()).toEqual(before)
  })

  it('rechecks the actual workspace identity inside the acquired lock', () => {
    init(); const plan = ready(), before = get('账本/线索.md')
    let checks = 0
    const result = applyBookUpgrade(root, { bookId: 'upgrade-fixture', fingerprint: plan.fingerprint, validateIdentity: () => ++checks < 2 })
    expect(result.ok).toBe(false); expect(checks).toBe(2); expect(get('账本/线索.md')).toBe(before)
  })

  it('never invokes an external clean filter, including for a newly created memory target', () => {
    init(true, true)
    const plan = ready(), created = plan.changes.find(change => change.before === null)!.relPath
    put('.gitattributes', `"${created}" filter=fixture\n`)
    git('add', '.gitattributes'); git('commit', '--quiet', '-m', 'fixture: attributes')
    git('config', 'filter.fixture.clean', 'this-external-filter-must-not-run')
    const original = childProcess.spawnSync.bind(childProcess), seen: string[][] = []
    vi.spyOn(childProcess, 'spawnSync').mockImplementation(((command: string, args: readonly string[], options: unknown) => {
      seen.push([...args]); return original(command, args, options as undefined)
    }) as typeof childProcess.spawnSync)
    syncBuiltinESMExports()
    expect(previewBookUpgrade(root).state).toBe('blocked')
    expect(seen.some(args => args.includes('hash-object') && args.includes(`--path=${created}`))).toBe(false)
  })
})

describe('maintenance commit continuation', { timeout: 90_000 }, () => {
  function pending() {
    init(); const plan = ready()
    put('.git/hooks/pre-commit', '#!/bin/sh\nexit 1\n')
    if (process.platform !== 'win32') fs.chmodSync(path.join(root, '.git/hooks/pre-commit'), 0o755)
    const result = apply(plan.fingerprint)
    expect(result, JSON.stringify(result)).toMatchObject({ ok: false, state: 'written-pending-commit' })
    return plan
  }
  it('retains exact bytes after Git failure and resumes only the missing commit', () => {
    const plan = pending(), source = Object.fromEntries(plan.changes.map(change => [change.relPath, get(change.relPath)]))
    expect(inspectBookDocuments(root).问题.some(item => item.代码 === 'UPGRADE_PENDING_COMMIT')).toBe(true)
    expect(inspectChapterOpening(root).状态).not.toBe('边界已核对')
    expect(previewBookUpgrade(root).resumable).toContain(plan.fingerprint)
    fs.unlinkSync(path.join(root, '.git/hooks/pre-commit'))
    expect(resume(plan.fingerprint)).toMatchObject({ ok: true, state: 'committed' })
    expect(Object.fromEntries(plan.changes.map(change => [change.relPath, get(change.relPath)]))).toEqual(source)
    expect(inspectChapterOpening(root).状态).toBe('边界已核对')
  })
  it('recognizes an author-completed exact commit after an earlier Git failure', () => {
    const plan = pending(); fs.unlinkSync(path.join(root, '.git/hooks/pre-commit'))
    git('commit', '--only', '--quiet', '-m', 'fix: author finished maintenance', '--', ...plan.changes.map(change => change.relPath))
    const head = git('rev-parse', 'HEAD')
    expect(resume(plan.fingerprint)).toMatchObject({ ok: true, state: 'already-committed', commit: head })
    expect(git('rev-parse', 'HEAD')).toBe(head)
  })
  it.each(['target', 'unrelated', 'ignored', 'receipt'])('refuses changed %s on continuation without overwriting it', kind => {
    const plan = pending()
    const file = kind === 'target' ? '账本/线索.md' : kind === 'unrelated' ? 'note.txt'
      : kind === 'ignored' ? '草稿区/草稿/卷01-后来稿/稿1.起草中.txt' : upgradeReceiptPath(plan.fingerprint)
    put(file, kind === 'target' ? get(file) + '\n作者后来写入。\n' : '作者后来写入。')
    const before = allBytes(), preview = previewBookUpgradeResume(root, plan.fingerprint)
    expect(preview.ok).toBe(false); expect(allBytes()).toEqual(before)
  })
  it('rejects cross-book receipt identity even when its checksum was recomputed', () => {
    const plan = pending(), reader = createReadonlyBookSnapshot(root), receipt = readUpgradeReceipt(reader, plan.fingerprint)!
    put(upgradeReceiptPath(plan.fingerprint), serializeUpgradeReceipt({ ...receipt, bookId: 'other-book' }))
    expect(previewBookUpgradeResume(root, plan.fingerprint)).toMatchObject({ ok: false, state: 'blocked' })
  })
})
