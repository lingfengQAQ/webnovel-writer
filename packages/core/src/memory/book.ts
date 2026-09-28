/**
 * 本书层记忆写入器(格式规格 §6 一事一文件形态,照 memory/author.ts):
 * `本书记忆/<条目名>.md` + `索引.md` 随写入重建(索引是派生数据)。
 * 定稿沉淀走 `bookMemoryOps` 并入定稿包同一批原子写;单独调用走 `writeBookMemory`。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { writeBatchAtomic, writeFileAtomic, type FileOp } from '../repo/atomic'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { assertSegment, MEMORY_KINDS, paths, type MemoryKind } from '../repo/paths'
import { bookWriter } from '../repo/atomic'

export interface BookMemoryInput {
  readonly 类: MemoryKind
  readonly 名称: string
  readonly 描述?: string
  readonly 正文: string
  readonly 来源: string
  readonly 裁决记录: string
}

export interface BookMemoryEntryView {
  readonly 类: MemoryKind
  readonly 名称: string
  readonly 描述?: string
  readonly 状态: string
  readonly 来源: string
  readonly relPath: string
  readonly 正文: string
}

const 记忆字段序 = ['名称', '描述', '类', '状态', '来源', '裁决记录'] as const

function doc(input: BookMemoryInput): string {
  return serializeDocument(
    {
      名称: input.名称.trim(),
      ...(input.描述 === undefined ? {} : { 描述: input.描述.trim() }),
      类: input.类,
      状态: '已确认',
      来源: input.来源.trim(),
      裁决记录: input.裁决记录,
    },
    input.正文,
    记忆字段序,
  )
}

function assertInput(input: BookMemoryInput): void {
  const 名称 = input.名称.trim()
  if (名称 === '' || 名称 === '索引') throw new Error('本书记忆条目名称必填且不得为「索引」')
  assertSegment(名称, '本书记忆条目名称')
  if (input.正文.trim() === '') throw new Error(`本书记忆「${名称}」正文为空`)
  if (input.描述 !== undefined && (!input.描述.trim() || /[\r\n]/.test(input.描述))) throw new Error(`本书记忆「${名称}」描述须为非空单行`)
}

/** 枚举磁盘上的本书层记忆条目(一事一文件;`本书记忆/<类>.md` 旧格式文件没有 类 字段,不按条目读)。 */
export function listBookMemoryEntries(bookRoot: string): readonly BookMemoryEntryView[] {
  const dir = path.join(bookRoot, '本书记忆')
  let names: string[] = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const out: BookMemoryEntryView[] = []
  for (const name of names.filter((n) => n.endsWith('.md') && n !== '索引.md').sort()) {
    let docResult: ReturnType<typeof parseDocument>
    try {
      docResult = parseDocument(fs.readFileSync(path.join(dir, name), 'utf-8'))
    } catch {
      continue
    }
    if (!docResult.ok) continue
    const fields = docResult.data.fields
    const 类 = fields['类']
    if (typeof 类 !== 'string') continue
    out.push({
      类: 类 as MemoryKind,
      名称: typeof fields['名称'] === 'string' ? fields['名称'] : name.replace(/\.md$/, ''),
      ...(typeof fields['描述'] === 'string' ? { 描述: fields['描述'] } : {}),
      状态: typeof fields['状态'] === 'string' ? fields['状态'] : '',
      来源: typeof fields['来源'] === 'string' ? fields['来源'] : '',
      relPath: paths.本书记忆条目(name.replace(/\.md$/, '')),
      正文: docResult.data.body,
    })
  }
  return out
}

function indexContent(bookRoot: string, extra: readonly BookMemoryInput[]): string {
  const merged = new Map<string, { 类: string; 来源: string; 描述?: string }>()
  for (const entry of listBookMemoryEntries(bookRoot)) {
    merged.set(entry.名称, { 类: entry.类, 来源: entry.来源, 描述: entry.描述 })
  }
  for (const input of extra) {
    merged.set(input.名称.trim(), { 类: input.类, 来源: input.来源.trim(), 描述: input.描述 ?? merged.get(input.名称.trim())?.描述 })
  }
  const lines = ['# 本书记忆索引', '']
  for (const name of [...merged.keys()].sort()) {
    const entry = merged.get(name)!
    lines.push(`- [${name}](${name}.md) — ${entry.描述 ? `${entry.描述}｜` : ''}类：${entry.类}｜来源：${entry.来源}`)
  }
  return `${lines.join('\n')}\n`
}

/** 索引全量重建(幂等):一行一条 `- [名称](文件名) — 类：…｜来源：…`;正文永不进索引。 */
function rebuildBookMemoryIndexLocked(bookRoot: string): string {
  const rel = paths.本书记忆索引()
  fs.mkdirSync(path.dirname(path.join(bookRoot, rel)), { recursive: true })
  writeFileAtomic(bookRoot, rel, indexContent(bookRoot, []))
  return rel
}

export const rebuildBookMemoryIndex = bookWriter(rebuildBookMemoryIndexLocked)

/** 生成一事一文件的 FileOp(条目文件 + 合并既有条目重建的索引),交调用方并入同一批原子写。 */
export function bookMemoryOps(bookRoot: string, inputs: readonly BookMemoryInput[]): readonly FileOp[] {
  for (const input of inputs) {
    assertInput(input)
    const target = paths.本书记忆条目(input.名称.trim())
    try {
      const stat = fs.lstatSync(path.join(bookRoot, target))
      if (!stat.isFile()) throw new Error(`本书记忆目标不是普通条目文件:${target}`)
      const parsed = parseDocument(fs.readFileSync(path.join(bookRoot, target), 'utf8'))
      if (!parsed.ok || !MEMORY_KINDS.includes(parsed.data.fields['类'] as MemoryKind)
        || parsed.data.fields['名称'] !== input.名称.trim()) {
        throw new Error(`本书记忆目标与旧格式或未知条目冲突，保留原文件:${target}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const existing = new Map(listBookMemoryEntries(bookRoot).map(entry => [entry.名称, entry.描述]))
  const effective = inputs.map(input => ({ ...input, 描述: input.描述 ?? existing.get(input.名称.trim()) }))
  const ops: FileOp[] = effective.map((input) => ({
    relPath: paths.本书记忆条目(input.名称.trim()),
    content: doc(input),
  }))
  ops.push({ relPath: paths.本书记忆索引(), content: indexContent(bookRoot, effective) })
  return ops
}

/** 单条目直接落盘并重建索引(独立调用;定稿沉淀请走 bookMemoryOps)。 */
function writeBookMemoryLocked(bookRoot: string, input: BookMemoryInput): { readonly ok: true; readonly relPath: string } | { readonly ok: false; readonly reason: string } {
  try {
    const rel = paths.本书记忆条目(input.名称.trim())
    writeBatchAtomic(bookRoot, bookMemoryOps(bookRoot, [input]))
    return { ok: true, relPath: rel }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

export const writeBookMemory = bookWriter(writeBookMemoryLocked)
