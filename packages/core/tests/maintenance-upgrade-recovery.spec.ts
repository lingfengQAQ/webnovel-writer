import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withBookLock } from '../src/repo/lock'
import { removeSync } from '../src/repo/remove'
import { createReadonlyBookSnapshot } from '../src/maintenance/snapshot'
import { upgradeRootIdentity } from '../src/maintenance/upgrade-reader'
import { inspectUpgradeInterruption, recoverUpgradeInterruption } from '../src/maintenance/upgrade-recovery'

const operationId = 'a'.repeat(64)
const receiptPath = `草稿区/.maintenance-receipts/${operationId}.json`
const provenance = { operationId, toolName: 'book-upgrade' }
const provenanceOf = (value: string) => ({ ...provenance, bookRootIdentity: upgradeRootIdentity(value) })
const roots: string[] = []
const source = '作品契约/契约.md'
const created = '本书记忆/习惯.md'
const oldText = '\uFEFF---\r\n书id: recovery-fixture\r\n---\r\n原文。  \r\n'
const newText = oldText.replace('书id:', '书仓格式版本: 1\r\n书id:')
const receiptText = JSON.stringify({ operationId, fixture: 'parent validates receipt semantics' }) + '\n'
const ops = [{ relPath: source, content: newText }, { relPath: created, content: '新条目。\r\n' }, { relPath: receiptPath, content: receiptText }]
let moduleUrl: string

