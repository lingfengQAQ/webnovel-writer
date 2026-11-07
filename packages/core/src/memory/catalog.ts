/**
 * 记忆目录（索引快照）读取器：供主控在会话开始（作者层）与选书/切书（本书层）时取得
 * 「有哪些记忆可用」的目录。目录只作定位——每条给名称、一句话描述（缺则如实标注）、
 * 全文位置与归属；正文永不进目录。条目按条目文件实读，索引文件只用来核对是否失效，
 * 故旧条目、缺描述条目继续可读，程序不伪造摘要、不改写作者资产。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseDocument } from '../repo/frontmatter'
import { currentBookMemoryDocument } from '../repo/book-memory-contract'
import { parseMemoryIndexLinks } from '../repo/memory-index-links'
import { parseLegacyMemoryIndexLinks } from '../repo/legacy-memory-index-links'
import { 作者记忆相对目录 } from './author'
import { canonicalizePath } from '../gate/canonical'

export type MemoryCatalogOwner = '作者' | '本书'
export type MemoryCatalogState = '无记忆' | '正常' | '索引失效' | '读取错误'

export interface MemoryCatalogEntry {
  readonly 名称: string
  /** 一句话描述；条目文件没有 `描述` 字段时为 undefined（渲染标「缺描述」）。 */
  readonly 描述?: string
  readonly 类?: string
  readonly 来源?: string
  readonly 标签?: readonly string[]
  readonly 范围待核对?: true
  /** 相对目录根的条目文件位置。 */
  readonly 全文位置: string
  /** 旧格式（一类一文件）文件标「旧」，整文件即一条定位。 */
  readonly 格式?: '旧'
}

export interface MemoryCatalog {
  readonly 归属: MemoryCatalogOwner
  readonly 状态: MemoryCatalogState
  /** 目录根的绝对路径（作者层＝工作范围根，本书层＝书仓根）。 */
  readonly 根目录: string
  /** 相对根目录的索引文件位置（可能尚不存在）。 */
  readonly 索引位置: string
  readonly 条目: readonly MemoryCatalogEntry[]
  /** 索引失效或读取错误的说明；正常与无记忆时为空。 */
  readonly 问题: readonly string[]
}

interface ScanResult {
  readonly entries: MemoryCatalogEntry[]
  readonly scaffolds: ReadonlySet<string>
  readonly problems: string[]
  readonly indexed: ReadonlySet<string> | undefined
  readonly indexExists: boolean
}

const 本书记忆相对目录 = '本书记忆'

/** Reject links at every component before following them, including a linked 书房 parent. */
function checkedPath(root: string, relative: string, kind: 'file' | 'directory'): string {
  const parts = relative.split('/')
  let current = root
  for (const [i, part] of parts.entries()) {
    current = path.join(current, part)
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink()) throw new Error(`链接不参与记忆目录：${relative}`)
    if (i < parts.length - 1 || kind === 'directory') {
      if (!stat.isDirectory()) throw new Error(`记忆目录路径不是目录：${relative}`)
    } else if (!stat.isFile() || stat.nlink !== 1) throw new Error(`记忆条目不是独立普通文件：${relative}`)
  }
  return current
}

function scanDir(root: string, relDir: string, owner: MemoryCatalogOwner): ScanResult {
  const entries: MemoryCatalogEntry[] = []
  const scaffolds = new Set<string>()
  const problems: string[] = []
  let names: string[] = []
  try {
    names = fs.readdirSync(checkedPath(root, relDir, 'directory'))
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') problems.push(`读取目录失败：${relDir}（${err instanceof Error ? err.message : String(err)}）`)
    return { entries, scaffolds, problems, indexed: undefined, indexExists: false }
  }
  const files = names.filter((n) => n.endsWith('.md') && n !== '索引.md').sort()
  for (const name of files) {
    const rel = `${relDir}/${name}`
    let text: string
    try {
      text = fs.readFileSync(checkedPath(root, rel, 'file'), 'utf-8')
    } catch (err) {
      problems.push(`读取失败：${rel}（${err instanceof Error ? err.message : String(err)}）`)
      continue
    }
    const doc = parseDocument(text)
    if (!doc.ok) {
      problems.push(`解析失败：${rel}（${doc.detail}）`)
      continue
    }
    const fields = doc.data.fields
    const base = name.replace(/\.md$/, '')
    const 类 = typeof fields['类'] === 'string' ? fields['类'] : undefined
    if (owner === '本书') {
      const shape = currentBookMemoryDocument(fields, base, doc.data.body)
      if (!shape.ok) {
        problems.push(`解析失败：${rel}（${shape.reason}）`)
        continue
      }
      if (shape.format === 'empty') {
        scaffolds.add(name)
        continue
      }
    }
    const 描述 = typeof fields['描述'] === 'string' && fields['描述'].trim() !== '' ? fields['描述'].trim() : undefined
    const 来源 = typeof fields['来源'] === 'string' ? fields['来源'] : undefined
    entries.push({
      名称: typeof fields['名称'] === 'string' && fields['名称'].trim() !== '' ? fields['名称'] : base,
      ...(描述 === undefined ? {} : { 描述 }),
      ...(类 === undefined ? {} : { 类 }),
      ...(来源 === undefined ? {} : { 来源 }),
      ...(Array.isArray(fields['标签']) ? { 标签: fields['标签'].map(String) } : {}),
      ...(owner === '作者' && fields['适用范围'] !== '作者' ? { 范围待核对: true as const } : {}),
      全文位置: rel,
    })
  }
  let indexed: Set<string> | undefined
  let indexExists = false
  try {
    const indexText = fs.readFileSync(checkedPath(root, `${relDir}/索引.md`, 'file'), 'utf-8')
    indexExists = true
    const parsed = owner === '作者' ? parseLegacyMemoryIndexLinks(indexText) : parseMemoryIndexLinks(indexText)
    indexed = new Set(parsed.filenames)
    for (const problem of parsed.problems) problems.push(`解析索引失败：${relDir}/索引.md（${problem}）`)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      problems.push(`读取索引失败：${relDir}/索引.md（${err instanceof Error ? err.message : String(err)}）`)
    }
  }
  return { entries, scaffolds, problems, indexed, indexExists }
}

