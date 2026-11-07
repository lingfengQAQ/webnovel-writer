import * as fs from 'node:fs'
import * as path from 'node:path'
import { DOCUMENT_FIELDS, isDocumentFieldValue } from './document-fields'
import { parseDocument } from './frontmatter'
import { paths } from './paths'

export const BOOK_FORMAT_VERSION_FIELD = DOCUMENT_FIELDS.bookFormatVersion.name
export const CURRENT_BOOK_FORMAT_VERSION = 1

export type BookFormatVersionResult =
  | { readonly ok: true; readonly version: typeof CURRENT_BOOK_FORMAT_VERSION }
  | { readonly ok: false; readonly kind: 'unversioned' | 'invalid-format' | 'unsupported-version' | 'missing' | 'read-error'; readonly reason: string; readonly version?: number }

/** Identifies only the format marker; success is not a whole-book health check. */
export function parseBookFormatVersion(text: string): BookFormatVersionResult {
  const parsed = parseDocument(text)
  if (!parsed.ok) return { ok: false, kind: 'invalid-format', reason: `作品契约无法解析：${parsed.detail}` }
  if (!Object.hasOwn(parsed.data.fields, BOOK_FORMAT_VERSION_FIELD)) {
    return { ok: false, kind: 'unversioned', reason: '作品契约未标注书仓格式版本，须由维护检查识别来源格式' }
  }
  const version = parsed.data.fields[BOOK_FORMAT_VERSION_FIELD]
  if (typeof version !== 'number' || !isDocumentFieldValue(DOCUMENT_FIELDS.bookFormatVersion, version)) {
    return { ok: false, kind: 'invalid-format', reason: '书仓格式版本须为正安全整数，不接受字符串、空值或默认推断' }
  }
  if (version !== CURRENT_BOOK_FORMAT_VERSION) {
    return { ok: false, kind: 'unsupported-version', version, reason: `当前插件不支持书仓格式版本 ${String(version)}；请使用支持该格式的插件或明确的迁移规则` }
  }
  return { ok: true, version }
}

export function readBookFormatVersion(bookRoot: string): BookFormatVersionResult {
  try {
    return parseBookFormatVersion(fs.readFileSync(path.join(bookRoot, paths.契约()), 'utf8'))
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { ok: false, kind: 'missing', reason: '作品契约不存在，不能识别书仓格式' }
      : { ok: false, kind: 'read-error', reason: `作品契约读取失败：${error instanceof Error ? error.message : String(error)}` }
  }
}
