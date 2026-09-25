/**
 * 建书最小目录脚手架(格式规格 §2.1):空模板,不发明创作内容。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { applyVersionFields, initialVersion } from '../provenance'
import { 契约六部, 分卷布局八部, 故事骨架九部, 世界书最小模块 } from '../derive/design'
import { parseConcept, serializeConcept, type Concept } from '../inspire/concept'
import { writeBatchAtomic, type FileOp } from '../repo/atomic'
import { runtimeIgnoreLine } from '../repo/transaction'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { LEDGER_NAMES, LAYOUT, MEMORY_KINDS, DRAFT_DIRS, paths } from '../repo/paths'

export const 账本五文件 = LEDGER_NAMES
export const 本书记忆四文件 = MEMORY_KINDS

function labeledHeadings(names: readonly string[], state: string): string {
  return names.map((n) => `## ${n} 〔${state}〕\n`).join('\n')
}

export function emptyContractBody(bookId?: string): string {
  const fm = bookId === undefined ? '' : `---\n书id: ${bookId}\n---\n`
  return `${fm}# 作品契约\n\n${labeledHeadings(契约六部, '留白')}`
}

export function emptySkeletonBody(): string {
  return `# 故事骨架\n\n${labeledHeadings(故事骨架九部, '留白')}`
}

export function emptyVolumeLayoutBody(): string {
  return `# 分卷布局\n\n${labeledHeadings(分卷布局八部, '留白')}`
}

export function emptyVolumeOutlineBody(): string {
  return '# 卷纲\n\n## 叙事结构 〔留白〕\n\n## 弧线 〔留白〕\n\n## 线索推进 〔留白〕\n\n## 卷末兑现 〔留白〕\n'
}

export function emptyPlanTimelineBody(): string {
  return '# 计划时间线\n\n## 窗口覆盖\n\n## 窗口外锚点\n'
}

export function emptyWindowBody(): string {
  return '# 近期窗口\n'
}

export function conceptSnapshotText(concept: Concept | string): string {
  const obj = typeof concept === 'string' ? parseConcept(concept) : concept
  if (obj === null) throw new Error('构想不存在')
  const md = serializeConcept({ ...obj, 状态: '已确认' })
  const parsed = parseDocument(md)
  const fields = parsed.ok ? parsed.data.fields : { 状态: '已确认' }
  const body = parsed.ok ? parsed.data.body : md
  const v = initialVersion('建书')
  return serializeDocument(applyVersionFields(fields, v), body)
}

export function scaffoldBookFiles(bookRoot: string, concept: Concept | string, opts: { readonly bookId?: string } = {}): void {
  const ops: FileOp[] = [
    { relPath: paths.契约(), content: emptyContractBody(opts.bookId) },
    { relPath: paths.构想快照(), content: conceptSnapshotText(concept) },
    { relPath: paths.故事骨架(), content: emptySkeletonBody() },
    { relPath: paths.分卷布局(), content: emptyVolumeLayoutBody() },
    { relPath: paths.卷纲(1), content: emptyVolumeOutlineBody() },
    { relPath: paths.计划时间线(1), content: emptyPlanTimelineBody() },
    { relPath: paths.近期窗口(1), content: emptyWindowBody() },
    // 最小模块建书即登记:scanDesign 只认模块声明里登记过的模块,确认条目工具只写条目本身
    { relPath: '世界书/模块声明.md', content: ['# 模块声明', '', ...世界书最小模块.map((名) => `- ${名}`), ''].join('\n') },
    ...账本五文件.map((名) => ({ relPath: `账本/${名}.md`, content: `# ${名}\n` })),
    ...本书记忆四文件.map((名) => ({ relPath: `本书记忆/${名}.md`, content: `# ${名}\n` })),
  ]
  writeBatchAtomic(bookRoot, ops)

  // 草稿区不入 git（拍板 1：草稿区永不入版本库）：目录结构由脚手架保证，不放 .gitkeep、
  // 由 .gitignore 排除——否则首提交把草稿区送进版本库，与 checkCommitPath 拒绝草稿区自相矛盾，
  // 且 git status 永久脏。定稿/卷01 在白名单内，保留 .gitkeep 让版本库记住目录。
  fs.writeFileSync(path.join(bookRoot, '.gitignore'), `草稿区/\n${runtimeIgnoreLine()}\n`, 'utf-8')

  fs.mkdirSync(path.join(bookRoot, LAYOUT.定稿(1)), { recursive: true })
  const keep = path.join(bookRoot, LAYOUT.定稿(1), '.gitkeep')
  if (!fs.existsSync(keep)) fs.writeFileSync(keep, '', 'utf-8')

  for (const d of DRAFT_DIRS) {
    fs.mkdirSync(path.join(bookRoot, LAYOUT.草稿区, d), { recursive: true })
  }
}
