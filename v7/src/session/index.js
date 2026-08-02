import { promises as fs } from 'node:fs'
import path from 'node:path'
import { BookConfigReader } from '../storage/adapters/BookConfigReader.js'
import { isSafeFileStem } from '../util/filename.js'

/**
 * SessionStart 注入与书单登记（story-repo-spec §2.0）。
 * Claude Code 的 hook 与无 hook 宿主生成壳都调用 session-context；next 另走状态机序 2
 * 做事后手改检测，不能把两者描述成 PreToolUse 写前拦截。
 * 读侧 + 扫描重建自愈（M4）与写侧（登记/换书/最后打开,M5）同模块,books.jsonl 格式单源。
 */

/**
 * books.jsonl 行形状校验（P3-F11）：JSON 能解不等于能账本——
 * 形状非法的行（`目录` 含 `/`、`\`、`..`、绝对路径、Windows 保留名、非字符串，
 * 或 `书名` 非非空字符串）一律判 corrupt 进既有自愈回写通道。
 * 判据=「目录是单层安全文件名干」（isSafeFileStem——P0 单源，不另建黑名单；
 * JSONL 行是机器账本字段不是语义标的，与白名单文件干同族）。写侧 registerBook 同款口径。
 */
function isValidBookEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
  if (typeof entry.书名 !== 'string' || !entry.书名.trim()) return false
  if (typeof entry.目录 !== 'string' || !entry.目录) return false
  return isSafeFileStem(entry.目录)
}

/** 读 .webnovel/books.jsonl,逐行 JSON,损坏行跳过并计数（P3-F11：形状非法行同计） */
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
    let entry = null
    try {
      entry = JSON.parse(t)
    } catch {
      entry = null
    }
    if (entry && isValidBookEntry(entry)) books.push(entry)
    else corrupt++
  }
  return { ok: true, missing: false, books, corrupt }
}

/**
 * 自愈回写：把有效书单写回 .webnovel/books.jsonl（P1-4）。
 * 失败不阻断会话（best-effort 由调用方决定）。
 */
export async function writeBooksRegistry(workdir, books) {
  const dir = path.join(workdir, '.webnovel')
  await fs.mkdir(dir, { recursive: true })
  const p = path.join(dir, 'books.jsonl')
  const content = books.map((b) => JSON.stringify(b)).join('\n') + '\n'
  await fs.writeFile(p, content, 'utf8')
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
 * 读书单并自愈：登记缺失/为空 → 扫描重建回写;坏行 → 丢弃回写好行。
 * SessionStart 注入、工作目录定位、list-books 共用本函数,自愈逻辑单源。
 * 并发跑两条命令时自愈回写是 last-write-wins：登记可随时从各书 book.yaml 扫描重建,接受现状。
 */
export async function loadBooks(workdir) {
  let reg = await readBooksRegistry(workdir)
  let rebuilt = false
  let needsAuthorPick = false
  let toWrite = null

  if (!reg.ok || reg.missing || reg.books.length === 0) {
    const scan = await scanRebuildBooks(workdir)
    reg = { ok: true, missing: false, books: scan.books, corrupt: 0 }
    rebuilt = true
    needsAuthorPick = scan.needsAuthorPick
    // 扫描重建结果回写,下个会话不必再扫
    if (scan.books.length) toWrite = scan.books
  } else if (reg.corrupt > 0) {
    // 部分损坏：丢坏行,把好行回写（自愈,不再长期半坏）
    toWrite = reg.books
  }

  if (toWrite) {
    try {
      await writeBooksRegistry(workdir, toWrite)
    } catch {
      // 回写失败不阻断会话（best-effort）
    }
  }
  return { ok: true, books: reg.books, rebuilt, needsAuthorPick }
}

/** 本地日期 YYYY-MM-DD（「最后打开」是作者可见字段,取本地时区） */
function localDate() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 登记一本书并置为当前（建书流程调用）。同目录已登记则更新书名,不产生重复行。
 * P3-F11 写侧校验：`书名` 非空字符串、`目录` 为单层安全文件名干——
 * 否则一行坏数据就能让下游 `git clean -fd` / `fs.rm` 落到工作目录外（与读侧同口径单源判定）。
 */
export async function registerBook(workdir, { 书名, 目录 }) {
  if (typeof 书名 !== 'string' || !书名.trim()) {
    return { ok: false, error: '登记需要非空字符串的 书名 字段', books: [] }
  }
  if (typeof 目录 !== 'string' || !isSafeFileStem(目录)) {
    return {
      ok: false,
      error: `目录「${typeof 目录 === 'string' && 目录 ? 目录 : '（空）'}」不合法：须为单层目录名，不能含路径分隔符、绝对路径或「..」（P3-F11 安全校验）`,
      books: [],
    }
  }
  const { books } = await loadBooks(workdir)
  const kept = books.filter((b) => b.目录 !== 目录).map((b) => ({ ...b, 当前: false }))
  kept.push({ 书名, 目录, 当前: true, 最后打开: localDate() })
  try {
    await writeBooksRegistry(workdir, kept)
  } catch (err) {
    return { ok: false, error: `写书单失败：${err.message}`, books: [] }
  }
  return { ok: true, books: kept, error: '' }
}

/**
 * 换书：按书名或目录名精确匹配置「当前」。未命中返回候选,人话交作者。
 */
export async function setCurrentBook(workdir, name) {
  const { books } = await loadBooks(workdir)
  const hit = books.find((b) => b.书名 === name || b.目录 === name)
  if (!hit) {
    const 候选 = books.map((b) => b.书名).join('、') || '（书单为空）'
    return { ok: false, book: null, error: `没有叫《${name}》的书。候选：${候选}` }
  }
  const next = books.map((b) =>
    b === hit ? { ...b, 当前: true, 最后打开: localDate() } : { ...b, 当前: false }
  )
  try {
    await writeBooksRegistry(workdir, next)
  } catch (err) {
    return { ok: false, book: null, error: `写书单失败：${err.message}` }
  }
  return { ok: true, book: next.find((b) => b.当前), error: '' }
}

/** 会话打开当前书时刷新「最后打开」。best-effort,失败不阻断 */
export async function touchLastOpened(workdir, 目录) {
  try {
    const reg = await readBooksRegistry(workdir)
    if (!reg.ok || reg.missing) return
    const next = reg.books.map((b) => (b.目录 === 目录 ? { ...b, 最后打开: localDate() } : b))
    await writeBooksRegistry(workdir, next)
  } catch {
    // best-effort
  }
}

/**
 * 组装会话上下文文本（当前在写哪本/共几本/全书近况入口）。
 * 登记缺失或为空 → 扫描重建。SessionStart 与生成壳显式入口调本函数 → 文本逐字一致。
 */
export async function assembleSessionContext(workdir) {
  const { books, rebuilt, needsAuthorPick } = await loadBooks(workdir)

  const current = books.find((b) => b.当前) || null
  const names = books.map((b) => b.书名).join('、')
  const text = [
    current
      ? `当前在写《${current.书名}》`
      : books.length
        ? `尚未选择当前书（候选：${names}）`
        : '尚未选择当前书',
    `共 ${books.length} 本`,
    current ? '继续写作直接说「继续」（将读当前书全书近况）' : '请选择要写哪本书',
  ].join('；')
  return { ok: true, text, books, current, rebuilt, needsAuthorPick }
}
