import { promises as fs } from 'node:fs'
import path from 'node:path'
import { BookConfigReader } from '../storage/adapters/BookConfigReader.js'

/**
 * SessionStart 注入与书单自愈（story-repo-spec §2.0）。
 * 有 hook 宿主（Claude Code）启动调本层;无 hook 宿主由状态机入口调同一函数,行为等价。
 * 写侧（books.jsonl 登记/换书）属 M5;本层只读 + 扫描重建。
 */

/** 读 .webnovel/books.jsonl,逐行 JSON,损坏行跳过并计数 */
export async function readBooksRegistry(workdir) {
  const p = path.join(workdir, '.webnovel', 'books.jsonl')
  let content
  try {
    content = await fs.readFile(p, 'utf8')
  } catch {
    return { ok: false, missing: true, books: [], corrupt: 0 }
  }
  const books = []
  let corrupt = 0
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      books.push(JSON.parse(t))
    } catch {
      corrupt++
    }
  }
  return { ok: true, missing: false, books, corrupt }
}

/** 扫工作目录子目录,含 book.yaml 的重建书单（spec §0 可重建）。当前书标记缺失 → 需作者选一次 */
export async function scanRebuildBooks(workdir) {
  let entries
  try {
    entries = await fs.readdir(workdir, { withFileTypes: true })
  } catch (err) {
    return { ok: false, books: [], needsAuthorPick: false, error: err.message }
  }
  const books = []
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const cfg = await new BookConfigReader(path.join(workdir, e.name)).read()
    if (cfg.ok) {
      books.push({ 书名: cfg.data.书名 || e.name, 目录: e.name, 当前: false })
    }
  }
  return { ok: true, books, needsAuthorPick: books.length > 0, error: '' }
}

/**
 * 组装 SessionStart 注入文本（当前在写哪本/共几本/全书近况入口）。
 * 登记缺失或为空 → 扫描重建。两个宿主入口调本函数 → 注入逐字一致。
 */
export async function assembleSessionContext(workdir) {
  let reg = await readBooksRegistry(workdir)
  let rebuilt = false
  let needsAuthorPick = false
  if (!reg.ok || reg.missing || reg.books.length === 0) {
    const scan = await scanRebuildBooks(workdir)
    reg = { books: scan.books }
    rebuilt = true
    needsAuthorPick = scan.needsAuthorPick
  }
  const current = reg.books.find((b) => b.当前) || null
  const names = reg.books.map((b) => b.书名).join('、')
  const text = [
    current
      ? `当前在写《${current.书名}》`
      : reg.books.length
        ? `尚未选择当前书（候选：${names}）`
        : '尚未选择当前书',
    `共 ${reg.books.length} 本`,
    current ? '继续写作直接说「继续」（将读当前书全书近况）' : '请选择要写哪本书',
  ].join('；')
  return { ok: true, text, books: reg.books, current, rebuilt, needsAuthorPick }
}
