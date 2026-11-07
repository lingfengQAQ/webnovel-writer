import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { scaffoldBookFiles } from '../src/book/scaffold'
import { prepareSkeleton, prepareVolumeLayout } from '../src/design/skeleton'
import { prepareRecentWindow } from '../src/design/volume'
import { chapterLengthIdentity, readChapterLength } from '../src/design/chapter-length'
import { writeCandidate, confirmOutline } from '../src/outline/write'
import { 定位段小节, 单元字段 } from '../src/outline/template'
import { computeMaterials } from '../src/assembly/assemble'
import { loadMaterialPackage } from '../src/assembly/read'
import { draftHashOf, reviewInputFingerprintOf, serializeReviewRecord } from '../src/evidence/record'
import { computePack } from '../src/prepare/pack'
import { archiveChapter } from '../src/commit/archive'
import { contentHash } from '../src/commit/receipt'
import { paths } from '../src/repo/paths'
import { parseDocument, serializeDocument } from '../src/repo/frontmatter'
import { serializeMachineJson } from '../src/repo/schema'
import { removeSync } from '../src/repo/remove'
import { scanChapter } from '../src/derive/scan'
import { rebuildResume } from '../src/recovery'
import { previewBookUpgrade } from '../src/maintenance/upgrade-plan'
import { applyBookUpgrade, previewBookUpgradeResume, resumeBookUpgrade } from '../src/maintenance/upgrade'
import { inspectBookDocuments } from '../src/maintenance/inspection'
import { inspectChapterOpening } from '../src/maintenance/opening'
import { createReadonlyBookSnapshot } from '../src/maintenance/snapshot'
import { readUpgradeReceipt, upgradeReceiptPath, upgradeCommitted } from '../src/maintenance/upgrade-receipt'

const temp = fs.realpathSync.native(os.tmpdir())
const roots: string[] = []
const bookId = 'upgrade-history-fixture'
const key = { 卷: 1, 章: 1, 章名: '渡口' }
const source = '世界书/人物档案/林舟.md'
const materialDir = paths.材料包目录(key.卷, key.章名)
const materialManifest = `${materialDir}/材料清单.json`
const excerptPath = `${materialDir}/补充/history-source.md`
const reviewPath = `草稿区/审核/卷01-${key.章名}.json`
const packDir = paths.待定稿包目录(key.卷, key.章名)
const packManifest = `${packDir}/清单.json`
const fixtures = fileURLToPath(new URL('./fixtures/maintenance-upgrade/', import.meta.url))
const historicalWorldbook = fs.readFileSync(path.join(fixtures, 'historical-worldbook.md'), 'utf8')
const concept = { 状态: '已确认' as const, 核心创意: '渡口来客寻找旧船票。', 题材与目标读者: '面向成年读者的幻想故事。' }