function root(): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'maintenance-recovery-'))
  roots.push(value)
  return value
}
function put(value: string, relative: string, text: string): void {
  const file = path.join(value, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
function snapshot(value: string): Record<string, string> {
  const files: Record<string, string> = {}
  function visit(relative: string): void {
    for (const entry of fs.readdirSync(path.join(value, relative), { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) { files[`${child}/`] = ''; visit(child) }
      else files[child] = createHash('sha256').update(fs.readFileSync(path.join(value, child))).digest('hex')
    }
  }
  visit('')
  return files
}
function manifest(value: string): { path: string; data: Record<string, any> } {
  const directory = path.join(value, '.webnovel/transactions')
  const file = path.join(directory, fs.readdirSync(directory)[0]!, 'manifest.json')
  return { path: file, data: JSON.parse(fs.readFileSync(file, 'utf8')) }
}
function mutateManifest(value: string, mutate: (data: Record<string, any>) => void): void {
  const found = manifest(value)
  mutate(found.data)
  fs.writeFileSync(found.path, JSON.stringify(found.data))
}
beforeAll(() => {
  const local = createRequire(import.meta.url)
  const vitest = createRequire(local.resolve('vitest/package.json'))
  const vite = createRequire(vitest.resolve('vite/package.json'))
  const { buildSync } = vite('esbuild') as { buildSync(options: Record<string, unknown>): unknown }
  const output = path.join(root(), 'atomic.mjs')
  buildSync({ entryPoints: [fileURLToPath(new URL('../src/repo/atomic.ts', import.meta.url))], outfile: output, bundle: true, platform: 'node', format: 'esm' })
  moduleUrl = pathToFileURL(output).href
})
afterAll(() => { for (const value of roots.reverse()) removeSync(value) })

function crash(mode: 'rename' | 'committed' | 'staged' | 'preparing' | 'done', count = 1): string {
  const value = root()
  put(value, source, oldText)
  const script = `
    import fs from 'node:fs'; import path from 'node:path'; import { syncBuiltinESMExports } from 'node:module';
    const [url, root, mode, limit, rawOps, rawProvenance] = process.argv.slice(1);
    const rename = fs.renameSync; let count = 0;
    fs.renameSync = function(from, to) {
      const result = rename(from, to);
      if(mode === 'rename' && path.basename(String(from)).startsWith('.webnovel-txn-') && ++count === Number(limit)) process.exit(88);
      if(mode === 'committed' && path.basename(String(to)) === 'manifest.json' && JSON.parse(fs.readFileSync(to,'utf8')).phase === 'committed') process.exit(88);
      if(mode === 'staged' && String(from).endsWith('.preparing')) process.exit(88);
      if(mode === 'preparing' && path.basename(String(to)) === 'manifest.json' && path.dirname(String(to)).endsWith('.preparing')) process.exit(88);
      if(mode === 'done' && String(to).endsWith('.done')) process.exit(88);
      return result;
    };
    syncBuiltinESMExports();
    const { writeBatchAtomic } = await import(url);
    writeBatchAtomic(root, JSON.parse(rawOps), { provenance: JSON.parse(rawProvenance) });
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, moduleUrl, value, mode, String(count), JSON.stringify(ops), JSON.stringify(provenanceOf(value))], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
  expect(child.status, child.stderr).toBe(88)
  return value
}
const inspect = (value: string) => inspectUpgradeInterruption(createReadonlyBookSnapshot(value), operationId)
function recover(value: string): void {
  const before = inspect(value)!
  withBookLock(value, () => recoverUpgradeInterruption(value, operationId, before.fingerprint), provenanceOf(value))
}

describe('operation-specific maintenance recovery', () => {
  it.each([1, 2, 3])('previews without writes and restores raw old/new files after rename %s', count => {
    const value = crash('rename', count)
    const before = snapshot(value)
    expect(inspect(value)).toMatchObject({ phase: 'interrupted', paths: [source, created], receiptText })
    expect(inspect(value)?.transientPaths).toHaveLength(3 - count)
    expect(snapshot(value)).toEqual(before)
    recover(value)
    expect(fs.readFileSync(path.join(value, source), 'utf8')).toBe(oldText)
    expect(fs.existsSync(path.join(value, created))).toBe(false)
    expect(fs.existsSync(path.join(value, receiptPath))).toBe(false)
    expect(inspect(value)).toBeUndefined()
  })

  it('recovers a staged manifest without a staged receipt or any source writes', () => {
    const value = crash('staged')
    expect(inspect(value)).toMatchObject({ phase: 'interrupted', paths: [source, created] })
    expect(inspect(value)?.receiptText).toBeUndefined()
    recover(value)
    expect(fs.readFileSync(path.join(value, source), 'utf8')).toBe(oldText)
    expect(fs.existsSync(path.join(value, created))).toBe(false)
  })

  it('cleans a committed manifest while preserving every completed output', () => {
    const value = crash('committed')
    expect(inspect(value)).toMatchObject({ phase: 'committed', receiptText })
    recover(value)
    for (const op of ops) expect(fs.readFileSync(path.join(value, op.relPath), 'utf8')).toBe(op.content)
    expect(inspect(value)).toBeUndefined()
  })

  it('cleans a complete own preparing manifest without writing any source', () => {
    const value = crash('preparing')
    const before = inspect(value)
    expect(before).toMatchObject({ phase: 'interrupted', transientPaths: [] })
    expect(before?.receiptText).toBeUndefined()
    recover(value)
    expect(fs.readFileSync(path.join(value, source), 'utf8')).toBe(oldText)
    expect(fs.existsSync(path.join(value, created))).toBe(false)
    expect(inspect(value)).toBeUndefined()
  })

  it.each([false, true])('cleans a complete own done manifest with partial backup cleanup=%s', partial => {
    const value = crash('done')
    if (partial) fs.unlinkSync(path.join(path.dirname(manifest(value).path), 'backups/0.bak'))
    expect(inspect(value)).toMatchObject({ phase: 'committed', transientPaths: [], receiptText })
    recover(value)
    for (const op of ops) expect(fs.readFileSync(path.join(value, op.relPath), 'utf8')).toBe(op.content)
    expect(inspect(value)).toBeUndefined()
  })

  it.each(['preparing', 'done'])('rejects a renamed unfinished transaction pretending to be %s cleanup', suffix => {
    const value = crash('rename')
    const directory = path.dirname(manifest(value).path)
    fs.renameSync(directory, `${directory}.${suffix}`)
    const before = snapshot(value)
    expect(() => inspect(value)).toThrow('维护续办拒绝')
    expect(snapshot(value)).toEqual(before)
  })

  it('does not depend on unrelated reads already in the caller snapshot', () => {
    const value = crash('rename')
    put(value, 'unrelated.txt', '其他资料')
    const reader = createReadonlyBookSnapshot(value)
    reader.readFile('unrelated.txt')
    expect(inspectUpgradeInterruption(reader, operationId)?.fingerprint).toBe(inspect(value)?.fingerprint)
  })

  it('requires the exact operation lock and a current evidence fingerprint', () => {
    const value = crash('rename')
    const before = inspect(value)!
    expect(() => recoverUpgradeInterruption(value, operationId, before.fingerprint)).toThrow('没有持有')
    withBookLock(value, () => {
      expect(() => recoverUpgradeInterruption(value, operationId, before.fingerprint)).toThrow('没有持有')
    }, { operationId: 'b'.repeat(64), toolName: 'book-upgrade' })
    mutateManifest(value, data => { data.createdAt = '2026-11-04T00:00:00.000Z' })
    withBookLock(value, () => {
      expect(() => recoverUpgradeInterruption(value, operationId, before.fingerprint)).toThrow('已变化')
    }, provenanceOf(value))
    expect(fs.readFileSync(path.join(value, source), 'utf8')).toBe(newText)
  })

  it.each(['operation', 'tool', 'receipt', 'duplicate', 'source', 'backup-path', 'temporary-path', 'phase', 'coerced-phase', 'checksum'])('rejects malformed or foreign %s evidence without touching files', problem => {
    const value = crash('rename')
    mutateManifest(value, data => {
      if (problem === 'operation') data.provenance.operationId = 'b'.repeat(64)
      if (problem === 'tool') data.provenance.toolName = 'other-write'
      if (problem === 'receipt') data.entries.pop()
      if (problem === 'duplicate') data.entries[1].relPath = source
      if (problem === 'source') data.entries[0].relPath = '../outside.md'
      if (problem === 'backup-path') data.entries[0].backupRel = '.webnovel/transactions/other/backups/0.bak'
      if (problem === 'temporary-path') data.entries[0].tmpRel = '本书记忆/foreign.tmp'
      if (problem === 'phase') data.phase = 'unknown'
      if (problem === 'coerced-phase') data.phase = ['applying']
      if (problem === 'checksum') data.entries[0].contentHash = 'z'.repeat(64)
    })
    const before = snapshot(value)
    expect(() => inspect(value)).toThrow('维护续办拒绝')
    expect(snapshot(value)).toEqual(before)
  })

  it.each(['foreign', 'quarantine', 'preparing', 'done'])('refuses %s entries rather than recovering unrelated work', kind => {
    const value = crash('rename')
    const extra = kind === 'quarantine' ? '.webnovel/quarantine/foreign' : `.webnovel/transactions/foreign${kind === 'preparing' || kind === 'done' ? `.${kind}` : ''}`
    put(value, `${extra}/evidence.json`, '{}')
    const before = snapshot(value)
    expect(() => inspect(value)).toThrow('维护续办拒绝')
    expect(snapshot(value)).toEqual(before)
  })

  it.each(['author-target', 'backup', 'temporary', 'missing-backup'])('preserves all evidence when %s conflicts', kind => {
    const value = crash('rename')
    const found = manifest(value).data
    if (kind === 'author-target') put(value, source, '作者后续修改。')
    if (kind === 'backup') put(value, found.entries[0].backupRel, '备份已变。')
    if (kind === 'temporary') put(value, found.entries[1].tmpRel, '临时输出已变。')
    if (kind === 'missing-backup') fs.unlinkSync(path.join(value, found.entries[0].backupRel))
    const before = snapshot(value)
    expect(() => inspect(value)).toThrow('维护续办拒绝')
    expect(snapshot(value)).toEqual(before)
  })

  it('rejects author changes even for an already committed file transaction', () => {
    const value = crash('committed')
    put(value, source, '作者后续修改。')
    const before = snapshot(value)
    expect(() => inspect(value)).toThrow('维护续办拒绝')
    expect(snapshot(value)).toEqual(before)
  })

  it('refuses hard-linked recovery evidence instead of modifying an external file', () => {
    const value = crash('rename')
    const backup = manifest(value).data.entries[0].backupRel as string
    const outside = path.join(root(), 'outside.md')
    fs.linkSync(path.join(value, backup), outside)
    expect(() => inspect(value)).toThrow('维护续办拒绝')
    expect(fs.readFileSync(outside, 'utf8')).toBe(oldText)
    expect(fs.readFileSync(path.join(value, source), 'utf8')).toBe(newText)
  })

  it.each(['staged', 'rename', 'committed', 'preparing', 'done'] as const)('refuses a copied %s operation with the same book id in a different physical root', mode => {
    const value = crash(mode)
    const copy = root()
    fs.cpSync(value, copy, { recursive: true })
    const before = snapshot(copy)
    expect(() => inspect(copy)).toThrow('不属于当前物理书仓')
    expect(snapshot(copy)).toEqual(before)
  })
})
