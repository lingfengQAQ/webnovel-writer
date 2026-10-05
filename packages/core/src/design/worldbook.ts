/**
 * 世界书最小模块(格式规格 §4 / scanDesign):人物档案 + 世界规则。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { 世界书最小模块 } from '../derive/design'
import { writeFileAtomic, type FileOp } from '../repo/atomic'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { assertSegment } from '../repo/paths'
import { bookWriter } from '../repo/atomic'

export type 世界书性质 = '计划' | '事实'

export interface WorldbookEntryFields {
  readonly 名称: string
  readonly 别名?: string
  readonly 类型: string
  readonly 性质: 世界书性质
  readonly 状态: string
  readonly 来源: string
  readonly [k: string]: unknown
}

function ensureModulesDeclaredLocked(bookRoot: string, extra: readonly string[] = []): void {
  const abs = path.join(bookRoot, '世界书/模块声明.md')
  let existing = ''
  try {
    existing = fs.readFileSync(abs, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    existing = '# 模块声明\n'
  }
  const names = [...new Set([...世界书最小模块, ...extra])]
  for (const name of names) assertSegment(name, '模块名')
  const lines = existing.replace(/\r\n/g, '\n').split('\n')
  for (const name of names) {
    if (!lines.some(line => line.trim() === `- ${name}`)) lines.push(`- ${name}`)
  }
  const body = `${lines.join('\n').replace(/\n+$/, '')}\n`
  if (body !== existing) writeFileAtomic(bookRoot, '世界书/模块声明.md', body)
}

export const ensureModulesDeclared = bookWriter(ensureModulesDeclaredLocked)

export function prepareEntry(
  模块: string,
  名称: string,
  fields: Omit<WorldbookEntryFields, '名称'> & { readonly 名称?: string },
): FileOp {
  assertSegment(模块, '模块名')
  assertSegment(名称, '条目名')
  const rec: Record<string, unknown> = {
    名称,
    类型: fields.类型,
    性质: fields.性质,
    状态: fields.状态,
    来源: fields.来源,
  }
  if (fields.别名 !== undefined) rec['别名'] = fields.别名
  for (const [k, v] of Object.entries(fields)) {
    if (k === '名称') continue
    if (rec[k] === undefined) rec[k] = v
  }
  const body = typeof fields['正文'] === 'string' ? String(fields['正文']) : `# ${名称}\n`
  const { 正文: _ignored, ...fm } = rec
  return { relPath: path.posix.join('世界书', 模块, `${名称}.md`), content: serializeDocument(fm, body) }
}

function writeEntryLocked(bookRoot: string, ...args: Parameters<typeof prepareEntry>): void {
  const op = prepareEntry(...args)
  writeFileAtomic(bookRoot, op.relPath, op.content)
}

export const writeEntry = bookWriter(writeEntryLocked)

export function checkWorldbookMinComplete(bookRoot: string):
  | { readonly ok: true }
  | { readonly ok: false; readonly gaps: readonly string[] } {
  const 声明Abs = path.join(bookRoot, '世界书/模块声明.md')
  let 声明: string
  try {
    声明 = fs.readFileSync(声明Abs, 'utf-8')
  } catch {
    return { ok: false, gaps: ['模块声明不存在'] }
  }
  const gaps: string[] = []
  for (const 名 of 世界书最小模块) {
    if (!声明.includes(名)) {
      gaps.push(`未声明模块:${名}`)
      continue
    }
    if (!moduleHasConfirmedEntry(bookRoot, 名)) gaps.push(`模块无已确认条目:${名}`)
  }
  return gaps.length === 0 ? { ok: true } : { ok: false, gaps }
}

function moduleHasConfirmedEntry(root: string, 模块: string): boolean {
  const dir = path.join(root, '世界书', 模块)
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return false }
  return names.some((name) => {
    if (!name.endsWith('.md')) return false
    try {
      const text = fs.readFileSync(path.join(dir, name), 'utf-8')
      const r = parseDocument(text)
      return r.ok && r.data.fields['状态'] === '已确认'
    } catch {
      return false
    }
  })
}
