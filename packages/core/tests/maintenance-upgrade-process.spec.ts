import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { scaffoldBookFiles } from '../src/book/scaffold'
import { paths } from '../src/repo/paths'
import { removeSync } from '../src/repo/remove'
import { previewBookUpgrade } from '../src/maintenance/upgrade-plan'
import { applyBookUpgrade, previewBookUpgradeResume, resumeBookUpgrade } from '../src/maintenance/upgrade'
import { readUpgradeReceipt, upgradeReceiptPath, verifyUpgradeOutputs } from '../src/maintenance/upgrade-receipt'
import { createReadonlyBookSnapshot } from '../src/maintenance/snapshot'
import { queryLedger } from '../src/ledger'
import { serializeDocument } from '../src/repo/frontmatter'
import { 定位段小节, 单元字段 } from '../src/outline/template'

const temp = fs.realpathSync.native(os.tmpdir())
const fixtures = fileURLToPath(new URL('./fixtures/maintenance-upgrade/', import.meta.url))
const bookId = 'upgrade-process-fixture'
const sourcePaths = [paths.契约(), paths.账本('线索'), paths.账本('时间线')]
let moduleDirectory: string, moduleUrl: string, root: string
const extraRoots: string[] = []

const put = (relative: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true }); fs.writeFileSync(path.join(root, relative), text) }
const get = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8')
const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim()
function snapshot(directory = root): Record<string, string> {
  const found: Record<string, string> = {}
  const visit = (relative: string): void => {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const child = path.posix.join(relative, entry.name)
      if (entry.isDirectory()) { found[child + '/'] = ''; visit(child) }
      else found[child] = createHash('sha256').update(fs.readFileSync(path.join(directory, child))).digest('hex')
    }
  }
  visit(''); return found
}
function cleanup(directory: string): void {
  if (path.dirname(directory) !== temp || !path.basename(directory).startsWith('upgrade-process-')) throw new Error('Unsafe process fixture cleanup')
  removeSync(directory)
}

