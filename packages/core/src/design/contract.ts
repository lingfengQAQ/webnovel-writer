/**
 * 作品定调(PRD §3.4 / 格式规格 §3.1):契约六部模板与完成谓词。
 * 作者整份审定 M0 = 六部皆已确认;不另设签名文件。
 * N1 修复:更新分部时保留书id frontmatter 与其余分部正文内容。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { 契约六部, parseLabeledStates } from '../derive/design'
import { writeFileAtomic, type FileOp } from '../repo/atomic'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { paths } from '../repo/paths'
import { bookWriter } from '../repo/atomic'
import { parseChapterLength } from './chapter-length'

export type ContractPartState = '已确认' | '暂定' | '留白'

export interface ContractPart {
  readonly state: ContractPartState
  readonly body?: string
}

export type ContractParts = Partial<Record<(typeof 契约六部)[number], ContractPart>>

export function contractTemplate(parts: ContractParts = {}, fields: Record<string, unknown> = {}): string {
  const lines: string[] = ['# 作品契约', '']
  for (const name of 契约六部) {
    const part = parts[name]
    const state = part?.state ?? '留白'
    lines.push(`## ${name} 〔${state}〕`, '')
    if (part?.body !== undefined && part.body.trim() !== '' && state !== '留白') {
      lines.push(part.body.trim(), '')
    }
  }
  return serializeDocument(fields, lines.join('\n').trimEnd() + '\n')
}

/** 读取当前现有契约的分部与 frontmatter 字典 */
export function readExistingContract(bookRoot: string): {
  readonly fields: Record<string, unknown>
  readonly parts: ContractParts
} {
  const abs = path.join(bookRoot, paths.契约())
  let text: string
  try {
    text = fs.readFileSync(abs, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { fields: {}, parts: {} }
    throw error
  }
  const doc = parseDocument(text)
  if (!doc.ok) throw new Error(`契约解析失败：${doc.detail}`)
  const labeled = parseLabeledStates(doc.data.body)
  const bodies = extractContractSectionBodies(doc.data.body)
  const parts: ContractParts = {}
  for (const item of labeled) {
    if ((契约六部 as readonly string[]).includes(item.name)) {
      const name = item.name as (typeof 契约六部)[number]
      parts[name] = {
        state: item.state === '已确认' || item.state === '暂定' ? item.state : '留白',
        body: bodies[name] ?? '',
      }
    }
  }
  return { fields: doc.data.fields, parts }
}

/** 提取契约中每个 ## 分部的正文 */
function extractContractSectionBodies(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lines = body.split('\n')
  let currentHeader: string | null = null
  let currentLines: string[] = []

  for (const line of lines) {
    const m = /^##\s+(.+?)(?:\s*[〔(](.+?)[〕)])?\s*$/.exec(line)
    if (m) {
      if (currentHeader !== null) {
        out[currentHeader] = currentLines.join('\n').trim()
      }
      currentHeader = m[1]!.trim()
      currentLines = []
    } else if (currentHeader !== null) {
      currentLines.push(line)
    }
  }
  if (currentHeader !== null) {
    out[currentHeader] = currentLines.join('\n').trim()
  }
  return out
}

/** 安全更新契约分部（合并现有 frontmatter 和未更新的分部，防止 N1 抹除书id 与正文） */
export function prepareContract(bookRoot: string, parts: ContractParts = {}, extraFields: Record<string, unknown> = {}): FileOp {
  const existing = readExistingContract(bookRoot)
  const mergedFields = { ...existing.fields, ...extraFields }
  const mergedParts: ContractParts = { ...existing.parts }
  for (const name of 契约六部) {
    if (parts[name] !== undefined) {
      mergedParts[name] = parts[name]
    }
  }
  const content = contractTemplate(mergedParts, mergedFields)
  const length = parseChapterLength(content)
  if (length.状态 === '配置错误') throw new Error(length.原因)
  return { relPath: paths.契约(), content }
}

function writeContractLocked(bookRoot: string, parts: ContractParts = {}, extraFields: Record<string, unknown> = {}): void {
  const op = prepareContract(bookRoot, parts, extraFields)
  writeFileAtomic(bookRoot, op.relPath, op.content)
}

export const writeContract = bookWriter(writeContractLocked)

export function checkContractComplete(bookRoot: string):
  | { readonly ok: true }
  | { readonly ok: false; readonly gaps: readonly string[] } {
  const abs = path.join(bookRoot, paths.契约())
  let text: string
  try {
    text = fs.readFileSync(abs, 'utf-8')
  } catch {
    return { ok: false, gaps: ['契约不存在'] }
  }
  const r = parseDocument(text)
  if (!r.ok) return { ok: false, gaps: [`契约解析失败:${r.detail}`] }
  const labeled = parseLabeledStates(r.data.body)
  const gaps = 契约六部.filter((name) => !labeled.some((e) => e.name === name && e.state === '已确认'))
  return gaps.length === 0 ? { ok: true } : { ok: false, gaps }
}
