/**
 * 草稿区草稿枚举(格式规格 §9.1):稿N.md + 角色/选定。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseDocument, serializeDocument } from './frontmatter'
import { writeFileAtomic } from './atomic'
import { extractVersionFields } from '../provenance'
import { paths } from './paths'
import type { ChapterKey } from '../derive/scan'
import { bookWriter } from './atomic'

/** 草稿 frontmatter 字段序(格式规格 §9.1 草稿协议)——写稿/润色/改稿共用一份。 */
export const 草稿字段序 = [
  '身份', '版本', '父版本', '生成模块', '来源快照', '角色', '选定', '保真风险',
] as const

export interface DraftFile {
  readonly file: string
  readonly relPath: string
  readonly 角色: string | null
  readonly 选定: boolean
  readonly 版本: number | null
  readonly body: string
  readonly text: string
}

function readText(root: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf-8')
  } catch {
    return null
  }
}

/** Compare filenames using the host's case policy without changing their identity. */
function filenameCase(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

export function isDraftMarkdownFile(file: string): boolean {
  return filenameCase(file).endsWith('.md')
}

export function isNumberedDraftPath(relative: string): boolean {
  return /^草稿区\/草稿\/[^/]+\/稿\d+\.md$/.test(filenameCase(relative.replace(/\\/g, '/')))
}

export function listChapterDrafts(bookRoot: string, key: Pick<ChapterKey, '卷' | '章名'>): readonly DraftFile[] {
  const dir = paths.草稿目录(key.卷, key.章名)
  const abs = path.join(bookRoot, dir)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return []
  return fs.readdirSync(abs).filter(isDraftMarkdownFile).sort((a, b) => a.localeCompare(b, 'zh')).flatMap((file) => {
    const relPath = path.posix.join(dir, file)
    const text = readText(bookRoot, relPath)
    if (text === null) return []
    const doc = parseDocument(text)
    const fields = doc.ok ? doc.data.fields : {}
    return [{
      file,
      relPath,
      角色: typeof fields['角色'] === 'string' ? fields['角色'] : null,
      选定: fields['选定'] === true,
      版本: extractVersionFields(fields).版本,
      body: doc.ok ? doc.data.body : text,
      text,
    }]
  })
}

/** 返回唯一待审稿;无稿或多稿均返回 null，调用方必须结合 count 给出明确拒绝原因。 */
export function findPendingReviewDraft(bookRoot: string, key: Pick<ChapterKey, '卷' | '章名'>): DraftFile | null {
  const pending = listChapterDrafts(bookRoot, key).filter((d) => d.角色 === '待审稿')
  return pending.length === 1 ? pending[0]! : null
}

export function countPendingReviewDrafts(bookRoot: string, key: Pick<ChapterKey, '卷' | '章名'>): number {
  return listChapterDrafts(bookRoot, key).filter((d) => d.角色 === '待审稿').length
}

function draftNo(file: string): number {
  const m = /^稿(\d+)\.md$/.exec(filenameCase(file))
  return m === null ? 0 : Number(m[1])
}

/** 下一份草稿的文件名(稿N+1.md);解析不出编号的文件按 0 计。 */
export function nextDraftFileName(bookRoot: string, key: Pick<ChapterKey, '卷' | '章名'>): string {
  const nos = listChapterDrafts(bookRoot, key).map((d) => draftNo(d.file))
  return `稿${nos.length === 0 ? 1 : Math.max(...nos) + 1}.md`
}

/**
 * 降级除 keepRelPath 外的所有待审稿为 `草稿` 并清 `选定`。
 *
 * 待审稿唯一是推导表行 6 的前提(格式规格 §8):同时存在两份会退回润色位并死锁,
 * 因此任何产出新待审稿的道(润色/改稿)都必须先调用本函数,且降级先于写新稿。
 */
export function prepareDraftDemotions(
  bookRoot: string,
  key: Pick<ChapterKey, '卷' | '章名'>,
  keepRelPath: string,
): readonly { relPath: string; content: string }[] {
  const demoted: { relPath: string; content: string }[] = []
  for (const draft of listChapterDrafts(bookRoot, key)) {
    if (draft.relPath === keepRelPath) continue
    const wasPending = draft.角色 === '待审稿'
    if (!wasPending && !draft.选定) continue
    const doc = parseDocument(draft.text)
    if (!doc.ok) continue
    const fields = { ...doc.data.fields, ...(wasPending ? { 角色: '草稿' } : {}), 选定: false }
    demoted.push({ relPath: draft.relPath, content: serializeDocument(fields, doc.data.body, 草稿字段序) })
  }
  return demoted
}

export const demoteOtherPendingDrafts = bookWriter((root: string, key: Pick<ChapterKey, '卷' | '章名'>, keepRelPath: string): readonly string[] => {
  const ops = prepareDraftDemotions(root, key, keepRelPath)
  for (const op of ops) writeFileAtomic(root, op.relPath, op.content)
  return ops.map(op => op.relPath)
})

/** 候选事实段标题(必须是整行,同前缀长标题如「补充」属于正文)。 */
export const CANDIDATE_HEADING = '## 草稿候选事实'

/**
 * 拆出候选事实段:正文(不含标题)与候选行(去列表符)。
 * 候选行格式 `- 类别：内容`(五类前缀见《正文起草》),给沉淀子代理分拣用,非机器校验。
 */
export function splitCandidateFacts(body: string): { prose: string; facts: string[] } {
  const norm = body.replace(/\r\n/g, '\n')
  // 必须是整行标题:「## 草稿候选事实补充」之类的同前缀标题属于正文
  const heading = new RegExp(`(^|\\n)${CANDIDATE_HEADING}[ \\t]*(?=\\n|$)`)
  const match = heading.exec(norm)
  if (match === null) return { prose: norm.trim(), facts: [] }
  const cut = match.index + match[1]!.length
  const prose = norm.slice(0, cut).trim()
  const rest = norm.slice(cut + match[0].length - match[1]!.length).replace(/^\n+/, '')
  const facts = rest.split('\n').map((l) => l.replace(/^\s*[-*]\s+/, '').trim()).filter((s) => s !== '')
  return { prose, facts }
}

/** 正文与候选事实拼回一份草稿 body。 */
export function composeBody(prose: string, facts: readonly string[]): string {
  const p = prose.replace(/\r\n/g, '\n').replace(/\n+$/, '')
  if (facts.length === 0) return p
  return `${p}\n\n${CANDIDATE_HEADING}\n\n${facts.map((f) => `- ${f}`).join('\n')}`
}
