import { createHash } from 'node:crypto'
import path from 'node:path'
import type { ChapterKey } from '../derive/scan'
import { createReadonlyBookSnapshot, type ReadonlyBookSnapshot } from '../maintenance/snapshot'
import { uniqueMaintenanceIssues, type MaintenanceIssue } from '../maintenance/types'
import { parseDocument } from './frontmatter'
import { splitCandidateFacts } from './drafts'
import { paths, validateSegment } from './paths'

export interface DraftRetentionFile {
  readonly relPath: string
  readonly kind: 'draft' | 'staging'
  readonly sha256: string
}

/** A candidate inventory becomes historical evidence only through author approval and its Git anchor. */
export interface DraftRetentionManifest {
  readonly schema: 1
  readonly bookId: string
  readonly chapter: ChapterKey
  readonly directory: string
  readonly sourceDraft: string
  readonly sourceProseSha256: string
  readonly files: readonly DraftRetentionFile[]
}

export interface DraftRetentionCapture {
  readonly manifest: DraftRetentionManifest
  readonly sourceText: string
  /** Same-read role evidence for preparation; this is not part of the persisted inventory. */
  readonly pendingDrafts: readonly string[]
}

export interface DraftRetentionVerification {
  readonly ok: boolean
  readonly issues: readonly MaintenanceIssue[]
  readonly missingRetained: readonly string[]
}

export interface DraftRetentionVerifyOptions {
  readonly allowMissingRetained?: boolean
  /** The caller must finish this shared read set again before accepting its complete inspection. */
  readonly reader?: ReadonlyBookSnapshot
}

const HASH = /^[a-f0-9]{64}$/
const hash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const alias = (relative: string): string => relative.normalize('NFC').toLowerCase()
const issue = (代码: string, 路径: string, 说明: string): MaintenanceIssue => ({ 代码, 路径, 说明 })

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function chapterOf(value: unknown): ChapterKey {
  if (!object(value) || !exactKeys(value, ['卷', '章', '章名']) || !positive(value['卷']) || !positive(value['章'])
    || typeof value['章名'] !== 'string' || validateSegment(value['章名']).length) throw new Error('草稿留档清单的章节身份无效')
  return { 卷: value['卷'], 章: value['章'], 章名: value['章名'] }
}

function validBookId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value && !/[\x00-\x1f]/.test(value)
}

function directoryMatches(directory: string, chapter: ChapterKey): boolean {
  const match = /^草稿区\/草稿\/卷(\d+)-([^/\\]+)$/.exec(directory)
  return match !== null && Number(match[1]) === chapter.卷 && match[2] === chapter.章名
}

function fileKind(relative: string, directory: string): DraftRetentionFile['kind'] | undefined {
  if (path.posix.dirname(relative) !== directory || relative.includes('\\')) return undefined
  const match = /^稿(\d+)(\.md|\.起草中\.txt)$/i.exec(path.posix.basename(relative))
  if (match === null || !positive(Number(match[1]))) return undefined
  return match[2]!.toLowerCase() === '.md' ? 'draft' : 'staging'
}

