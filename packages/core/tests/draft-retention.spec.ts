import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertDraftRetentionAnchor, assertDraftRetentionBinding, captureDraftRetention, draftRetentionDigest,
  parseDraftRetention, verifyDraftRetention, type DraftRetentionManifest,
} from '../src/repo/draft-retention'
import { computePack, preparePack } from '../src/prepare/pack'
import { createReadonlyBookSnapshot } from '../src/maintenance/snapshot'
import { parseDocument, serializeDocument } from '../src/repo/frontmatter'
import { paths } from '../src/repo/paths'
import { removeSync } from '../src/repo/remove'

const temporary = fs.realpathSync.native(os.tmpdir())
const roots: string[] = []
const chapter = { 卷: 2, 章: 17, 章名: '桥上夜话' }
const bookId = 'retention-fixture'
const directory = paths.草稿目录(chapter.卷, chapter.章名)
const sourceDraft = `${directory}/稿4.md`
const retained = `${directory}/稿9.md`
const staging = `${directory}/稿4.起草中.txt`
const prose = '# 桥上夜话\n\n铜铃响过，众人留在桥上。'
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

function put(root: string, relative: string, text: string | Buffer): void {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

function fixture(sourceIdentity = true): string {
  const root = fs.mkdtempSync(path.join(temporary, 'draft-retention-'))
  roots.push(root)
  put(root, paths.契约(), serializeDocument({ 书id: bookId }, '# 契约\n'))
  const source = serializeDocument({ ...(sourceIdentity ? { 身份: chapter } : {}), 版本: 4, 父版本: 3,
    角色: '待审稿', 选定: true, 保真风险: [] }, `${prose}\n\n## 草稿候选事实\n- 事实：众人留在桥上。`)
  put(root, sourceDraft, '\uFEFF' + source.replace(/\n/g, '\r\n'))
  put(root, retained, serializeDocument({ 身份: chapter, 版本: 9, 父版本: 4, 角色: '草稿', 选定: false, 保真风险: ['改动了交易条件'] }, '未选用的另一种表达。'))
  put(root, staging, '铜铃响过，半稿尚未写完。\r\n')
  return root
}

function capture(root: string) {
  return captureDraftRetention(root, { bookId, chapter, sourceDraft })
}

function finalText(manifest: DraftRetentionManifest, body = prose): string {
  return serializeDocument({ 身份: chapter, 章号: chapter.章, 草稿留档摘要: draftRetentionDigest(manifest) }, body)
}

function bytes(root: string): Record<string, string> {
  const result: Record<string, string> = {}
  const walk = (relative: string): void => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const file = path.posix.join(relative, entry.name)
      if (entry.isSymbolicLink()) result[file] = `link:${fs.readlinkSync(path.join(root, file))}`
      else if (entry.isDirectory()) { result[`${file}/`] = ''; walk(file) }
      else result[file] = sha(fs.readFileSync(path.join(root, file)))
    }
  }
  walk('')
  return result
}

afterEach(() => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  for (const root of roots.splice(0)) {
    if (path.dirname(path.resolve(root)) !== temporary || !path.basename(root).startsWith('draft-retention-')) throw new Error('Unsafe retention fixture cleanup')
    removeSync(root)
  }
})

