/**
 * 世界书最小模块(格式规格 §4 / scanDesign):人物档案 + 世界规则。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { 世界书最小模块 } from '../derive/design'
import { canonicalizePath, isInsideCanonicalRoot } from '../gate/canonical'
import { writeFileAtomic, type FileOp } from '../repo/atomic'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { assertSegment } from '../repo/paths'
import { bookWriter } from '../repo/atomic'
import { WORLDBOOK_INPUT_FIELDS, WORLDBOOK_NATURES, WORLDBOOK_STATES } from '../repo/document-fields'
import { parseWorldbookHistory } from './worldbook-history'

export type 世界书性质 = typeof WORLDBOOK_NATURES[number]
export type 世界书状态 = typeof WORLDBOOK_STATES[number]

export interface WorldbookEntryInput {
  readonly 类型?: string
  readonly 性质?: 世界书性质
  readonly 状态?: 世界书状态
  readonly 来源?: string
  readonly 别名?: string
  readonly 正文?: string
}

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

function readEntry(bookRoot: string, relPath: string): string | undefined {
  const root = canonicalizePath(bookRoot)
  const target = path.join(root, relPath)
  if (!isInsideCanonicalRoot(root, target)) throw new Error(`世界书路径逃逸书仓：${relPath}`)
  let current = root
  const parts = relPath.split('/')
  for (const [i, part] of parts.entries()) {
    current = path.join(current, part)
    try {
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink()) throw new Error(`世界书路径不能是链接：${relPath}`)
      if (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) {
        throw new Error(`世界书目标须为独立普通文件，父路径须为目录：${relPath}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  try { return fs.readFileSync(target, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}

function checkInput(fields: WorldbookEntryInput): void {
  for (const [key, value] of Object.entries(fields)) {
    if (!Object.hasOwn(WORLDBOOK_INPUT_FIELDS, key)) throw new Error(`世界书确认不接受字段：${key}`)
    if (value === undefined) continue
    const contract = WORLDBOOK_INPUT_FIELDS[key as keyof typeof WORLDBOOK_INPUT_FIELDS]
    if (typeof value !== 'string') throw new Error(`世界书${key}须为字符串，不能用空值删除字段`)
    if (contract.type === 'single-line-text' && /[\r\n]/.test(value)) throw new Error(`世界书${key}须为单行文本`)
    if (!contract.allowEmpty && !value.trim()) throw new Error(`世界书${key}不能为空`)
    if ('values' in contract && !(contract.values as readonly string[]).includes(value)) {
      throw new Error(`世界书${key}须为${contract.values.join('/')}`)
    }
  }
}

/** Line numbers include frontmatter; slicing raw bytes avoids normalizing the fact tail. */
function atLine(text: string, line: number): number {
  let offset = 0
  for (let i = 1; i < line; i++) offset = text.indexOf('\n', offset) + 1
  return offset
}

export function prepareEntry(
  bookRoot: string,
  模块: string,
  名称: string,
  fields: WorldbookEntryInput,
): FileOp {
  assertSegment(模块, '模块名')
  assertSegment(名称, '条目名')
  checkInput(fields)
  const relPath = path.posix.join('世界书', 模块, `${名称}.md`)
  const previous = readEntry(bookRoot, relPath)
  const parsed = parseWorldbookHistory(previous ?? '')
  if (!parsed.ok) throw new Error(`${relPath} 解析失败：${parsed.detail}`)
  const history = parsed.data
  const old = history.字段
  if (Object.hasOwn(old, '名称') && old['名称'] !== 名称) throw new Error(`世界书名称与目标不一致：${relPath}`)
  if (Object.hasOwn(old, '性质') && !(WORLDBOOK_NATURES as readonly unknown[]).includes(old['性质'])) {
    throw new Error(`世界书既有性质无效，保留原文件：${relPath}`)
  }
  if (Object.hasOwn(old, '状态') && !(WORLDBOOK_STATES as readonly unknown[]).includes(old['状态'])) {
    throw new Error(`世界书既有状态无效，保留原文件：${relPath}`)
  }
  const fm: Record<string, unknown> = { ...old, 名称 }
  for (const [k, v] of Object.entries(fields)) {
    if (k !== '正文' && v !== undefined) fm[k] = v
  }
  for (const [key, contract] of Object.entries(WORLDBOOK_INPUT_FIELDS)) {
    if (contract.requiredOnCreate && (typeof fm[key] !== 'string' || !(fm[key] as string).trim())) {
      throw new Error(`世界书${key}必填：新建须提供，更新须保留有效旧值`)
    }
  }
  const tailAt = history.追加[0]?.行号
  const tail = previous !== undefined && tailAt !== undefined ? previous.slice(atLine(previous, tailAt)) : ''
  const head = previous === undefined ? '' : tail ? previous.slice(0, atLine(previous, tailAt!)) : previous
  const headDoc = parseDocument(head)
  if (!headDoc.ok) throw new Error(`${relPath} 首段解析失败：${headDoc.detail}`)
  const body = fields.正文 ?? (previous === undefined ? `# ${名称}\n` : headDoc.data.body)
  // Compare both dimensions before serialization so retries retain comments, CRLF and trailing bytes.
  if (previous !== undefined && isDeepStrictEqual(fm, old)
    && serializeDocument({}, body) === serializeDocument({}, headDoc.data.body)) return { relPath, content: previous }
  if (history.未闭合围栏) throw new Error('世界书旧文围栏未闭合，无法证明事实边界；保留原文，请先核对并修复')
  if (old['性质'] === '事实' || old['生成模块'] === '吃书补偿' || (history.追加.length > 0 && old['性质'] !== '计划')) {
    throw new Error('世界书事实只增不改，修改须走事实更正/吃书')
  }
  if (fm['性质'] !== '计划') throw new Error('世界书事实须由定稿入档写入，不能由设计确认新建或转换')
  // Serialize metadata alone when the caller omitted prose; do not rewrite the raw existing body.
  const normalizedHead = head.replace(/\r\n/g, '\n')
  const bodyLine = normalizedHead.slice(0, normalizedHead.length - headDoc.data.body.length).split('\n').length
  const rawBody = head.slice(atLine(head, bodyLine))
  const content = fields.正文 === undefined && previous !== undefined
    ? serializeDocument(fm, '').slice(0, -1) + rawBody + tail
    : serializeDocument(fm, body) + (tail ? `\n${tail}` : '')
  const assembled = parseWorldbookHistory(content)
  if (!assembled.ok || assembled.data.未闭合围栏 || !isDeepStrictEqual(assembled.data.追加.map(({ 行号: _line, ...fact }) => fact),
    history.追加.map(({ 行号: _line, ...fact }) => fact))) {
    throw new Error('世界书计划首段不得新增事实标题或改变既有事实边界，请核对 Markdown 围栏')
  }
  return { relPath, content }
}

function writeEntryLocked(bookRoot: string, 模块: string, 名称: string, fields: WorldbookEntryInput): void {
  const op = prepareEntry(bookRoot, 模块, 名称, fields)
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