/** Parse a closed, versioned protocol; absence and unsupported versions are not empty inventories. */
export function parseDraftRetention(value: unknown): DraftRetentionManifest {
  if (!object(value) || !exactKeys(value, ['schema', 'bookId', 'chapter', 'directory', 'sourceDraft', 'sourceProseSha256', 'files'])
    || value['schema'] !== 1 || !validBookId(value['bookId']) || typeof value['directory'] !== 'string'
    || typeof value['sourceDraft'] !== 'string' || typeof value['sourceProseSha256'] !== 'string' || !HASH.test(value['sourceProseSha256'])
    || !Array.isArray(value['files']) || value['files'].length === 0) throw new Error('草稿留档清单协议无效或版本尚未支持')
  const chapter = chapterOf(value['chapter'])
  const directory = value['directory'], sourceDraft = value['sourceDraft']
  if (!directoryMatches(directory, chapter) || fileKind(sourceDraft, directory) !== 'draft') throw new Error('草稿留档目录或来源稿与章节不一致')
  const seen = new Set<string>()
  const files = value['files'].map((file: unknown): DraftRetentionFile => {
    if (!object(file) || !exactKeys(file, ['relPath', 'kind', 'sha256']) || typeof file['relPath'] !== 'string'
      || typeof file['sha256'] !== 'string' || !HASH.test(file['sha256']) || (file['kind'] !== 'draft' && file['kind'] !== 'staging')
      || fileKind(file['relPath'], directory) !== file['kind'] || seen.has(alias(file['relPath']))) throw new Error('草稿留档文件清单存在非法路径、类型或重复别名')
    seen.add(alias(file['relPath']))
    return { relPath: file['relPath'], kind: file['kind'], sha256: file['sha256'] }
  }).sort((left, right) => compare(left.relPath, right.relPath))
  if (!files.some(file => file.relPath === sourceDraft && file.kind === 'draft')) throw new Error('草稿留档清单缺少明确的来源稿')
  return { schema: 1, bookId: value['bookId'], chapter, directory, sourceDraft, sourceProseSha256: value['sourceProseSha256'], files }
}

/** Key and member order do not change the digest; every declared value remains bound. */
export function draftRetentionDigest(manifest: DraftRetentionManifest): string {
  const parsed = parseDraftRetention(manifest)
  return hash(JSON.stringify(parsed, (_key, value: unknown) => object(value)
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => compare(left, right))) : value))
}

function preparedProse(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/\n+$/, '')
}

function sourceProseHash(text: string): string {
  const parsed = parseDocument(text)
  if (!parsed.ok) throw new Error('草稿留档来源稿无法解析')
  return hash(preparedProse(splitCandidateFacts(parsed.data.body).prose))
}

/** Accepts saved text or a historical Git blob; it never reads the current filesystem. */
export function assertDraftRetentionAnchor(finalText: string, manifest: DraftRetentionManifest): void {
  const retention = parseDraftRetention(manifest)
  const parsed = parseDocument(finalText)
  if (!parsed.ok) throw new Error('留档锚点所在的定稿文档无法解析')
  const identity = parsed.data.fields['身份']
  if (!object(identity) || identity['卷'] !== retention.chapter.卷 || identity['章'] !== retention.chapter.章
    || identity['章名'] !== retention.chapter.章名 || (parsed.data.fields['章号'] !== undefined && parsed.data.fields['章号'] !== retention.chapter.章)) {
    throw new Error('留档锚点与定稿章节身份不一致')
  }
  if (parsed.data.fields['草稿留档摘要'] !== draftRetentionDigest(retention)) throw new Error('定稿草稿留档摘要与清单不一致')
}

/** New archives also bind the prepared prose; later retcons use the original archive or anchor-only proof. */
export function assertDraftRetentionBinding(finalText: string, manifest: DraftRetentionManifest): void {
  assertDraftRetentionAnchor(finalText, manifest)
  const parsed = parseDocument(finalText)
  if (!parsed.ok || hash(preparedProse(parsed.data.body)) !== manifest.sourceProseSha256) throw new Error('定稿正文与留档来源稿不一致')
}

function bookIdentityIssues(reader: ReadonlyBookSnapshot, bookId: string): MaintenanceIssue[] {
  const text = reader.readFile(paths.契约())
  const parsed = text === undefined ? undefined : parseDocument(text)
  return parsed?.ok && parsed.data.fields['书id'] === bookId ? []
    : [issue('DRAFT_RETENTION_BOOK', paths.契约(), '留档清单与当前可核实的书身份不一致')]
}

