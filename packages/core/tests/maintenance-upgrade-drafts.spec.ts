import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { scaffoldBookFiles } from '../src/book/scaffold'
import { paths } from '../src/repo/paths'
import { parseDocument, serializeDocument } from '../src/repo/frontmatter'
import { removeSync } from '../src/repo/remove'
import { 定位段小节, 单元字段 } from '../src/outline/template'
import { planDraftIdentity } from '../src/maintenance/upgrade-rule-draft'
import { previewBookUpgrade } from '../src/maintenance/upgrade-plan'
import { applyBookUpgrade, previewBookUpgradeResume, resumeBookUpgrade } from '../src/maintenance/upgrade'
import { inspectBookDocuments } from '../src/maintenance/inspection'
import { inspectChapterOpening } from '../src/maintenance/opening'
import { readUpgradeReceipt, upgradeReceiptPath, upgradeCommitted, serializeUpgradeReceipt, parseUpgradeReceipt } from '../src/maintenance/upgrade-receipt'
import { createReadonlyBookSnapshot } from '../src/maintenance/snapshot'
import { assembleMaterials, computeMaterials } from '../src/assembly'
import { rebuildResume } from '../src/recovery'

const key = { 卷: 1, 章: 5, 章名: '渡口来信' }
const draft = '草稿区/草稿/卷01-渡口来信/稿8.md'
const outline = paths.确认细纲(1, 5, key.章名)
const oldText = '\uFEFF---\r\n身份: "卷01-渡口来信" # 原备注\r\n版本: 8\r\n父版本: 7\r\n角色: 待审稿\r\n选定: true\r\n作者扩展: 保留\r\n---\r\n# 渡口来信\r\n\r\n  原稿不变。  \r\n身份：正文样例\r\n'
const outlineText = serializeDocument({ 身份: key, 状态: '已确认', 版本: 2 }, ['# 章细纲', '## 定位段', ...定位段小节.flatMap(name => [`### ${name}`, '合成确认内容。']), '## 细纲段', '### 单元 1', ...单元字段.map(name => `- ${name}：合成确认内容。`)].join('\n'))
let root: string | undefined
afterEach(() => {
  if (root) {
    if (path.dirname(root) !== fs.realpathSync.native(os.tmpdir()) || !path.basename(root).startsWith('upgrade-drafts-')) throw new Error('Unsafe fixture cleanup')
    removeSync(root)
  }
  root = undefined
})
const put = (file: string, text: string) => { const full = path.join(root!, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, text) }
const read = (file: string) => fs.readFileSync(path.join(root!, file), 'utf8')
const git = (...args: string[]) => execFileSync('git', ['--no-optional-locks', ...args], { cwd: root, windowsHide: true, encoding: 'utf8' }).trim()
const plan = () => { const value = previewBookUpgrade(root!); expect(value.state, JSON.stringify(value.issues)).toBe('ready'); return value }
const apply = (fingerprint: string) => applyBookUpgrade(root!, { bookId: 'draft-transition', fingerprint })
function init(markerMissing = true): void {
  root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'upgrade-drafts-'))
  scaffoldBookFiles(root, { 状态: '已确认', 核心创意: '合成旧稿迁移。', 题材与目标读者: '测试' }, { bookId: 'draft-transition' })
  put(outline, outlineText); put(draft, oldText)
  if (markerMissing) put(paths.契约(), read(paths.契约()).replace('书仓格式版本: 1\n', ''))
  git('init', '--quiet'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid')
  git('config', 'commit.gpgsign', 'false'); git('config', 'core.autocrlf', 'false'); git('config', 'core.hooksPath', '.git/hooks')
  git('add', '.'); git('commit', '--quiet', '-m', 'fixture: paused chapter')
}

describe('C7 conservative draft identity mapping', () => {
  it('replaces only the YAML scalar with a proved chapter identity and preserves BOM/CRLF/comment/body', () => {
    const change = planDraftIdentity(draft, oldText, new Map([[outline, outlineText]]))!
    expect(change.rules).toEqual(['C7-v1'])
    expect(change.after).toBe(oldText.replace('"卷01-渡口来信"', '{ 卷: 1, 章: 5, 章名: "渡口来信" }'))
    expect(parseDocument(change.after)).toMatchObject({ ok: true, data: { fields: { 身份: key, 版本: 8, 父版本: 7, 作者扩展: '保留' } } })
    expect(change.evidence.join('\n')).toContain('UTF-8字节范围')
    expect(planDraftIdentity(draft, change.after, new Map([[outline, outlineText]]))).toBeUndefined()
  })
  it.each(['missing', 'wrong-scope', 'duplicate-number', 'unconfirmed', 'wrong-metadata', 'multiline', 'bad-yaml'])('refuses %s without guessing from draft version or title', kind => {
    const files = new Map([[outline, outlineText]])
    let text = oldText
    if (kind === 'missing') files.clear()
    if (kind === 'wrong-scope') text = text.replace('卷01-渡口来信', '卷02-渡口来信')
    if (kind === 'duplicate-number') files.set(outline.replace('0005', '0006'), outlineText.replace('章: 5', '章: 6'))
    if (kind === 'unconfirmed') files.set(outline, outlineText.replace('状态: 已确认', '状态: 暂定'))
    if (kind === 'wrong-metadata') files.set(outline, outlineText.replace('章: 5', '章: 6'))
    if (kind === 'multiline') text = text.replace('"卷01-渡口来信" # 原备注', '>\r\n  卷01-渡口来信')
    if (kind === 'bad-yaml') text = text.replace('版本: 8', '版本: [')
    expect(() => planDraftIdentity(draft, text, files)).toThrow()
    expect(files.get(outline) ?? '').not.toContain('章: 8')
  })
})