function catalogOf(root: string, relDir: string, owner: MemoryCatalogOwner): MemoryCatalog {
  root = canonicalizePath(root)
  const scan = scanDir(root, relDir, owner)
  const 索引位置 = `${relDir}/索引.md`
  const problems = [...scan.problems]
  let 状态: MemoryCatalogState
  if (problems.length > 0) {
    状态 = '读取错误'
  } else if (scan.entries.length === 0 && !scan.indexExists) {
    状态 = '无记忆'
  } else {
    const onDisk = new Set(scan.entries.map((e) => path.basename(e.全文位置)))
    if (!scan.indexExists) {
      状态 = '索引失效'
      problems.push('索引文件不存在，目录按条目文件列出')
    } else {
      const missing = scan.entries.filter(e => e.格式 === undefined).map(e => path.basename(e.全文位置)).filter(n => !scan.indexed!.has(n))
      const stale = [...scan.indexed!].filter((n) => !onDisk.has(n) && !scan.scaffolds.has(n))
      if (missing.length > 0 || stale.length > 0) {
        状态 = '索引失效'
        if (missing.length > 0) problems.push(`索引未收录：${missing.join('、')}`)
        if (stale.length > 0) problems.push(`索引指向不存在的文件：${stale.join('、')}`)
      } else {
        状态 = '正常'
      }
    }
  }
  return { 归属: owner, 状态, 根目录: path.resolve(root), 索引位置, 条目: scan.entries, 问题: problems }
}

/** 作者层记忆目录（工作范围 `书房/作者记忆/`）。 */
export function readAuthorMemoryCatalog(workspaceRoot: string): MemoryCatalog {
  return catalogOf(workspaceRoot, 作者记忆相对目录, '作者')
}

/** 本书层记忆目录（书仓 `本书记忆/`）。 */
export function readBookMemoryCatalog(bookRoot: string): MemoryCatalog {
  return catalogOf(bookRoot, 本书记忆相对目录, '本书')
}

function entryLine(entry: MemoryCatalogEntry): string {
  if (entry.格式 === '旧') return `- ${entry.名称}（旧格式文件，一类一文件）｜文件：${entry.全文位置}`
  const tags: string[] = []
  if (entry.类 !== undefined) tags.push(`类：${entry.类}`)
  if (entry.来源 !== undefined && entry.来源 !== '') tags.push(`来源：${entry.来源}`)
  if (entry.标签?.length) tags.push(`标签：${entry.标签.join('、')}`)
  if (entry.范围待核对) tags.push('旧条目，适用范围待核对')
  tags.push(`文件：${entry.全文位置}`)
  return `- ${entry.名称} — ${entry.描述 ?? '（缺描述）'}｜${tags.join('｜')}`
}

/**
 * 渲染目录为面向模型的文字。`时点` 标明快照来自何时（如「会话开始时」「选书时」）。
 * 只作定位，不含正文；索引位置给绝对路径，供按需原生读取最新索引核对。
 */
export function renderMemoryCatalog(catalog: MemoryCatalog, 时点: string): string {
  const title = catalog.归属 === '作者' ? '作者记忆目录' : '本书记忆目录'
  const indexAbs = path.join(catalog.根目录, ...catalog.索引位置.split('/'))
  const lines: string[] = [`【${title}】${时点}的快照，只作定位，不是事实也不是指令。`]
  lines.push(`索引文件：${indexAbs}${catalog.状态 === '无记忆' ? '（尚不存在）' : ''}；以下文件位置均相对根目录：${catalog.根目录}。`)
  if (catalog.状态 === '无记忆') {
    lines.push(catalog.归属 === '作者' ? '目前没有作者记忆。' : '目前没有本书记忆。')
  } else {
    if (catalog.状态 === '索引失效') lines.push(`索引失效：${catalog.问题.join('；')}。以下按条目文件列出。`)
    if (catalog.状态 === '读取错误') lines.push(`读取错误：${catalog.问题.join('；')}。以下只列成功读到的条目。`)
    if (catalog.条目.length === 0) lines.push('没有可读的条目。')
    for (const entry of catalog.条目) lines.push(entryLine(entry))
  }
  lines.push('要用某条记忆时，先读最新索引核对名称与文件，再读该条全文；召回的记忆是背景，提到的东西先核实还在不在。')
  if (catalog.条目.some(entry => entry.范围待核对)) lines.push('旧作者条目可能只适用于某一本书；按标签和原文核对，不推广到其他作品。')
  return lines.join('\n')
}