beforeAll(() => {
  moduleDirectory = fs.mkdtempSync(path.join(temp, 'upgrade-process-module-'))
  const local = createRequire(import.meta.url), vitest = createRequire(local.resolve('vitest/package.json')), vite = createRequire(vitest.resolve('vite/package.json'))
  const { buildSync } = vite('esbuild') as { buildSync(options: Record<string, unknown>): void }
  const output = path.join(moduleDirectory, 'upgrade.mjs')
  buildSync({
    entryPoints: [fileURLToPath(new URL('../src/maintenance/upgrade.ts', import.meta.url))], outfile: output, bundle: true, platform: 'node', format: 'esm',
    banner: { js: 'import { createRequire as fixtureCreateRequire } from "node:module"; const require = fixtureCreateRequire(import.meta.url);' },
  })
  moduleUrl = pathToFileURL(output).href
})
afterAll(() => cleanup(moduleDirectory))
beforeEach(() => {
  root = fs.mkdtempSync(path.join(temp, 'upgrade-process-book-'))
  scaffoldBookFiles(root, { 状态: '已确认', 核心创意: '渡口的旧船票引出旧案。', 题材与目标读者: '成年幻想读者。' }, { bookId })
  put(paths.契约(), '\uFEFF' + get(paths.契约()).replace('书仓格式版本: 1\n', '').replace(/\n/g, '\r\n'))
  put(paths.账本('线索'), fs.readFileSync(path.join(fixtures, 'historical-clue.md'), 'utf8'))
  put(paths.账本('时间线'), fs.readFileSync(path.join(fixtures, 'historical-timeline.md'), 'utf8'))
  git('init', '--quiet'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid')
  git('config', 'commit.gpgsign', 'false'); git('config', 'core.hooksPath', '.git/hooks'); git('config', 'core.autocrlf', 'false')
  git('add', '.'); git('commit', '--quiet', '-m', 'vol: process fixture')
})
afterEach(() => { cleanup(root); for (const copy of extraRoots.splice(0)) cleanup(copy) })

type CrashMode = 'first-target' | 'receipt' | 'committed'
function crash(mode: CrashMode) {
  const plan = previewBookUpgrade(root)
  expect(plan.state, JSON.stringify(plan.issues)).toBe('ready')
  const operationId = plan.fingerprint!, baseHead = git('rev-parse', 'HEAD')
  const originals = Object.fromEntries(sourcePaths.map(relative => [relative, get(relative)]))
  const script = `
    import fs from 'node:fs'; import path from 'node:path'; import { syncBuiltinESMExports } from 'node:module';
    const [url, root, bookId, operationId, mode] = process.argv.slice(1);
    const receipt = path.resolve(root, '草稿区/.maintenance-receipts', operationId + '.json');
    const rename = fs.renameSync;
    fs.renameSync = function(from, to) {
      const result = rename(from, to);
      const targetRename = path.basename(String(from)).startsWith('.webnovel-txn-');
      const matched = mode === 'first-target' && targetRename
        || mode === 'receipt' && targetRename && path.resolve(String(to)) === receipt
        || mode === 'committed' && path.basename(String(to)) === 'manifest.json'
          && JSON.parse(fs.readFileSync(to, 'utf8')).phase === 'committed';
      if (matched) { process.stdout.write(JSON.stringify({ mode, target: path.relative(root, String(to)) }) + '\\n'); process.exit(88); }
      return result;
    };
    syncBuiltinESMExports();
    const { applyBookUpgrade } = await import(url);
    const result = applyBookUpgrade(root, { bookId, fingerprint: operationId });
    process.stdout.write(JSON.stringify({ unexpectedResult: result })); process.exit(1);
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, moduleUrl, root, bookId, operationId, mode], { encoding: 'utf8', windowsHide: true, timeout: 90000 })
  expect(child.status, child.stderr + child.stdout).toBe(88)
  expect(JSON.parse(child.stdout.trim())).toMatchObject({ mode })
  expect(git('rev-parse', 'HEAD')).toBe(baseHead)
  return { plan, operationId, baseHead, originals }
}

function resume(operationId: string) {
  const before = snapshot(), preview = previewBookUpgradeResume(root, operationId)
  expect(preview.ok, preview.reason).toBe(true)
  expect(snapshot()).toEqual(before)
  const result = resumeBookUpgrade(root, { bookId, operationId, fingerprint: preview.fingerprint! })
  return { preview, result }
}

describe('public maintenance API across an actual exited process', () => {
  it.each(['receipt', 'committed'] as const)('retains ignored draft backup across actual %s process exit', mode => {
    const key = { 卷: 1, 章: 5, 章名: '停笔' }, draft = '草稿区/草稿/卷01-停笔/稿9.md'
    put(paths.确认细纲(1, 5, key.章名), serializeDocument({ 身份: key, 状态: '已确认', 版本: 1 }, [
      '# 章细纲', '## 定位段', ...定位段小节.flatMap(name => [`### ${name}`, '合成内容']),
      '## 细纲段', '### 单元 1', ...单元字段.map(name => `- ${name}：合成内容`),
    ].join('\n')))
    const old = '---\n身份: 卷01-停笔\n版本: 9\n角色: 草稿\n---\n原稿保留。\n'
    put(draft, old); git('add', '.'); git('commit', '--quiet', '-m', 'fixture: numbered outline')
    const { plan, operationId, baseHead } = crash(mode)
    const after = plan.changes.find(change => change.relPath === draft)!.after
    expect(get(draft)).toBe(after)
    const result = resume(operationId).result
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, state: mode === 'receipt' ? 'recovered' : 'committed' })
    expect(get(draft)).toBe(mode === 'receipt' ? old : after)
    expect(git('ls-files', '--', '草稿区')).toBe('')
    expect(git('rev-list', '--count', `${baseHead}..HEAD`)).toBe(mode === 'receipt' ? '0' : '1')
    if (mode === 'committed') {
      const receipt = readUpgradeReceipt(createReadonlyBookSnapshot(root), operationId)!
      expect(receipt.drafts?.[0]).toMatchObject({ relPath: draft, before: old, after })
      expect(resume(operationId).result.state).toBe('already-committed')
    }
  }, 120_000)

  it.each(['first-target', 'receipt'] as const)('restores the precise old book after %s exit and requires a fresh approved upgrade', mode => {
    const { plan, operationId, baseHead, originals } = crash(mode)
    const beforePreview = snapshot(), interrupted = previewBookUpgradeResume(root, operationId)
    expect(interrupted, interrupted.reason).toMatchObject({ ok: true, state: 'interrupted', operationId, bookId })
    expect(interrupted.paths.slice().sort()).toEqual(plan.changes.map(change => change.relPath).sort())
    expect(snapshot()).toEqual(beforePreview)
    if (mode === 'first-target') expect(git('status', '--porcelain')).toContain('.webnovel-txn-')
    if (mode === 'receipt') expect(fs.existsSync(path.join(root, upgradeReceiptPath(operationId)))).toBe(true)
    const { result } = resume(operationId)
    expect(result).toMatchObject({ ok: true, state: 'recovered', operationId })
    for (const [relative, text] of Object.entries(originals)) expect(get(relative)).toBe(text)
    expect(git('rev-parse', 'HEAD')).toBe(baseHead)
    expect(git('status', '--porcelain')).toBe('')
    expect(fs.existsSync(path.join(root, upgradeReceiptPath(operationId)))).toBe(false)
    expect(fs.readdirSync(path.join(root, '.webnovel/transactions'))).toEqual([])
    const fresh = previewBookUpgrade(root)
    expect(fresh.state, JSON.stringify(fresh.issues)).toBe('ready')
    expect(fresh.changes).toEqual(plan.changes)
    // Recovery itself is not approval to transform; the source stays unchanged.
    expect(get(paths.契约())).toBe(originals[paths.契约()])
  }, 120_000)

  it('finishes only Git after a committed file batch and proves the exact receipt outputs once', () => {
    const { plan, operationId, baseHead } = crash('committed')
    for (const change of plan.changes) expect(get(change.relPath)).toBe(change.after)
    const receiptBefore = get(upgradeReceiptPath(operationId)), { preview, result } = resume(operationId)
    expect(preview.state).toBe('pending-commit')
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, state: 'committed', operationId })
    expect(git('rev-list', '--count', `${baseHead}..HEAD`)).toBe('1')
    expect(get(upgradeReceiptPath(operationId))).toBe(receiptBefore)
    const reader = createReadonlyBookSnapshot(root), receipt = readUpgradeReceipt(reader, operationId)!
    expect(receipt.bookId).toBe(bookId)
    expect(receipt.baseHead).toBe(baseHead)
    expect(receipt.outputs.map(output => output.relPath).sort()).toEqual(plan.changes.map(change => change.relPath).sort())
    verifyUpgradeOutputs(reader, receipt)
    expect(reader.finish().稳定).toBe(true)
    expect(queryLedger(root, { 分类: '时间线' }).entries[0]?.字段['事件']).toBe('林舟在渡口遇见摆渡人')
    const current = git('rev-parse', 'HEAD')
    expect(resume(operationId).result).toMatchObject({ ok: true, state: 'already-committed', operationId })
    expect(git('rev-parse', 'HEAD')).toBe(current)
    expect(previewBookUpgrade(root).state).toBe('unchanged')
  }, 120_000)

  it('rejects author edits after a crash and preserves every current byte and recovery artifact', () => {
    const { plan, operationId, baseHead } = crash('first-target')
    const changed = plan.changes[0]!.relPath
    put(changed, get(changed) + '\n作者在中断后补充的原文。\n')
    const before = snapshot(), preview = previewBookUpgradeResume(root, operationId)
    expect(preview.ok).toBe(false)
    expect(preview.state).toBe('blocked')
    expect(resumeBookUpgrade(root, { bookId, operationId, fingerprint: operationId }).ok).toBe(false)
    expect(applyBookUpgrade(root, { bookId, fingerprint: operationId }).ok).toBe(false)
    expect(snapshot()).toEqual(before)
    expect(git('rev-parse', 'HEAD')).toBe(baseHead)
  }, 120_000)

  it('rejects another operation and a copied physical book without changing their evidence', () => {
    const { operationId } = crash('receipt')
    const original = snapshot()
    expect(previewBookUpgradeResume(root, 'f'.repeat(64)).ok).toBe(false)
    expect(snapshot()).toEqual(original)
    const copy = fs.mkdtempSync(path.join(temp, 'upgrade-process-copy-')); extraRoots.push(copy)
    fs.cpSync(root, copy, { recursive: true })
    const beforeCopy = snapshot(copy), preview = previewBookUpgradeResume(copy, operationId)
    expect(preview.ok).toBe(false)
    expect(preview.reason).toContain('物理书仓')
    expect(snapshot(copy)).toEqual(beforeCopy)
    expect(snapshot()).toEqual(original)
  }, 120_000)
})
