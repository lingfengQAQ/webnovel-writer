import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { withBookWrite, writeBatchAtomic } from '../repo/atomic'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { applyVersionFields, bumpVersion, extractVersionFields, initialVersion } from '../provenance'
import { canonicalizePath, isInsidePath } from '../gate/canonical'
import { checkCommitPath } from '../commit/paths'
import { commitConfirmed, type CommitConfirmedResult } from '../commit/design'
import { listChapters } from '../derive/scan'
import { paths } from '../repo/paths'
import { nextDraftFileName, listChapterDrafts, isNumberedDraftPath, 草稿字段序 } from '../repo/drafts'
import type { OperationProvenance } from '../repo/transaction'

export class AuthorDocumentError extends Error {
  constructor(readonly code: 'invalid-path' | 'not-found' | 'read-only' | 'conflict' | 'invalid-document', message: string) {
    super(message)
    this.name = 'AuthorDocumentError'
  }
}

export function documentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** Shared lexical boundary for author documents and finalized source scans. */
export function validateAuthorRelativePath(relative: string, allowRoot = false): string[] {
  const parts = relative.split(/[\\/]/)
  if ((!allowRoot && relative === '') || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)
    || parts.some(part => part === '..' || part === '.' || part.startsWith('.') || part.toLowerCase() === 'node_modules' || /[\x00-\x1f:]/.test(part) || /[. ]$/.test(part))
    || (relative !== '' && parts.some(part => part === ''))) {
    throw new AuthorDocumentError('invalid-path', '文件路径不合法')
  }
  return parts
}

