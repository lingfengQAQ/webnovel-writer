import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { assertSegment, type MemoryKind } from '../repo/paths'
import { isMemoryKind } from '../repo/book-memory-contract'
import { memoryIndexLink, memoryIndexText, parseMemoryIndexLinks } from '../repo/memory-index-links'

export class MemoryWriteError extends Error {}

export interface MemoryMutation {
  readonly 操作?: '新增' | '更新'
  /** 完整已读条目；由调用方原样提供，不要求模型计算哈希。 */
  readonly 原文?: string
  /** 仅供定稿清单使用；不能由直接记忆工具透传。 */
  readonly 基线哈希?: string
}

export interface MemoryDocument {
  readonly relPath: string
  readonly text: string
  readonly fields: Record<string, unknown>
  readonly body: string
}

export interface PreparedMemory {
  readonly relPath: string
  readonly content: string
  readonly changed: boolean
  readonly updated: boolean
  /** 已有结论，但不是本次请求的逐字产物，不替它补交 Git。 */
  readonly duplicate?: true
}

export const normalizeMemoryText = (text: string): string => text.replace(/\r\n/g, '\n').replace(/\n+$/, '')
export const memoryTextHash = (text: string): string => createHash('sha256').update(normalizeMemoryText(text)).digest('hex')