describe('versioned draft retention evidence', () => {
  it('captures source, higher unselected draft and partial staging without writing or confusing draft and chapter numbers', () => {
    const root = fixture(), before = bytes(root), result = capture(root)
    expect(result.manifest).toMatchObject({ schema: 1, bookId, chapter, directory, sourceDraft, sourceProseSha256: sha(prose) })
    expect(result.pendingDrafts).toEqual([sourceDraft])
    expect(result.manifest.files).toEqual([
      { relPath: sourceDraft, kind: 'draft', sha256: sha(fs.readFileSync(path.join(root, sourceDraft))) },
      { relPath: staging, kind: 'staging', sha256: sha(fs.readFileSync(path.join(root, staging))) },
      { relPath: retained, kind: 'draft', sha256: sha(fs.readFileSync(path.join(root, retained))) },
    ].sort((left, right) => left.relPath < right.relPath ? -1 : 1))
    expect(result.sourceText.startsWith('\uFEFF')).toBe(true)
    expect(result.sourceText).toContain('\r\n')
    expect(verifyDraftRetention(root, result.manifest)).toEqual({ ok: true, issues: [], missingRetained: [] })
    expect(bytes(root)).toEqual(before)
  })

  it('allows wholly absent draft identity using the explicit chapter, without filling source metadata', () => {
    const root = fixture(false), original = fs.readFileSync(path.join(root, sourceDraft))
    expect(capture(root).manifest.chapter).toEqual(chapter)
    expect(fs.readFileSync(path.join(root, sourceDraft))).toEqual(original)
  })

  it('canonicalizes key and member order but binds every declared value', () => {
    const root = fixture(), { manifest } = capture(root)
    const reordered = { files: [...manifest.files].reverse().map(file => ({ sha256: file.sha256, kind: file.kind, relPath: file.relPath })),
      sourceProseSha256: manifest.sourceProseSha256, sourceDraft, directory, chapter: { 章名: chapter.章名, 章: chapter.章, 卷: chapter.卷 }, bookId, schema: 1 as const }
    expect(draftRetentionDigest(reordered)).toBe(draftRetentionDigest(manifest))
    for (const changed of [{ ...manifest, bookId: 'another-book' }, { ...manifest, chapter: { ...chapter, 章: 18 } },
      { ...manifest, sourceProseSha256: 'a'.repeat(64) }, { ...manifest, files: manifest.files.map(file => ({ ...file, sha256: 'b'.repeat(64) })) }]) {
      expect(draftRetentionDigest(changed)).not.toBe(draftRetentionDigest(manifest))
    }
  })

  it('validates an anchor in pure text independently of current prose after a retcon', () => {
    const root = fixture(), { manifest } = capture(root), text = finalText(manifest)
    expect(() => assertDraftRetentionBinding(text.replace(/\n/g, '\r\n'), manifest)).not.toThrow()
    const retcon = finalText(manifest, '后来经作者批准更正的正文。')
    expect(() => assertDraftRetentionAnchor(retcon, manifest)).not.toThrow()
    expect(() => assertDraftRetentionBinding(retcon, manifest)).toThrow('正文与留档来源稿不一致')
    expect(() => assertDraftRetentionAnchor(text.replace(draftRetentionDigest(manifest), 'c'.repeat(64)), manifest)).toThrow('摘要与清单不一致')
    const wrongChapter = serializeDocument({ 身份: { ...chapter, 章: 18 }, 草稿留档摘要: draftRetentionDigest(manifest) }, prose)
    expect(() => assertDraftRetentionAnchor(wrongChapter, manifest)).toThrow('章节身份不一致')
    expect(() => assertDraftRetentionAnchor(text, { ...manifest, bookId: 'another-book' })).toThrow('摘要与清单不一致')
  })

  it.each([
    ['missing', (_manifest: DraftRetentionManifest) => undefined],
    ['future schema', (manifest: DraftRetentionManifest) => ({ ...manifest, schema: 2 })],
    ['extra field', (manifest: DraftRetentionManifest) => ({ ...manifest, approved: true })],
    ['outside source', (manifest: DraftRetentionManifest) => ({ ...manifest, sourceDraft: '../稿4.md' })],
    ['wrong directory', (manifest: DraftRetentionManifest) => ({ ...manifest, directory: '草稿区/草稿/卷01-桥上夜话' })],
    ['duplicate alias', (manifest: DraftRetentionManifest) => ({ ...manifest, files: [...manifest.files, { ...manifest.files[0]!, relPath: manifest.files[0]!.relPath.toUpperCase() }] })],
    ['missing source', (manifest: DraftRetentionManifest) => ({ ...manifest, files: manifest.files.filter(file => file.relPath !== sourceDraft) })],
    ['wrong kind', (manifest: DraftRetentionManifest) => ({ ...manifest, files: manifest.files.map(file => ({ ...file, kind: 'staging' })) })],
  ] as const)('rejects %s rather than treating malformed evidence as legacy', (_name, change) => {
    const root = fixture(), { manifest } = capture(root)
    expect(() => parseDraftRetention(change(manifest))).toThrow()
  })

  it.each(['卷02-桥上夜话', null, [], { 卷: 2, 章: '17', 章名: '桥上夜话' },
    { 卷: 2, 章: 0, 章名: '桥上夜话' }, { 卷: 2, 章: 17, 章名: '别的章' }, { 卷: 2, 章名: '桥上夜话' }])('rejects conflicting or malformed existing identity: %j', identity => {
    const root = fixture()
    put(root, retained, serializeDocument({ 身份: identity, 角色: '草稿' }, '原文保留。'))
    const before = bytes(root)
    expect(() => capture(root)).toThrow('已有身份无效')
    expect(bytes(root)).toEqual(before)
  })

  it('does not omit unknown files or unreadable documents from a candidate', () => {
    const root = fixture()
    put(root, `${directory}/说明.txt`, '笔记。')
    expect(() => capture(root)).toThrow('未知文件')
    fs.unlinkSync(path.join(root, directory, '说明.txt'))
    put(root, retained, '---\n身份: [\n---\n原文。\n')
    expect(() => capture(root)).toThrow('无法解析')
  })

  it.each(['directory', 'junction', 'hardlink'] as const)('rejects a %s masquerading as a numbered draft', kind => {
    const root = fixture(), file = path.join(root, directory, '稿10.md')
    if (kind === 'directory') fs.mkdirSync(file)
    else if (kind === 'hardlink') fs.linkSync(path.join(root, retained), file)
    else {
      const target = path.join(root, '链接目标')
      fs.mkdirSync(target)
      fs.symlinkSync(target, file, process.platform === 'win32' ? 'junction' : 'dir')
    }
    const before = bytes(root)
    expect(() => capture(root)).toThrow()
    expect(bytes(root)).toEqual(before)
  })

  it('uses the existing Finder exemption without granting it to unknown names or directories', () => {
    const root = fixture(), first = capture(root).manifest
    const metadata = path.join(root, directory, '.DS_Store')
    fs.writeFileSync(metadata, Buffer.from([255, 254, 0, 1]))
    expect(draftRetentionDigest(capture(root).manifest)).toBe(draftRetentionDigest(first))
    expect(verifyDraftRetention(root, first).ok).toBe(true)
    fs.unlinkSync(metadata)
    fs.mkdirSync(metadata)
    expect(() => capture(root)).toThrow('Finder')
  })
})