function documentIssues(relative: string, text: string, chapter: ChapterKey): MaintenanceIssue[] {
  const parsed = parseDocument(text)
  if (!parsed.ok) return [issue('DRAFT_RETENTION_DOCUMENT', relative, `留档工件无法解析：${parsed.detail}`)]
  const fields = parsed.data.fields, problems: MaintenanceIssue[] = []
  const identity = fields['身份']
  // A wholly absent identity uses the caller's explicit chapter evidence; no field is filled or rewritten.
  if (identity !== undefined && (!object(identity) || identity['卷'] !== chapter.卷 || identity['章'] !== chapter.章 || identity['章名'] !== chapter.章名)) {
    problems.push(issue('DRAFT_RETENTION_IDENTITY', relative, '留档工件的已有身份无效或与明确章节不一致，不能猜测或改写'))
  }
  if (fields['章号'] !== undefined && fields['章号'] !== chapter.章) problems.push(issue('DRAFT_RETENTION_IDENTITY', relative, '留档工件的已有章号与明确章节不一致'))
  if (fields['版本'] !== undefined && !positive(fields['版本'])) problems.push(issue('DRAFT_RETENTION_DOCUMENT', relative, '留档工件的已有版本须为正整数'))
  if (fields['父版本'] !== undefined && fields['父版本'] !== null && !positive(fields['父版本'])) problems.push(issue('DRAFT_RETENTION_DOCUMENT', relative, '留档工件的父版本须为空或正整数'))
  if (fields['角色'] !== undefined && fields['角色'] !== '草稿' && fields['角色'] !== '待审稿') problems.push(issue('DRAFT_RETENTION_DOCUMENT', relative, '留档工件的已有角色无效'))
  if (fields['选定'] !== undefined && typeof fields['选定'] !== 'boolean') problems.push(issue('DRAFT_RETENTION_DOCUMENT', relative, '留档工件的选定标记须为布尔值'))
  return problems
}

function readCollection(reader: ReadonlyBookSnapshot, directory: string, chapter: ChapterKey, allowMissingDirectory = false): {
  files: DraftRetentionFile[]; texts: Map<string, string>; issues: MaintenanceIssue[]; pendingDrafts: string[]
} {
  const files: DraftRetentionFile[] = [], texts = new Map<string, string>(), issues: MaintenanceIssue[] = [], pendingDrafts: string[] = []
  const entries = reader.listDirectory(directory)
  // A stably absent directory is just absent retained copies; unreadable directories still surface through reader.issues.
  if (entries === undefined && !(allowMissingDirectory && !reader.issues.some(item => item.路径 === directory))) issues.push(issue('DRAFT_RETENTION_DIRECTORY', directory, '草稿留档目录不存在或无法安全读取'))
  const names = new Set<string>()
  for (const entry of entries ?? []) {
    const relative = `${directory}/${entry.name}`, kind = fileKind(relative, directory)
    if (entry.kind !== 'file' || kind === undefined || names.has(alias(relative))) {
      issues.push(issue('DRAFT_RETENTION_ENTRY', relative, '留档目录含未知文件、非普通文件或重复别名'))
      if (entry.kind !== 'file') reader.readFile(relative)
      continue
    }
    names.add(alias(relative))
    const text = reader.readFile(relative)
    if (text === undefined) { issues.push(issue('DRAFT_RETENTION_MISSING', relative, '留档工件读取失败或在采集期间消失')); continue }
    issues.push(...documentIssues(relative, text, chapter))
    files.push({ relPath: relative, kind, sha256: hash(text) })
    texts.set(relative, text)
    const parsed = parseDocument(text)
    if (kind === 'draft' && parsed.ok && parsed.data.fields['角色'] === '待审稿') pendingDrafts.push(relative)
  }
  return { files: files.sort((left, right) => compare(left.relPath, right.relPath)), texts, issues, pendingDrafts }
}

/** Read an entire chapter directory, including staging files. Nothing is written or approved here. */
export function captureDraftRetention(root: string, input: {
  readonly bookId: string; readonly chapter: ChapterKey; readonly sourceDraft: string
}): DraftRetentionCapture {
  const chapter = chapterOf(input.chapter), directory = path.posix.dirname(input.sourceDraft)
  if (!validBookId(input.bookId) || !directoryMatches(directory, chapter) || fileKind(input.sourceDraft, directory) !== 'draft') throw new Error('草稿留档采集需要明确的书身份、章节和来源稿')
  const reader = createReadonlyBookSnapshot(root)
  const issues = bookIdentityIssues(reader, input.bookId)
  const collection = readCollection(reader, directory, chapter)
  issues.push(...collection.issues)
  const sourceText = collection.texts.get(input.sourceDraft)
  if (sourceText === undefined) issues.push(issue('DRAFT_RETENTION_SOURCE_MISSING', input.sourceDraft, '草稿留档来源稿不存在或无法读取'))
  reader.finish()
  issues.push(...reader.issues)
  if (issues.length || sourceText === undefined) throw new Error(uniqueMaintenanceIssues(issues).map(item => `${item.路径}：${item.说明}`).join('；'))
  const manifest = parseDraftRetention({ schema: 1, bookId: input.bookId, chapter, directory, sourceDraft: input.sourceDraft,
    sourceProseSha256: sourceProseHash(sourceText), files: collection.files })
  return { manifest, sourceText, pendingDrafts: collection.pendingDrafts }
}