function root(): string {
  const value = fs.mkdtempSync(path.join(temp, 'upgrade-history-'))
  roots.push(value)
  return value
}
afterEach(() => {
  for (const value of roots.splice(0).reverse()) {
    if (path.dirname(value) !== temp || !path.basename(value).startsWith('upgrade-history-')) throw new Error('Unsafe fixture cleanup')
    removeSync(value)
  }
})
const read = (value: string, relative: string): string => fs.readFileSync(path.join(value, relative), 'utf8')
function put(value: string, relative: string, text: string): void {
  const target = path.join(value, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, text)
}
const git = (value: string, ...args: string[]): string => execFileSync('git', args, {
  cwd: value, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
}).trim()
function gitConfig(value: string): void {
  git(value, 'config', 'user.name', 'Fixture')
  git(value, 'config', 'user.email', 'fixture@example.invalid')
  git(value, 'config', 'commit.gpgsign', 'false')
  git(value, 'config', 'core.autocrlf', 'false')
  git(value, 'config', 'core.hooksPath', '.git/hooks')
}
function initializeGit(value: string): void {
  git(value, 'init', '--quiet'); gitConfig(value)
  git(value, 'add', '.'); git(value, 'commit', '--quiet', '-m', 'vol: historical fixture')
}
function scaffold(value: string): void {
  scaffoldBookFiles(value, concept, { bookId })
  put(value, paths.契约(), read(value, paths.契约()).replace('书仓格式版本: 1\n', ''))
  put(value, source, historicalWorldbook)
}
function simpleBook(): string {
  const value = root(); scaffold(value); initializeGit(value); return value
}
function hook(value: string, body: string): void {
  put(value, '.git/hooks/pre-commit', `#!/bin/sh\n${body}\n`)
  if (process.platform !== 'win32') fs.chmodSync(path.join(value, '.git/hooks/pre-commit'), 0o755)
}
function saved(value: string, names: readonly string[]): Readonly<Record<string, string>> {
  return Object.fromEntries(names.map(name => [name, read(value, name)]))
}
function allBytes(value: string): Readonly<Record<string, string>> {
  const result: Record<string, string> = {}
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(path.join(value, directory), { withFileTypes: true })) {
      const relative = directory ? `${directory}/${entry.name}` : entry.name
      if (entry.isDirectory()) { result[`${relative}/`] = ''; visit(relative) }
      else result[relative] = contentHash(fs.readFileSync(path.join(value, relative)))
    }
  }
  visit(''); return result
}
function ready(value: string) {
  const preview = previewBookUpgrade(value)
  expect(preview.state, JSON.stringify(preview.issues)).toBe('ready')
  expect(preview.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  return { ...preview, fingerprint: preview.fingerprint! }
}
function apply(value: string, fingerprint: string) { return applyBookUpgrade(value, { bookId, fingerprint }) }
function resume(value: string, operationId: string) {
  const preview = previewBookUpgradeResume(value, operationId)
  expect(preview.ok, preview.reason).toBe(true)
  return resumeBookUpgrade(value, { bookId, operationId, fingerprint: preview.fingerprint! })
}

/** Actual material, preparation and archive producers; review evidence uses its canonical serializer. */
function archivedBook(): string {
  const value = root(); scaffold(value)
  for (const op of [prepareSkeleton(value, '# 故事骨架\n## 核心命题 〔暂定〕\n寻找记忆。\n'),
    prepareVolumeLayout(value, '# 分卷布局\n## 故事阶段分配 〔已确认〕\n- 卷01 〔已确认〕\n'),
    prepareRecentWindow(1, [{ 名称: key.章名, 状态: '已确认' }])]) put(value, op.relPath, op.content)
  const outline = ['# 章细纲', '## 定位段', ...定位段小节.flatMap(name => [`### ${name}`, name === '章节功能' ? '核对船票。\n- 〔软〕平缓叙述。' : '已核对本章前提。']),
    '## 细纲段', '### 单元 1', ...单元字段.map(name => `- ${name}：来客在渡口核对船票。`)].join('\n')
  writeCandidate(value, { ...key, 来源引用: ['来源:对谈共创'], body: outline })
  const confirmed = confirmOutline(value, key)
  expect(confirmed, JSON.stringify(confirmed)).toMatchObject({ ok: true })
  const draftPath = `${paths.草稿目录(key.卷, key.章名)}/稿1.md`
  put(value, draftPath, serializeDocument({ 身份: key, 角色: '待审稿', 选定: true, 版本: 1 }, '来客在渡口找到了旧船票。'))
  const materials = computeMaterials(value, { ...key, 仅预览: true, 补充操作: [{
    操作: '设置', 编号: 'history-source', 标题: '人物旧来源', 理由: '保留本章作者所选原文', 性质: '原文',
    来源: { 域: '本书', 路径: source, 起行: 12, 终行: 12 },
  }] })
  expect(materials.ok, JSON.stringify(materials.gaps)).toBe(true)
  for (const op of materials.文件 ?? []) put(value, op.relPath, op.content)
  const draft = parseDocument(read(value, draftPath))
  if (!draft.ok) throw new Error(draft.detail)
  put(value, reviewPath, serializeReviewRecord({ schemaVersion: 1, 完成: true, 问题: [], 模块: { 夹具审核: { 完成: true, 失败: false } },
    审稿哈希: draftHashOf(draft.data.body),
    审读指纹: reviewInputFingerprintOf({ 正文: draft.data.body, 细纲: read(value, paths.确认细纲(key.卷, key.章, key.章名)),
      材料清单: loadMaterialPackage(value, key).审读材料标识, 章节篇幅: chapterLengthIdentity(readChapterLength(value)) }),
  }))
  const pack = computePack(value, key, { 章摘要: '来客找回船票，留在渡口。' })
  expect(pack.ok, pack.reason).toBe(true)
  for (const op of pack.文件 ?? []) put(value, op.relPath, op.content)
  put(value, packManifest, serializeMachineJson({ ...JSON.parse(read(value, packManifest)), 裁决: '已批准' }, 1))
  initializeGit(value)
  const archived = archiveChapter({ bookRoot: value, packageDir: packDir, summary: '保留补充来源的合成归档', settlement: { 章节: key, 批准: true, 裁决记录: '合成夹具作者批准' } })
  expect(archived, JSON.stringify(archived)).toMatchObject({ ok: true })
  expect(git(value, 'status', '--porcelain')).toBe('')
  const opening = inspectChapterOpening(value)
  expect(opening.状态, JSON.stringify(opening)).toBe('边界已核对')
  expect(scanChapter(value, key).审核证据过期).toBe(false)
  return value
}

const evidencePaths = [excerptPath, materialManifest, reviewPath, packManifest]

describe('whole-source upgrade with retained historical evidence', { timeout: 120_000 }, () => {
  it('upgrades an archived book while preserving excerpts, hashes and author decisions and exposing real reader staleness', () => {
    const value = archivedBook(), evidence = saved(value, evidencePaths)
    const plan = ready(value)
    expect(plan.inspectionAfter?.问题).toEqual([expect.objectContaining({ 代码: 'EVIDENCE_STALE', 路径: excerptPath })])
    expect(plan.effects.map(effect => effect.path)).toEqual(expect.arrayContaining(evidencePaths))
    expect(plan.inspectionAfter?.结论).toBe('需处理')
    expect(plan.inspectionBefore?.问题.some(issue => issue.代码 === 'EVIDENCE_STALE')).toBe(false)
    expect(plan.expectedStaleIssues).toEqual(plan.inspectionAfter?.问题)
    expect(plan.issues).toEqual([])
    const result = apply(value, plan.fingerprint)
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, state: 'committed', effects: plan.effects })
    expect(saved(value, evidencePaths)).toEqual(evidence)
    for (const change of plan.changes) expect(read(value, change.relPath)).toBe(change.after)
    expect(git(value, 'status', '--porcelain')).toBe('')
    expect(inspectChapterOpening(value).状态).toBe('边界已核对')
    expect(inspectBookDocuments(value).问题).toEqual([expect.objectContaining({ 代码: 'EVIDENCE_STALE', 路径: excerptPath })])
    const materials = loadMaterialPackage(value, key)
    expect(materials.问题.join(' ')).toContain('补充来源已过期')
    const recovery = rebuildResume(value, key)
    expect(recovery.facts).toMatchObject({ 材料包状态: '已过期', 审核证据过期: true, 审核完成: false, 裁决: '已批准' })
    expect(recovery.injection.材料段['材料读取警告']).toContain('补充来源已过期')
    expect(saved(value, evidencePaths)).toEqual(evidence)
  })

  it('persists the same effects across Git failure, rejects a copied same-id receipt, then resumes without refreshing history', () => {
    const value = archivedBook(), evidence = saved(value, evidencePaths), plan = ready(value)
    hook(value, 'exit 1')
    expect(apply(value, plan.fingerprint)).toMatchObject({ ok: false, state: 'written-pending-commit' })
    const receipt = readUpgradeReceipt(createReadonlyBookSnapshot(value), plan.fingerprint)!
    expect(receipt.effects).toEqual(plan.effects)
    const copy = root(); fs.cpSync(value, copy, { recursive: true })
    const copied = allBytes(copy)
    expect(previewBookUpgradeResume(copy, plan.fingerprint)).toMatchObject({ ok: false, state: 'blocked' })
    expect(allBytes(copy)).toEqual(copied)
    fs.unlinkSync(path.join(value, '.git/hooks/pre-commit'))
    const continuation = previewBookUpgradeResume(value, plan.fingerprint)
    expect(continuation).toMatchObject({ ok: true, state: 'pending-commit', effects: plan.effects })
    expect(resume(value, plan.fingerprint)).toMatchObject({ ok: true, state: 'committed', effects: plan.effects })
    expect(saved(value, evidencePaths)).toEqual(evidence)
    const completed = git(value, 'rev-parse', 'HEAD')
    expect(resume(value, plan.fingerprint)).toMatchObject({ ok: true, state: 'already-committed', effects: plan.effects })
    expect(git(value, 'rev-parse', 'HEAD')).toBe(completed)
    expect(rebuildResume(value, key).facts.审核证据过期).toBe(true)
  })

  it('never waives preexisting stale sources, damaged excerpts or out-of-scope supplemental sources', () => {
    for (const kind of ['preexisting', 'damaged', 'external']) {
      const value = archivedBook()
      if (kind === 'preexisting') {
        put(value, source, read(value, source) + '\n作者后来追加。\n')
        git(value, 'add', source); git(value, 'commit', '--quiet', '-m', 'fix: fixture later source')
      } else if (kind === 'damaged') put(value, excerptPath, read(value, excerptPath) + '附件后来修改。')
      else {
        const manifest = JSON.parse(read(value, materialManifest))
        const row = manifest.段.find((item: { 类型?: string }) => item.类型 === '补充')
        row.来源快照.域 = '书房'
        row.来源 = [`书房/${source}:12-12`]
        put(value, materialManifest, JSON.stringify(manifest))
      }
      const before = allBytes(value), preview = previewBookUpgrade(value)
      expect(preview.state, `${kind}: ${JSON.stringify(preview.issues)}`).toBe('blocked')
      expect(preview.fingerprint).toBeUndefined()
      expect(allBytes(value)).toEqual(before)
    }
  })

  it('upgrades a fresh local clone whose ignored draft directory never existed', () => {
    const original = simpleBook(), cloned = root()
    execFileSync('git', ['-c', 'core.autocrlf=false', 'clone', '--quiet', '--no-hardlinks', '--config', 'core.autocrlf=false', original, cloned], { windowsHide: true, encoding: 'utf8' })
    gitConfig(cloned)
    expect(fs.existsSync(path.join(cloned, '草稿区'))).toBe(false)
    const plan = ready(cloned)
    expect(apply(cloned, plan.fingerprint)).toMatchObject({ ok: true, state: 'committed' })
    expect(fs.existsSync(path.join(cloned, upgradeReceiptPath(plan.fingerprint)))).toBe(true)
    expect(git(cloned, 'status', '--porcelain')).toBe('')
    expect(resume(cloned, plan.fingerprint)).toMatchObject({ ok: true, state: 'already-committed' })
  })

  it('does not mistake separately committed subsets for one approved maintenance commit', () => {
    const value = simpleBook(), plan = ready(value)
    expect(plan.changes.length).toBeGreaterThan(1)
    hook(value, 'exit 1')
    expect(apply(value, plan.fingerprint)).toMatchObject({ ok: false, state: 'written-pending-commit' })
    fs.unlinkSync(path.join(value, '.git/hooks/pre-commit'))
    const [first, ...rest] = plan.changes.map(change => change.relPath)
    git(value, 'commit', '--only', '--quiet', '-m', 'fix: fixture partial one', '--', first!)
    git(value, 'commit', '--only', '--quiet', '-m', 'fix: fixture partial two', '--', ...rest)
    const head = git(value, 'rev-parse', 'HEAD'), bytes = saved(value, plan.changes.map(change => change.relPath))
    const receipt = readUpgradeReceipt(createReadonlyBookSnapshot(value), plan.fingerprint)!
    expect(upgradeCommitted(value, receipt)).toBeUndefined()
    expect(previewBookUpgradeResume(value, plan.fingerprint).state).not.toBe('committed')
    expect(resume(value, plan.fingerprint).ok).toBe(false)
    expect(git(value, 'rev-parse', 'HEAD')).toBe(head)
    expect(saved(value, plan.changes.map(change => change.relPath))).toEqual(bytes)
  })

  it('reports an unverified result when a commit hook modifies another source after the approved transaction', () => {
    const value = simpleBook(), plan = ready(value), unrelated = paths.故事骨架()
    hook(value, `printf '\\nfixture hook source change\\n' >> '${unrelated}'`)
    const result = apply(value, plan.fingerprint)
    expect(result, JSON.stringify(result)).toMatchObject({ ok: false, state: 'written-pending-commit', code: 'UPGRADE_COMMIT_UNVERIFIED' })
    expect(read(value, unrelated)).toContain('fixture hook source change')
    for (const change of plan.changes) expect(read(value, change.relPath)).toBe(change.after)
    expect(git(value, 'status', '--porcelain')).not.toBe('')
  })
})
