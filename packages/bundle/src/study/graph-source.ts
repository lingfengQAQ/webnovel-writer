import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { AuthorDocumentError, authorDocumentPath, LEDGER_NAMES, stripDevicePrefix, validateAuthorRelativePath } from '@webnovel/core'
import type { TreeEntry } from './types'

/** The same pinned-file checks as finalized retrieval, for a canonical graph scan root. */
export function readGraphFile(base: string, relative: string): string {
  validateAuthorRelativePath(relative)
  const file = path.join(base, relative)
  const checkPhysical = () => {
    if (stripDevicePrefix(fs.realpathSync.native(file)) !== file) throw new AuthorDocumentError('invalid-path', '图谱来源路径包含链接或别名')
  }
  checkPhysical()
  const initial = fs.lstatSync(file)
  if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1) throw new AuthorDocumentError('invalid-path', '图谱来源必须是独立的普通文件')
  if (initial.size > 4 * 1024 * 1024) throw new AuthorDocumentError('read-only', '图谱来源超过4MiB，未截断读取')
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    const opened = fs.fstatSync(descriptor)
    if (opened.dev !== initial.dev || opened.ino !== initial.ino || opened.nlink !== 1) throw new AuthorDocumentError('conflict', '图谱来源在打开时被替换')
    const bytes = fs.readFileSync(descriptor)
    checkPhysical()
    const current = fs.lstatSync(file), finished = fs.fstatSync(descriptor)
    if (!current.isFile() || current.nlink !== 1 || current.dev !== opened.dev || current.ino !== opened.ino
      || finished.size !== opened.size || finished.mtimeMs !== opened.mtimeMs || finished.ctimeMs !== opened.ctimeMs) throw new AuthorDocumentError('conflict', '图谱来源在读取期间已变化')
    if (bytes.length > 4 * 1024 * 1024 || bytes.includes(0)) throw new AuthorDocumentError('read-only', '图谱来源大小或文本格式不受支持')
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
    catch { throw new AuthorDocumentError('read-only', '图谱来源必须使用UTF-8') }
  } finally { fs.closeSync(descriptor) }
}

async function readGraphFileAsync(base: string, relative: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted(); validateAuthorRelativePath(relative)
  const file = path.join(base, relative)
  const checkPhysical = async () => {
    if (stripDevicePrefix(await fs.promises.realpath(file)) !== file) throw new AuthorDocumentError('invalid-path', '图谱来源路径包含链接或别名')
  }
  await checkPhysical()
  const initial = await fs.promises.lstat(file)
  if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1 || initial.size > 4 * 1024 * 1024) throw new AuthorDocumentError('read-only', '图谱来源不是安全的普通文本文件')
  const handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    if (opened.dev !== initial.dev || opened.ino !== initial.ino || opened.nlink !== 1) throw new AuthorDocumentError('conflict', '图谱来源在打开时被替换')
    const bytes = await handle.readFile({ signal })
    await checkPhysical()
    const current = await fs.promises.lstat(file), finished = await handle.stat()
    if (!current.isFile() || current.nlink !== 1 || current.dev !== opened.dev || current.ino !== opened.ino
      || finished.size !== opened.size || finished.mtimeMs !== opened.mtimeMs || finished.ctimeMs !== opened.ctimeMs) throw new AuthorDocumentError('conflict', '图谱来源在读取期间已变化')
    if (bytes.length > 4 * 1024 * 1024 || bytes.includes(0)) throw new AuthorDocumentError('read-only', '图谱来源大小或文本格式不受支持')
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
    catch { throw new AuthorDocumentError('read-only', '图谱来源必须使用UTF-8') }
  } finally { await handle.close() }
}

/** Bounded filesystem concurrency keeps source verification off the UI event loop. */
export async function scanGraphFiles(root: string, space: string, signal?: AbortSignal) {
  const directories = new Map<string, readonly TreeEntry[]>(), texts = new Map<string, string>(), errors = new Map<string, unknown>()
  const pending = ['作品契约/契约.md', ...LEDGER_NAMES.map(name => `账本/${name}.md`)]
  const scan = async (relative: string, depth = 0): Promise<void> => {
    signal?.throwIfAborted()
    if (depth > 12) return
    try {
      const directory = authorDocumentPath(root, relative, true)
      const entries = await fs.promises.readdir(directory, { withFileTypes: true })
      const rows: TreeEntry[] = entries.filter(item => !item.name.startsWith('.') && item.name !== 'node_modules').map(item => ({ name: item.name, directory: item.isDirectory(), draft: false,
        ref: { space, path: path.posix.join(relative, item.name) }, ...(item.isSymbolicLink() || !item.isFile() && !item.isDirectory() ? { error: '该条目不是安全的普通文件或目录' } : {}) }))
      directories.set(relative, rows)
      for (const entry of rows) {
        if (entry.error) continue
        if (entry.directory) await scan(entry.ref.path, depth + 1)
        else if (entry.name.endsWith('.md') && entry.name !== '模块声明.md') pending.push(entry.ref.path)
      }
    } catch (error) { signal?.throwIfAborted(); errors.set(relative, error) }
  }
  await scan('世界书')
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(12, pending.length) }, async () => {
    for (;;) {
      signal?.throwIfAborted(); const relative = pending[cursor++]; if (!relative) return
      try { texts.set(relative, await readGraphFileAsync(root, relative, signal)) }
      catch (error) { signal?.throwIfAborted(); errors.set(relative, error) }
    }
  }))
  const failure = (relative: string): never => {
    const error = errors.get(relative)
    if (!error || (error as NodeJS.ErrnoException).code === 'ENOENT') throw new AuthorDocumentError('not-found', '文件或目录不存在')
    throw error
  }
  const fingerprint = createHash('sha256').update(JSON.stringify([
    [...texts].sort(([a], [b]) => a.localeCompare(b)).map(([name, text]) => [name, createHash('sha256').update(text).digest('hex')]),
    [...directories].sort(([a], [b]) => a.localeCompare(b)),
    [...errors].map(([name, error]) => [name, error instanceof Error ? error.message : String(error)]).sort(),
  ])).digest('hex')
  return { fingerprint, read(relative: string) { return texts.get(relative) ?? failure(relative) }, list(relative: string) { return directories.get(relative) ?? failure(relative) } }
}