/** Revalidate the frozen set. Missing retained files are informational only when explicitly requested. */
export function verifyDraftRetention(root: string, manifest: DraftRetentionManifest, options: DraftRetentionVerifyOptions = {}): DraftRetentionVerification {
  let retention: DraftRetentionManifest
  try { retention = parseDraftRetention(manifest) } catch (error) {
    return { ok: false, issues: [issue('DRAFT_RETENTION_INVALID', '.', error instanceof Error ? error.message : String(error))], missingRetained: [] }
  }
  const reader = options.reader ?? createReadonlyBookSnapshot(root)
  const expectedRoot = path.resolve(root)
  const sameRoot = process.platform === 'win32' ? expectedRoot.toLowerCase() === reader.root.toLowerCase() : expectedRoot === reader.root
  if (!sameRoot) return { ok: false, issues: [issue('DRAFT_RETENTION_BOOK', '.', '留档复验与调用方快照不属于同一书仓')], missingRetained: [] }
  const priorIssues = options.reader === undefined ? 0 : reader.issues.length
  const issues = bookIdentityIssues(reader, retention.bookId), missingRetained: string[] = []
  const collection = readCollection(reader, retention.directory, retention.chapter, options.allowMissingRetained === true)
  issues.push(...collection.issues)
  const expected = new Map(retention.files.map(file => [file.relPath, file]))
  for (const file of collection.files) {
    const recorded = expected.get(file.relPath)
    if (recorded === undefined) issues.push(issue('DRAFT_RETENTION_NEW_FILE', file.relPath, '此工件未列入原留档清单，不能自动视为历史留档'))
    else if (recorded.kind !== file.kind || recorded.sha256 !== file.sha256) issues.push(issue('DRAFT_RETENTION_CHANGED', file.relPath, '留档工件的完整字节已变化，原清单不能证明当前内容'))
  }
  for (const file of retention.files) {
    if (collection.texts.has(file.relPath)) continue
    // Observe absence too; a file appearing after enumeration must invalidate this check.
    const appeared = reader.readFile(file.relPath)
    if (appeared !== undefined) issues.push(issue('DRAFT_RETENTION_CHANGED', file.relPath, '目录枚举与文件读取结果不一致，请重新核对'))
    // After a trusted archive the source prose is already bound to the committed chapter, so its later absence is a notice too.
    else if (!options.allowMissingRetained) issues.push(issue('DRAFT_RETENTION_MISSING', file.relPath, '原留档清单中的工件缺失或无法读取'))
    else if (!reader.issues.some(item => item.路径 === file.relPath)) missingRetained.push(file.relPath)
  }
  const sourceText = collection.texts.get(retention.sourceDraft)
  if (sourceText !== undefined) {
    try {
      if (sourceProseHash(sourceText) !== retention.sourceProseSha256) issues.push(issue('DRAFT_RETENTION_SOURCE_CHANGED', retention.sourceDraft, '留档来源稿的正文与清单不一致'))
    } catch { issues.push(issue('DRAFT_RETENTION_SOURCE_CHANGED', retention.sourceDraft, '留档来源稿正文无法核实')) }
  }
  if (options.reader === undefined) reader.finish()
  issues.push(...reader.issues.slice(priorIssues))
  const unique = uniqueMaintenanceIssues(issues)
  return { ok: unique.length === 0, issues: unique, missingRetained }
}
