/** 本书记忆一事一文件；显式新增／更新，条目与索引同批落盘。 */
import * as path from 'node:path'
import { writeBatchAtomic, writeFileAtomic, type FileOp, bookWriter } from '../repo/atomic'
import { paths, type MemoryKind } from '../repo/paths'
import { parseDocument } from '../repo/frontmatter'
import { currentBookMemoryDocument, isMemoryKind } from '../repo/book-memory-contract'
import {
  memoryDocuments, memoryIndex, memoryPath, prepareMemory, readMemoryText, type MemoryMutation, type PreparedMemory, MemoryWriteError,
} from './write'

export interface BookMemoryInput extends MemoryMutation {
  readonly 类: MemoryKind
  readonly 名称: string
  readonly 描述?: string
  readonly 正文: string
  readonly 来源: string
  readonly 裁决记录: string
  readonly 标签?: readonly string[]
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

function bookMemoryDocuments(bookRoot: string) {
  const documents = memoryDocuments(bookRoot, '本书记忆')
  return documents.filter(document => {
    const shape = currentBookMemoryDocument(document.fields, path.posix.basename(document.relPath, '.md'), document.body)
    if (!shape.ok) throw new MemoryWriteError(`记忆条目解析失败：${document.relPath}；${shape.reason}`)
    // prepareMemory still reads the target on disk, so a scaffold cannot be overwritten.
    return shape.format === 'current'
  })
}

export function listBookMemoryEntries(bookRoot: string): readonly BookMemoryEntryView[] {
  return bookMemoryDocuments(bookRoot).flatMap(({ fields, relPath, body }) => !isMemoryKind(fields['类']) ? [] : [{
    类: fields['类'],
    名称: typeof fields['名称'] === 'string' ? fields['名称'] : path.basename(relPath, '.md'),
    ...(typeof fields['描述'] === 'string' ? { 描述: fields['描述'] } : {}),
    状态: typeof fields['状态'] === 'string' ? fields['状态'] : '',
    来源: typeof fields['来源'] === 'string' ? fields['来源'] : '',
    relPath, 正文: body,
  }])
}

export const rebuildBookMemoryIndex = bookWriter((bookRoot: string): string => {
  const relPath = paths.本书记忆索引()
  memoryPath(bookRoot, relPath)
  writeFileAtomic(bookRoot, relPath, memoryIndex('本书记忆索引', bookMemoryDocuments(bookRoot), [], readMemoryText(bookRoot, relPath)))
  return relPath
})

function prepareBookMemories(bookRoot: string, inputs: readonly BookMemoryInput[]): { ops: FileOp[]; results: PreparedMemory[] } {
  const docs = bookMemoryDocuments(bookRoot)
  const originalDocs = [...docs]
  const results: PreparedMemory[] = []
  const names = new Set<string>()
  memoryPath(bookRoot, paths.本书记忆索引())
  for (const input of inputs) {
    const identity = process.platform === 'win32' ? input.名称.trim().toLowerCase() : input.名称.trim()
    if (names.has(identity)) throw new MemoryWriteError(`记忆候选重复名称：${input.名称}`)
    names.add(identity)
    if (input.描述 !== undefined && (!input.描述.trim() || /[\r\n]/.test(input.描述))) throw new MemoryWriteError('记忆描述须为非空单行')
    if (!input.来源.trim()) throw new MemoryWriteError('记忆来源必填')
    const prepared = prepareMemory(bookRoot, '本书记忆', input, {
      ...(input.描述 === undefined ? {} : { 描述: input.描述.trim() }),
      ...(input.标签 === undefined ? {} : { 标签: input.标签.map(t => t.trim()).filter(Boolean) }),
      状态: '已确认', 来源: input.来源.trim(), 裁决记录: input.裁决记录, 适用范围: '本书',
    }, docs)
    results.push(prepared)
    if (prepared.changed) {
      const parsed = parseDocument(prepared.content)
      if (!parsed.ok) throw new MemoryWriteError(parsed.detail)
      docs.push({ relPath: prepared.relPath, text: prepared.content, fields: { ...parsed.data.fields }, body: parsed.data.body })
    }
  }
  const ops: FileOp[] = results.filter(item => item.changed).map(item => ({ relPath: item.relPath, content: item.content }))
  if (ops.length) ops.push({ relPath: paths.本书记忆索引(), content: memoryIndex('本书记忆索引', originalDocs, results, readMemoryText(bookRoot, paths.本书记忆索引())) })
  return { ops, results }
}

export function bookMemoryOps(bookRoot: string, inputs: readonly BookMemoryInput[]): readonly FileOp[] {
  return prepareBookMemories(bookRoot, inputs).ops
}

function writeBookMemoryLocked(bookRoot: string, input: BookMemoryInput) {
  const { ops, results } = prepareBookMemories(bookRoot, [input])
  writeBatchAtomic(bookRoot, ops)
  const result = results[0]!
  return { ok: true as const, relPath: result.relPath, changed: result.changed, updated: result.updated,
    ...(result.duplicate ? { duplicate: true as const } : {}) }
}

export const writeBookMemory = bookWriter((root: string, input: BookMemoryInput) => {
  try { return writeBookMemoryLocked(root, input) }
  catch (error) {
    if (error instanceof MemoryWriteError) return { ok: false as const, reason: error.message }
    throw error
  }
})