/** Check every existing component before reading or planning a write. */
export function memoryPath(root: string, relative: string, directory = false): string {
  const parts = relative.split('/')
  for (const part of parts) assertSegment(part, '记忆路径')
  let current = root
  for (const [i, part] of parts.entries()) {
    current = path.join(current, part)
    try {
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink()) throw new MemoryWriteError(`记忆路径不能是链接：${relative}`)
      if (i < parts.length - 1 || directory) {
        if (!stat.isDirectory()) throw new MemoryWriteError(`记忆目录不是目录：${relative}`)
      } else if (!stat.isFile() || stat.nlink !== 1) throw new MemoryWriteError(`记忆目标不是独立普通文件：${relative}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return current
}

export function readMemoryText(root: string, relative: string): string | undefined {
  const file = memoryPath(root, relative)
  try { return fs.readFileSync(file, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}

export function memoryDocuments(root: string, directory: string): MemoryDocument[] {
  const dir = memoryPath(root, directory, true)
  let names: string[]
  try { names = fs.readdirSync(dir) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  return names.filter(name => name.endsWith('.md') && name !== '索引.md').sort().map(name => {
    const relPath = `${directory}/${name}`
    const text = readMemoryText(root, relPath)
    if (text === undefined) throw new MemoryWriteError(`记忆条目读取期间已变化：${relPath}`)
    const parsed = parseDocument(text)
    if (!parsed.ok) throw new MemoryWriteError(`记忆条目解析失败：${relPath}；${parsed.detail}`)
    return { relPath, text, fields: { ...parsed.data.fields }, body: parsed.data.body }
  })
}

export function prepareMemory(
  root: string,
  directory: string,
  input: MemoryMutation & { readonly 名称: string; readonly 类: MemoryKind; readonly 正文: string },
  fields: Record<string, unknown>,
  documents: readonly MemoryDocument[],
): PreparedMemory {
  const name = input.名称.trim()
  if (!name || name === '索引') throw new MemoryWriteError('记忆名称必填且不得为「索引」')
  assertSegment(name, '记忆名称')
  if (!isMemoryKind(input.类)) throw new MemoryWriteError('记忆类别必须为文风、决策、对话或灵感')
  if (!input.正文.trim()) throw new MemoryWriteError(`记忆「${name}」正文为空`)
  const operation = input.操作 ?? '新增'
  if (operation !== '新增' && operation !== '更新') throw new MemoryWriteError('记忆操作必须为新增或更新')
  if (operation === '新增' && (input.原文 !== undefined || input.基线哈希 !== undefined)) throw new MemoryWriteError('新增记忆不接受更新原文')
  const relPath = `${directory}/${name}.md`
  const current = readMemoryText(root, relPath)
  const parseExisting = (text: string) => {
    const parsed = parseDocument(text)
    if (!parsed.ok || parsed.data.fields['名称'] !== name || parsed.data.fields['类'] !== input.类) {
      throw new MemoryWriteError(`记忆目标与旧格式或未知条目冲突，保留原文件：${relPath}`)
    }
    return parsed.data
  }
  const prior = current === undefined ? undefined : parseExisting(current)
  const render = (old?: Record<string, unknown>) => serializeDocument({
    ...old, ...fields, 名称: name, 类: input.类,
    生成模块: old?.['生成模块'] ?? fields['生成模块'] ?? '模型',
  }, input.正文)
  if (operation === '更新') {
    if (current === undefined) throw new MemoryWriteError(`更新目标不存在：${relPath}；不能把更新改成新增`)
    if (input.原文 === undefined && input.基线哈希 === undefined) throw new MemoryWriteError(`更新记忆须先读取并提供完整原文：${relPath}`)
    const matches = input.原文 !== undefined
      ? normalizeMemoryText(current) === normalizeMemoryText(input.原文)
      : /^[a-f0-9]{64}$/.test(input.基线哈希!) && memoryTextHash(current) === input.基线哈希
    if (!matches) {
      // An identical completed update may only be retried if its exact output still exists.
      if (input.原文 !== undefined && normalizeMemoryText(render({ ...parseExisting(input.原文).fields })) === normalizeMemoryText(current)) {
        return { relPath, content: current, changed: false, updated: true }
      }
      throw new MemoryWriteError(`记忆原文已变化：${relPath}；请重读并核对后更新`)
    }
  }
  const content = render(operation === '新增' || prior === undefined ? undefined : { ...prior.fields })
  if (current !== undefined) {
    if (normalizeMemoryText(current) === normalizeMemoryText(content)) return { relPath, content: current, changed: false, updated: true }
    if (operation === '新增') {
      if (normalizeMemoryText(prior!.body) === normalizeMemoryText(input.正文)) {
        return { relPath, content: current, changed: false, updated: true, duplicate: true }
      }
      throw new MemoryWriteError(`记忆「${name}」已存在；先读取原文，再明确更新，不得用新增覆盖`)
    }
  } else {
    const duplicate = documents.find(doc => doc.fields['类'] === input.类 && normalizeMemoryText(doc.body) === normalizeMemoryText(input.正文))
    if (duplicate) return { relPath: duplicate.relPath, content: duplicate.text, changed: false, updated: false, duplicate: true }
  }
  return { relPath, content, changed: true, updated: current !== undefined }
}

/** Index entries retain the actual filenames, including read-only legacy files. */
export function memoryIndex(title: string, documents: readonly MemoryDocument[], changes: readonly PreparedMemory[], originalIndex?: string): string {
  const files = new Map(documents.map(doc => [doc.relPath, doc.text]))
  for (const change of changes) if (change.changed) files.set(change.relPath, change.content)
  const lines: string[] = []
  for (const rel of [...files.keys()].sort()) {
    const parsed = parseDocument(files.get(rel)!)
    if (!parsed.ok) throw new MemoryWriteError(`记忆条目解析失败：${rel}`)
    const f = parsed.data.fields
    const filename = path.posix.basename(rel)
    const name = typeof f['名称'] === 'string' ? f['名称'] : filename.replace(/\.md$/, '')
    const details = [typeof f['描述'] === 'string' ? f['描述'] : undefined,
      typeof f['类'] === 'string' ? `类：${f['类']}` : '旧格式记忆',
      typeof f['来源'] === 'string' ? `来源：${f['来源']}` : undefined].filter((detail): detail is string => detail !== undefined && detail !== '')
    lines.push(`- ${memoryIndexLink(name, filename)} — ${details.map(memoryIndexText).join('｜')}`)
  }
  const newline = originalIndex?.includes('\r\n') ? '\r\n' : '\n'
  let retained = `# ${title}${newline}${newline}`
  if (originalIndex?.trim()) {
    if (parseMemoryIndexLinks(originalIndex).problems.length) throw new MemoryWriteError('记忆索引解析失败；请先核对原文并检查书仓，未重建索引')
    // Replace filename rows only; category notes retained by C5 and author prose survive.
    retained = (originalIndex.match(/[^\n]*\n|[^\n]+$/g) ?? []).filter(line => !parseMemoryIndexLinks(line).filenames.length).join('')
  }
  return retained + (retained.endsWith('\n') ? '' : newline) + (lines.length ? lines.join(newline) + newline : '')
}