describe('frozen set revalidation', () => {
  it('separates stable missing retained files, including the source, from strict approval checks', () => {
    const root = fixture(), { manifest } = capture(root)
    fs.unlinkSync(path.join(root, staging))
    expect(verifyDraftRetention(root, manifest).ok).toBe(false)
    expect(verifyDraftRetention(root, manifest, { allowMissingRetained: true })).toEqual({ ok: true, issues: [], missingRetained: [staging] })
    fs.unlinkSync(path.join(root, sourceDraft))
    expect(verifyDraftRetention(root, manifest).issues).toContainEqual(expect.objectContaining({ 代码: 'DRAFT_RETENTION_MISSING', 路径: sourceDraft }))
    const checked = verifyDraftRetention(root, manifest, { allowMissingRetained: true })
    expect(checked).toEqual({ ok: true, issues: [], missingRetained: expect.arrayContaining([staging, sourceDraft]) })
    removeSync(path.join(root, directory))
    expect(verifyDraftRetention(root, manifest).issues).toContainEqual(expect.objectContaining({ 代码: 'DRAFT_RETENTION_DIRECTORY', 路径: directory }))
    const gone = verifyDraftRetention(root, manifest, { allowMissingRetained: true })
    expect(gone.ok, JSON.stringify(gone.issues)).toBe(true)
    expect([...gone.missingRetained].sort()).toEqual(manifest.files.map(file => file.relPath).sort())
  })

  it('rejects changed bytes, new files and same-content renames without extending the frozen set', () => {
    const root = fixture(), { manifest } = capture(root), digest = draftRetentionDigest(manifest)
    fs.appendFileSync(path.join(root, retained), '\n新内容。')
    expect(verifyDraftRetention(root, manifest).issues).toContainEqual(expect.objectContaining({ 代码: 'DRAFT_RETENTION_CHANGED', 路径: retained }))
    fs.renameSync(path.join(root, staging), path.join(root, directory, '稿10.起草中.txt'))
    const checked = verifyDraftRetention(root, manifest, { allowMissingRetained: true })
    expect(checked.issues).toContainEqual(expect.objectContaining({ 代码: 'DRAFT_RETENTION_NEW_FILE', 路径: `${directory}/稿10.起草中.txt` }))
    expect(draftRetentionDigest(manifest)).toBe(digest)
  })

  it('rejects a forged prose hash even if full source bytes still match', () => {
    const root = fixture(), { manifest } = capture(root)
    expect(verifyDraftRetention(root, { ...manifest, sourceProseSha256: sha('另一个正文') }).issues)
      .toContainEqual(expect.objectContaining({ 代码: 'DRAFT_RETENTION_SOURCE_CHANGED' }))
  })

  it('includes current members and missing paths in a caller-owned read set', () => {
    const root = fixture(), { manifest } = capture(root)
    fs.unlinkSync(path.join(root, staging))
    const reader = createReadonlyBookSnapshot(root)
    const checked = verifyDraftRetention(root, manifest, { reader, allowMissingRetained: true })
    expect(checked).toEqual({ ok: true, issues: [], missingRetained: [staging] })
    put(root, staging, '在核对后重新出现。')
    expect(reader.finish().稳定).toBe(false)
    expect(reader.issues.some(item => item.代码 === 'SNAPSHOT_CHANGED' && item.路径 === staging)).toBe(true)
    expect(checked.issues).toEqual([])
  })

  it('does not borrow a snapshot belonging to another book', () => {
    const root = fixture(), other = fixture(), { manifest } = capture(root)
    expect(verifyDraftRetention(root, manifest, { reader: createReadonlyBookSnapshot(other) }).issues)
      .toContainEqual(expect.objectContaining({ 代码: 'DRAFT_RETENTION_BOOK' }))
  })

  it('keeps earlier caller issues separate from each retention result', () => {
    const root = fixture(), { manifest } = capture(root), reader = createReadonlyBookSnapshot(root)
    reader.readFile('无关目录/../旧文件.md')
    const unrelated = [...reader.issues]
    expect(unrelated).toHaveLength(1)
    for (let pass = 0; pass < 3; pass++) {
      const checked = verifyDraftRetention(root, manifest, { reader })
      expect(checked).toEqual({ ok: true, issues: [], missingRetained: [] })
      reader.issues.push(...checked.issues)
    }
    expect(reader.issues).toEqual(unrelated)

    fs.writeFileSync(path.join(root, retained), Buffer.from([0xff]))
    const checked = verifyDraftRetention(root, manifest, { reader, allowMissingRetained: true })
    expect(checked.ok).toBe(false)
    expect(checked.issues).toContainEqual(expect.objectContaining({ 代码: 'READ_FAILED', 路径: retained }))
    expect(checked.issues).not.toContainEqual(unrelated[0])
    expect(reader.issues).toContainEqual(unrelated[0])
  })

  it('does not downgrade disappearance during enumeration to an informational missing file', () => {
    const root = fixture(), { manifest } = capture(root), readdir = fs.readdirSync
    let removed = false
    vi.spyOn(fs, 'readdirSync').mockImplementation(((...args: Parameters<typeof fs.readdirSync>) => {
      const result = Reflect.apply(readdir, fs, args)
      if (!removed && args[0] === path.join(root, directory)) {
        removed = true
        fs.unlinkSync(path.join(root, staging))
      }
      return result
    }) as typeof fs.readdirSync)
    syncBuiltinESMExports()
    const checked = verifyDraftRetention(root, manifest, { allowMissingRetained: true })
    expect(removed).toBe(true)
    expect(checked.ok).toBe(false)
    expect(checked.issues.some(item => item.代码 === 'SNAPSHOT_CHANGED')).toBe(true)
  })
})