describe('paused chapter upgrade with local drafts', { timeout: 90000 }, () => {
  it.each([true, false])('upgrades a paused draft, backs it locally and proves one commit (markerMissing=%s)', markerMissing => {
    init(markerMissing)
    const head = git('rev-parse', 'HEAD'), before = read(draft), preview = plan()
    expect(read(draft)).toBe(before)
    expect(git('rev-parse', 'HEAD')).toBe(head)
    expect(preview.activeWork).toEqual(expect.arrayContaining([expect.objectContaining({ 路径: draft, 种类: '草稿文件' })]))
    expect(preview.ruleVersion).toBe(2)
    const result = apply(preview.fingerprint!)
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, state: 'committed' })
    expect(git('rev-list', '--count', `${head}..HEAD`)).toBe('1')
    expect(git('status', '--porcelain')).toBe('')
    expect(git('ls-files', '--', '草稿区')).toBe('')
    expect(git('-c', 'core.quotepath=false', 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD')).toBe(markerMissing ? paths.契约() : '')
    const receipt = readUpgradeReceipt(createReadonlyBookSnapshot(root!), preview.fingerprint!)!
    expect(receipt).toMatchObject({ schema: 2, ruleVersion: 2, drafts: [{ relPath: draft, before, after: read(draft) }] })
    expect(git('log', '-1', '--format=%B')).toContain('Scriptor-Maintenance: ')
    const tampered = { ...receipt, drafts: receipt.drafts!.map(item => ({ ...item, before: item.before + '伪造备份' })) }
    expect(upgradeCommitted(root!, tampered)).toBeUndefined()
    expect(() => parseUpgradeReceipt(serializeUpgradeReceipt({ ...receipt, drafts: receipt.drafts!.map(item => ({ ...item, relPath: '草稿区/任意文件.md' })) }), preview.fingerprint!)).toThrow()
    expect(inspectBookDocuments(root!).结论).toBe('未发现已知问题')
    expect(inspectChapterOpening(root!).状态).toBe('需恢复')
    const repeat = previewBookUpgradeResume(root!, preview.fingerprint!)
    expect(resumeBookUpgrade(root!, { bookId: 'draft-transition', operationId: preview.fingerprint!, fingerprint: repeat.fingerprint! })).toMatchObject({ state: 'already-committed' })
    expect(previewBookUpgrade(root!).state).toBe('unchanged')
    put(draft, read(draft) + '\r\n作者后来新写。\r\n')
    expect(upgradeCommitted(root!, receipt)).toBe(result.commit)
    expect(inspectBookDocuments(root!).结论).toBe('未发现已知问题')
    expect(previewBookUpgradeResume(root!, preview.fingerprint!).state).toBe('blocked')
    expect(git('rev-list', '--count', `${head}..HEAD`)).toBe('1')
  })

  it('preserves current drafts and real materials while removing the old-format/unfinished-chapter cycle', () => {
    init()
    put(draft, serializeDocument({ 身份: key, 版本: 8, 角色: '待审稿', 选定: true }, '当前未完成原稿。'))
    put('账本/时间线.md', '# 时间线\n## 来信\n章号：第0001章\n来源：对谈\n裁决记录：原批准\n### 正文\n事件：林舟收到信件\n时点：清晨\n保留说明。\n')
    git('add', '.'); git('commit', '--quiet', '-m', 'fixture: old timeline with current draft')
    expect(assembleMaterials(root!, key).ok).toBe(true)
    const material = paths.材料包目录(key.卷, key.章名)
    const before = new Map([draft, ...fs.readdirSync(path.join(root!, material)).map(file => `${material}/${file}`)].map(file => [file, read(file)]))
    const preview = plan()
    expect(preview.activeWork?.some(item => item.种类 === '材料包')).toBe(true)
    expect(preview.changes.some(change => change.rules.includes('C2-v1'))).toBe(true)
    expect(apply(preview.fingerprint!)).toMatchObject({ ok: true, state: 'committed' })
    for (const [file, content] of before) expect(read(file)).toBe(content)
    expect(computeMaterials(root!, { ...key, 仅预览: true }).ok).toBe(true)
    expect(rebuildResume(root!, key).memory.ok).toBe(true)
    expect(inspectChapterOpening(root!).状态).toBe('需恢复')
  })

  it('detects ignored draft drift between preview and apply, without writing any target', () => {
    init(); const preview = plan(), contract = read(paths.契约())
    put(draft, oldText + '\r\n新写文字。')
    expect(apply(preview.fingerprint!)).toMatchObject({ ok: false, code: 'UPGRADE_STALE' })
    expect(read(paths.契约())).toBe(contract)
    expect(read(draft)).toBe(oldText + '\r\n新写文字。')
  })

  it('failed commit preserves local backups and resumes without rewriting; post-failure edits block', () => {
    init(false); const preview = plan(), head = git('rev-parse', 'HEAD')
    put('.git/hooks/pre-commit', '#!/bin/sh\nexit 1\n')
    if (process.platform !== 'win32') fs.chmodSync(path.join(root!, '.git/hooks/pre-commit'), 0o755)
    expect(apply(preview.fingerprint!)).toMatchObject({ ok: false, state: 'written-pending-commit' })
    const current = read(draft), receipt = read(upgradeReceiptPath(preview.fingerprint!))
    expect(git('rev-parse', 'HEAD')).toBe(head)
    put(draft, current + '\r\n并发修改。')
    expect(previewBookUpgradeResume(root!, preview.fingerprint!).state).toBe('blocked')
    expect(read(draft)).toBe(current + '\r\n并发修改。')
    put(draft, current); fs.unlinkSync(path.join(root!, '.git/hooks/pre-commit'))
    const resume = previewBookUpgradeResume(root!, preview.fingerprint!)
    expect(resume.drafts).toHaveLength(1)
    expect(resumeBookUpgrade(root!, { bookId: 'draft-transition', operationId: preview.fingerprint!, fingerprint: resume.fingerprint! })).toMatchObject({ ok: true, state: 'committed' })
    expect(read(draft)).toBe(current)
    expect(read(upgradeReceiptPath(preview.fingerprint!))).toBe(receipt)
  })

  it('preserves numbered staging drafts with the same evidence and refuses stale approvals', () => {
    init()
    const staging = draft.replace('.md', '.起草中.txt')
    put(staging, oldText)
    const preview = plan()
    expect(preview.changes.filter(change => change.rules.includes('C7-v1'))).toHaveLength(2)
    expect(preview.activeWork?.some(item => item.种类 === '起草暂存')).toBe(true)
    expect(apply(preview.fingerprint!)).toMatchObject({ ok: true, state: 'committed' })
    expect(parseDocument(read(staging))).toMatchObject({ ok: true, data: { fields: { 身份: key } } })
    expect(read(staging)).toBe(read(draft))
    expect(git('ls-files', '--', '草稿区')).toBe('')
    expect(apply(preview.fingerprint!)).toMatchObject({ ok: false, code: 'UPGRADE_STALE' })
  })

  it.each(['lock', 'transaction', 'dirty', 'tracked-draft', 'unknown', 'symlink', 'hardlink'])('does not waive %s when allowing paused work', kind => {
    init()
    if (kind === 'lock') put('.webnovel/book.lock', '{}')
    if (kind === 'transaction') put('.webnovel/transactions/unknown/manifest.json', '{}')
    if (kind === 'dirty') put(paths.契约(), read(paths.契约()) + '\n新修改。')
    if (kind === 'tracked-draft') { git('add', '-f', '--', draft); git('commit', '--quiet', '-m', 'fixture: forbidden tracked draft') }
    if (kind === 'unknown') put('草稿区/批次/未知/批次.json', '{}')
    if (kind === 'symlink') { const full = path.join(root!, draft); fs.unlinkSync(full); fs.rmdirSync(path.dirname(full)); fs.symlinkSync(path.join(root!, '大纲'), path.dirname(full), process.platform === 'win32' ? 'junction' : 'dir') }
    if (kind === 'hardlink') { const full = path.join(root!, draft); fs.unlinkSync(full); fs.linkSync(path.join(root!, outline), full) }
    const head = git('rev-parse', 'HEAD'), contract = read(paths.契约())
    const result = previewBookUpgrade(root!)
    expect(result.state, JSON.stringify(result)).toBe('blocked')
    expect(result.fingerprint).toBeUndefined()
    expect(git('rev-parse', 'HEAD')).toBe(head)
    expect(read(paths.契约())).toBe(contract)
  })
})