/** Validate both the logical path and every resolved ancestor before file access. */
export function authorDocumentPath(root: string, relative: string, allowRoot = false): string {
  const parts = validateAuthorRelativePath(relative, allowRoot)
  const base = canonicalizePath(root)
  let ancestor = base
  for (const part of parts.filter(Boolean)) {
    ancestor = path.join(ancestor, part)
    try {
      if (fs.lstatSync(ancestor).isSymbolicLink()) throw new AuthorDocumentError('invalid-path', '书稿目录中的链接或别名不可访问')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const target = canonicalizePath(path.resolve(base, relative))
  if (target !== base && !isInsidePath(base, target)) throw new AuthorDocumentError('invalid-path', '文件路径越出所属目录')
  if (!allowRoot && target === base) throw new AuthorDocumentError('invalid-path', '不能编辑目录本身')
  const resolvedParts = path.relative(base, target).split(path.sep)
  if (resolvedParts.some(part => part.startsWith('.') || part === 'node_modules')) {
    throw new AuthorDocumentError('invalid-path', '运行时文件不属于书稿')
  }
  return target
}

export function authorReadOnlyReason(relative: string, shared = false): string | undefined {
  const posix = relative.replace(/\\/g, '/')
  if (!/\.(md|txt)$/i.test(posix)) return '结构化工件由业务工具维护，只读'
  if (shared) return undefined
  if (posix.startsWith('定稿/')) return '定稿更正通过吃书补偿流程处理'
  if (posix.startsWith('构想/')) return '建书构想快照已冻结'
  if (/^草稿区\/(材料包|审核|定稿准备|批次)\//.test(posix)) return '过程工件由业务工具维护，只读'
  if (!posix.startsWith('草稿区/') && !checkCommitPath('', posix).ok) return '不是可编辑的书仓文档'
  return undefined
}

export interface AuthorSaveInput {
  readonly path: string
  readonly expectedHash: string
  readonly body: string
  readonly shared?: boolean
  readonly provenance?: OperationProvenance
  readonly operationId?: string
}

export interface AuthorSaveResult {
  readonly operationId: string
  readonly path: string
  readonly previousPath: string
  readonly hash: string
  readonly body: string
  readonly previousBody: string
  readonly version: string | number | null
  readonly changed: boolean
  readonly commit?: CommitConfirmedResult
}

interface AuthorSaveReceipt {
  readonly schema: 1
  readonly sessionId?: string
  readonly inputHash: string
  readonly result: AuthorSaveResult
}

function receiptPath(root: string, operationId: string, shared = false): string {
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(operationId)) throw new AuthorDocumentError('invalid-document', '保存编号不合法')
  const relative = `${shared ? '' : '草稿区/'}.author-edits/${operationId}.json`
  if (!isInsidePath(root, path.join(root, relative))) throw new AuthorDocumentError('invalid-path', '保存记录越出所属目录')
  return relative
}

/** Receipts describe author edits, not a second copy of conversation or book state. */
export function readAuthorSave(root: string, operationId: string, sessionId?: string, shared = false): AuthorSaveResult {
  const target = path.join(root, receiptPath(root, operationId, shared))
  if (!fs.existsSync(target)) throw new AuthorDocumentError('not-found', '未找到这次保存记录')
  const receipt = JSON.parse(fs.readFileSync(target, 'utf8')) as AuthorSaveReceipt
  if (receipt.schema !== 1 || receipt.sessionId !== sessionId || receipt.result?.operationId !== operationId) {
    throw new AuthorDocumentError('invalid-document', '保存记录不属于当前会话')
  }
  return receipt.result
}

function commitSaved(root: string, result: AuthorSaveResult, shared: boolean | undefined, provenance?: OperationProvenance): AuthorSaveResult {
  if (shared || result.path.startsWith('草稿区/') || !result.changed) return result
  const commit = commitConfirmed({ bookRoot: root, paths: [result.path], prefix: 'fix', summary: '作者修改 ' + path.posix.basename(result.path), provenance })
  const saved = { ...result, commit }
  const relative = receiptPath(root, result.operationId)
  const receipt = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')) as AuthorSaveReceipt
  writeBatchAtomic(root, [{ relPath: relative, content: JSON.stringify({ ...receipt, result: saved }) + '\n' }], { provenance })
  return saved
}

export function retryAuthorSaveCommit(root: string, operationId: string, hash: string, sessionId: string): AuthorSaveResult {
  return withBookWrite(root, () => {
    const result = readAuthorSave(root, operationId, sessionId)
    const target = authorDocumentPath(root, result.path)
    if (result.hash !== hash || documentHash(fs.readFileSync(target, 'utf8')) !== hash) throw new AuthorDocumentError('conflict', '磁盘版本已变化，请重新核对')
    if (result.path.startsWith('草稿区/') || authorReadOnlyReason(result.path)) throw new AuthorDocumentError('read-only', '此文件不适用补提交')
    return commitSaved(root, result, false, { sessionId, toolName: 'author-editor' })
  })
}

/** Trusted author UI writer. This is not exposed as an LLM approval parameter. */
export function saveAuthorDocument(root: string, input: AuthorSaveInput): AuthorSaveResult {
  return withBookWrite(root, () => {
    const target = authorDocumentPath(root, input.path)
    const relative = path.relative(canonicalizePath(root), target).split(path.sep).join('/')
    input = { ...input, path: relative }
    if (input.shared && fs.existsSync(path.join(root, paths.契约()))) {
      throw new AuthorDocumentError('read-only', '共享目录与书仓重叠，拒绝共享写入；请通过书目入口访问')
    }
    const operationId = input.operationId ?? randomUUID()
    const receiptRelative = receiptPath(root, operationId, input.shared)
    const inputHash = documentHash(JSON.stringify([input.path, input.expectedHash, input.body, !!input.shared]))
    if (fs.existsSync(path.join(root, receiptRelative))) {
      const receipt = JSON.parse(fs.readFileSync(path.join(root, receiptRelative), 'utf8')) as AuthorSaveReceipt
      const result = readAuthorSave(root, operationId, input.provenance?.sessionId, input.shared)
      if (receipt.inputHash !== inputHash) throw new AuthorDocumentError('conflict', '保存编号已用于另一份修改')
      const savedTarget = authorDocumentPath(root, result.path)
      if (documentHash(fs.readFileSync(savedTarget, 'utf8')) !== result.hash) throw new AuthorDocumentError('conflict', '这次修改已保存，但文件后来又有变动，请核对磁盘版本')
      return commitSaved(root, result, input.shared, input.provenance)
    }
    const readonly = authorReadOnlyReason(input.path, input.shared)
    if (readonly) throw new AuthorDocumentError('read-only', readonly)
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new AuthorDocumentError('not-found', '源文件不存在')
    const original = fs.readFileSync(target, 'utf8')
    if (documentHash(original) !== input.expectedHash) {
      throw new AuthorDocumentError('conflict', '文件已被修改，请比较磁盘版本后再保存；你的编辑仍保留')
    }
    const parsed = parseDocument(original)
    if (!parsed.ok) throw new AuthorDocumentError('invalid-document', parsed.detail)
    const body = input.body.replace(/\r\n/g, '\n').replace(/\n*$/, '\n')
    const version = extractVersionFields(parsed.data.fields).版本
    if (body === parsed.data.body.replace(/\r\n/g, '\n').replace(/\n*$/, '\n')) {
      return { operationId, path: input.path, previousPath: input.path, hash: input.expectedHash, body, previousBody: parsed.data.body, version, changed: false }
    }
    if (!body.trim() && !input.shared) throw new AuthorDocumentError('invalid-document', '书稿正文不能为空')
    const posix = input.path.replace(/\\/g, '/')
    let destination = posix
    let fields = { ...parsed.data.fields }
    const isDraft = isNumberedDraftPath(posix)
    const operations: Array<{ relPath: string; content: string }> = []
    if (!input.shared) {
      const protocol = version === null ? initialVersion('作者手改') : bumpVersion(version, '作者手改', fields['来源快照'])
      fields = applyVersionFields(fields, protocol)
    }
    if (isDraft && !input.shared) {
      const key = listChapters(root).find(chapter => paths.草稿目录(chapter.卷, chapter.章名) === path.posix.dirname(posix))
      if (!key) throw new AuthorDocumentError('invalid-document', '不能确定草稿所属章节')
      const drafts = listChapterDrafts(root, key)
      const pending = drafts.filter(draft => draft.角色 === '待审稿')
      if (pending.length > 1) throw new AuthorDocumentError('conflict', `待审稿不唯一：${pending.length} 份，请先核对章节状态`)
      if (parsed.data.fields['角色'] === '待审稿' && pending[0]?.relPath !== posix) {
        throw new AuthorDocumentError('conflict', '当前待审稿已变化，不能覆盖新稿')
      }
      if (drafts.some(draft => draft.relPath !== posix && draft.版本 !== null && version !== null && draft.版本 > version)) {
        throw new AuthorDocumentError('conflict', '该章已有更新版本，请打开最新稿后继续修改')
      }
      destination = path.posix.join(path.posix.dirname(posix), nextDraftFileName(root, key))
      authorDocumentPath(root, destination)
      if (fs.existsSync(path.join(root, destination))) throw new AuthorDocumentError('conflict', '目标稿件已存在')
      for (const draft of drafts) {
        if (!draft.选定 && !(draft.relPath === posix && draft.角色 === '待审稿')) continue
        authorDocumentPath(root, draft.relPath)
        const old = parseDocument(draft.text)
        if (!old.ok) throw new AuthorDocumentError('invalid-document', old.detail)
        operations.push({ relPath: draft.relPath, content: serializeDocument({ ...old.data.fields, ...(draft.relPath === posix ? { 角色: '草稿' } : {}), 选定: false }, old.data.body, 草稿字段序) })
      }
    }
    const next = serializeDocument(fields, body, isDraft ? 草稿字段序 : undefined)
    operations.push({ relPath: destination, content: next })
    const result: AuthorSaveResult = {
      operationId,
      path: destination, previousPath: posix, hash: documentHash(next), body,
      previousBody: parsed.data.body, version: typeof fields['版本'] === 'string' || typeof fields['版本'] === 'number' ? fields['版本'] : null, changed: true,
    }
    const receipt: AuthorSaveReceipt = { schema: 1, sessionId: input.provenance?.sessionId, inputHash, result }
    operations.push({ relPath: receiptRelative, content: JSON.stringify(receipt) + '\n' })
    writeBatchAtomic(root, operations, { provenance: input.provenance })
    return commitSaved(root, result, input.shared, input.provenance)
  }, input.provenance)
}