describe('preparation freezes the inventory and anchor together', () => {
  it('puts the same complete inventory and digest into the package before approval, without rewriting drafts', () => {
    const root = fixture(), before = bytes(root), result = computePack(root, chapter)
    expect(result.ok, result.reason).toBe(true)
    expect(result.文件).toHaveLength(8)
    const manifestText = result.文件!.find(file => file.relPath.endsWith('/清单.json'))!.content
    const preparedText = result.文件!.find(file => file.relPath.endsWith('/正文.md'))!.content
    const packageManifest = JSON.parse(manifestText)
    const retainedFiles = parseDraftRetention(packageManifest.草稿留档)
    expect(retainedFiles.files).toHaveLength(3)
    expect(() => assertDraftRetentionBinding(preparedText, retainedFiles)).not.toThrow()
    expect(packageManifest.文件.find((file: { 源: string }) => file.源 === '正文.md').sha256).toBe(sha(preparedText))
    expect(bytes(root)).toEqual(before)
    const written = preparePack(root, chapter)
    expect(written.ok, written.reason).toBe(true)
    const persisted = JSON.parse(fs.readFileSync(path.join(root, written.dir, '清单.json'), 'utf8'))
    expect(draftRetentionDigest(persisted.草稿留档)).toBe(draftRetentionDigest(retainedFiles))
    for (const file of retainedFiles.files) expect(sha(fs.readFileSync(path.join(root, file.relPath)))).toBe(file.sha256)
  })

  it('prepares a modern book with completely absent draft identity using the explicit chapter', () => {
    const root = fixture(false), result = computePack(root, chapter)
    expect(result.ok, result.reason).toBe(true)
    const manifest = JSON.parse(result.文件!.find(file => file.relPath.endsWith('/清单.json'))!.content)
    expect(manifest.草稿留档.chapter).toEqual(chapter)
    const source = parseDocument(fs.readFileSync(path.join(root, sourceDraft), 'utf8'))
    expect(source.ok && source.data.fields['身份']).toBeUndefined()
  })

  it.each(['no-contract', 'no-book-id'] as const)('preserves the low-level legacy package for %s', mode => {
    const root = fixture()
    if (mode === 'no-contract') fs.unlinkSync(path.join(root, paths.契约()))
    else put(root, paths.契约(), '# 无书身份的低层夹具\n')
    const result = computePack(root, chapter)
    expect(result.ok, result.reason).toBe(true)
    const manifest = JSON.parse(result.文件!.find(file => file.relPath.endsWith('/清单.json'))!.content)
    const document = parseDocument(result.文件!.find(file => file.relPath.endsWith('/正文.md'))!.content)
    expect(manifest).not.toHaveProperty('草稿留档')
    expect(document.ok && document.data.fields['草稿留档摘要']).toBeUndefined()
  })

  it.each([null, '', 42, [], '  book  '])('does not fall back when a declared book identity is invalid: %j', invalid => {
    const root = fixture()
    put(root, paths.契约(), serializeDocument({ 书id: invalid }, '# 契约'))
    const before = bytes(root), result = computePack(root, chapter)
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('书id无效') })
    expect(result).not.toHaveProperty('文件')
    expect(bytes(root)).toEqual(before)
  })

  it('does not treat a malformed or non-file contract as missing legacy identity', () => {
    const root = fixture()
    put(root, paths.契约(), '---\n书id: [\n---\n坏契约。\n')
    expect(computePack(root, chapter)).toMatchObject({ ok: false, reason: expect.stringContaining('作品契约无法解析') })
    fs.unlinkSync(path.join(root, paths.契约()))
    fs.mkdirSync(path.join(root, paths.契约()))
    expect(computePack(root, chapter).ok).toBe(false)
  })

  it('rejects draft changes occurring after capture but before preparation completes', () => {
    const root = fixture(), read = fs.readFileSync
    put(root, paths.计划时间线(chapter.卷), '# 计划时间线\n')
    let changed = false
    vi.spyOn(fs, 'readFileSync').mockImplementation(((...args: Parameters<typeof fs.readFileSync>) => {
      const result = Reflect.apply(read, fs, args)
      if (!changed && args[0] === path.join(root, paths.计划时间线(chapter.卷))) {
        changed = true
        put(root, `${directory}/稿10.起草中.txt`, '准备期间新增的稿。')
      }
      return result
    }) as typeof fs.readFileSync)
    syncBuiltinESMExports()
    const result = computePack(root, chapter)
    expect(changed).toBe(true)
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('准备期间草稿留档证据变化') })
    expect(result).not.toHaveProperty('文件')
    expect(fs.existsSync(path.join(root, paths.待定稿包目录(chapter.卷, chapter.章名)))).toBe(false)
  })
})
