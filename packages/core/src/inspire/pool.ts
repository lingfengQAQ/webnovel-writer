/**
 * 作者层灵感池(PRD §3.1 / D46):挂作者层记忆·灵感类,随手记自动入池,可见可删。
 * 落工作范围 `书房/灵感池/`(拍板 6,2026-08-29 权威落点),不进书仓;跨会话只凭文件恢复。
 * 调用方以工作范围根为 authorRoot。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { assertSegment } from '../repo/paths'
import { removeSync } from '../repo/remove'
import { createHash } from 'node:crypto'
import { withBookWrite, writeFileAtomic } from '../repo/atomic'

export const 灵感池相对目录 = '书房/灵感池'

export interface InspirationNote {
  readonly id: string
  readonly body: string
  readonly createdAt: string
  readonly schemaVersion?: number
  readonly type?: string
  readonly tags?: readonly string[]
  readonly references?: readonly InspirationReference[]
  readonly fields?: Readonly<Record<string, unknown>>
  readonly issues?: readonly string[]
}

export interface InspirationReference { 参考书: string; 原文版本: string; 机制: string; 机制版本: number }
export interface InspirationMetadata {
  type?: string
  tags?: readonly string[]
  references?: readonly InspirationReference[]
  fields?: Readonly<Record<string, unknown>>
  operationId?: string
}
export function validInspirationReference(value: unknown): value is InspirationReference {
  if (!value || typeof value !== 'object') return false
  const ref = value as InspirationReference
  return /^ref-[a-f0-9]{20,64}$/.test(ref.参考书) && /^[a-f0-9]{64}$/.test(ref.原文版本) && /^m-[a-f0-9]{20,64}$/.test(ref.机制) && Number.isSafeInteger(ref.机制版本) && ref.机制版本 > 0
}

export function poolDir(authorRoot: string): string {
  return path.join(authorRoot, ...灵感池相对目录.split('/'))
}

export function ingestNote(authorRoot: string, note: string, metadata?: InspirationMetadata): string {
  if (metadata?.references && !metadata.references.every(validInspirationReference)) throw new Error('灵感参考依据格式无效')
  if (metadata?.tags && !metadata.tags.every(tag => typeof tag === 'string' && tag.trim())) throw new Error('灵感标签必须是非空字符串')
  const hash = (text: string) => createHash('sha256').update(text).digest('hex')
  const id = metadata?.operationId ? `n-${hash(metadata.operationId).slice(0, 32)}` : nextNoteId()
  assertSegment(id, '灵感id')
  const dir = poolDir(authorRoot)
  const reserved = ['状态', '身份', '来源快照', '保存指纹']
  const extra = Object.fromEntries(Object.entries(metadata?.fields ?? {}).filter(([key]) => !reserved.includes(key)))
  const fields = { ...extra, ...(metadata ? { schemaVersion: 1 } : {}), ...(metadata?.type ? { 类型: metadata.type } : {}), ...(metadata?.tags ? { 标签: metadata.tags } : {}), ...(metadata?.references ? { 参考依据: metadata.references } : {}) }
  const fingerprint = hash(serializeDocument(fields, note))
  return withBookWrite(dir, () => {
    const target = path.join(dir, `${id}.md`)
    if (metadata?.operationId && fs.existsSync(target)) {
      const previous = parseDocument(fs.readFileSync(target, 'utf8'))
      const previousFields = previous.ok ? Object.fromEntries(Object.entries(previous.data.fields).filter(([key]) => !reserved.includes(key))) : {}
      if (!previous.ok || previous.data.fields['保存指纹'] !== fingerprint || hash(serializeDocument(previousFields, previous.data.body)) !== fingerprint) throw new Error('同一次保存的内容已变化，请使用新的操作身份')
      return id
    }
    const createdAt = new Date().toISOString()
    const text = serializeDocument({ ...fields, 状态: '候选', 身份: id, 来源快照: createdAt, ...(metadata?.operationId ? { 保存指纹: fingerprint } : {}) }, note)
    writeFileAtomic(dir, `${id}.md`, text)
    return id
  })
}

export function listNotes(authorRoot: string): readonly InspirationNote[] {
  const dir = poolDir(authorRoot)
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const out: InspirationNote[] = []
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const id = name.slice(0, -3)
    const abs = path.join(dir, name)
    let text: string
    try {
      text = fs.readFileSync(abs, 'utf-8')
    } catch {
      continue
    }
    const r = parseDocument(text)
    const body = (r.ok ? r.data.body : text).replace(/\r\n/g, '\n').replace(/\n+$/, '')
    const createdAt = r.ok && typeof r.data.fields['来源快照'] === 'string'
      ? r.data.fields['来源快照']
      : ''
    const fields = r.ok ? r.data.fields : {}
    const issues: string[] = []
    const schemaVersion = fields['schemaVersion']
    if (schemaVersion !== undefined && schemaVersion !== 1) issues.push('schemaVersion 不受支持')
    const type = fields['类型'], tags = fields['标签'], references = fields['参考依据']
    if (type !== undefined && typeof type !== 'string') issues.push('类型应为文本')
    if (tags !== undefined && (!Array.isArray(tags) || !tags.every(tag => typeof tag === 'string'))) issues.push('标签应为字符串数组')
    if (references !== undefined && (!Array.isArray(references) || !references.every(validInspirationReference))) issues.push('参考依据格式无效，不能作为可信引用下钻')
    out.push({ id, body, createdAt, ...(Object.keys(fields).length ? { fields } : {}),
      ...(schemaVersion === 1 ? { schemaVersion } : {}), ...(typeof type === 'string' ? { type } : {}),
      ...(Array.isArray(tags) && tags.every(tag => typeof tag === 'string') ? { tags: tags as string[] } : {}),
      ...(!issues.length && Array.isArray(references) ? { references: references as InspirationReference[] } : {}), ...(issues.length ? { issues } : {}) })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function deleteNote(authorRoot: string, id: string): boolean {
  assertSegment(id, '灵感id')
  const abs = path.join(poolDir(authorRoot), `${id}.md`)
  if (!fs.existsSync(abs)) return false
  removeSync(abs)
  return true
}

export function searchNotes(authorRoot: string, query: string, filter?: { type?: string; tags?: readonly string[] }): readonly InspirationNote[] {
  return listNotes(authorRoot).filter(n => (!filter?.type || n.type === filter.type) && (!filter?.tags || filter.tags.every(tag => n.tags?.includes(tag)))
    && [n.body, n.id, n.type ?? '', ...(n.tags ?? [])].some(value => value.includes(query)))
}

function nextNoteId(): string {
  const t = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 6)
  return `n${t}${r}`
}
