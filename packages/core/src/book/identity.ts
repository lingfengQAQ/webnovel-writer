/**
 * 书架扫描(PRD §7.1 / plugin-spec §12「书目录由扫描工作范围发现」)。
 *
 * 扫工作范围根下的子目录:含 `作品契约/契约.md` 即一本书。
 * `书id` 从契约 frontmatter 读(core repo/readDoc)。
 * **派生数据只当定位器(判据四)**——本模块只给路径与身份,不产出结论、不做权威位置;
 * 身份与内容一律回读真源。不写任何登记文件(R16 已废除 books/登记.jsonl)。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { authorDocumentPath } from '../revise/document'
import { parseDocument } from '../repo/frontmatter'

/** 目录树常量对策:契约目录(与 core LAYOUT.契约 一致,防字符串漂移)。 */
const CONTRACT_DIR = '作品契约'
const CONTRACT_FILE = '契约.md'

export interface WorkspaceBook {
  /** 目录名(即书名,格式规格 §2.1 `<书名>/`)。 */
  readonly name: string
  /** 契约 frontmatter 的 `书id`(缺失时为 undefined,标记待建书修正)。 */
  readonly bookId: string | undefined
  /** 书仓根绝对路径。 */
  readonly root: string
}

/**
 * 列出工作范围下全部书。判定据四:只读真源文件结构,输出派生数据。
 * 子目录含契约文件即视为一本书(不依赖登记)。
 */
export function scanWorkspaceBooks(workspaceRoot: string): WorkspaceBook[] {
  const root = path.resolve(workspaceRoot)
  const books: WorkspaceBook[] = []
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    let contractPath: string
    try { contractPath = authorDocumentPath(root, path.join(entry.name, CONTRACT_DIR, CONTRACT_FILE)) }
    catch { continue }
    if (!isFile(contractPath)) continue
    books.push({
      name: entry.name,
      bookId: readBookId(contractPath),
      root: path.join(root, entry.name),
    })
  }
  // 排序稳定(按目录名),保证总览输出确定。
  books.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return books
}

/** 判断工作范围下是否有书(总览是否为空/是否走了「新建一本书」入口)。 */
export function hasBooks(workspaceRoot: string): boolean {
  return scanWorkspaceBooks(workspaceRoot).length > 0
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** 读契约 frontmatter 的 `书id`;解析失败/缺失返回 undefined(不作权威,仅定位)。 */
function readBookId(contractPath: string): string | undefined {
  let text: string
  try {
    text = fs.readFileSync(contractPath, 'utf8')
  } catch {
    return undefined
  }
  const result = parseDocument(text)
  if (!result.ok) return undefined
  const id = result.data.fields['书id']
  return typeof id === 'string' && id !== '' ? id : undefined
}

/** IDs select exactly one current book; ambiguous IDs never pick the first. */
export function uniqueBookRoot(workspaceRoot: string, bookId: string): string | undefined {
  const matches = scanWorkspaceBooks(workspaceRoot).filter(book => book.bookId === bookId)
  return matches.length === 1 ? matches[0]!.root : undefined
}
