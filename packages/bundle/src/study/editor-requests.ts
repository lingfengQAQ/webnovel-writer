import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'
import { EDITOR_REQUEST_SOURCE } from '../message-sources'
import { studyFileLink } from './links'
import type { FileRef } from './types'

export const EDITOR_INTENTS = ['polish', 'expand', 'condense', 'review', 'continue', 'custom'] as const
export type EditorIntent = typeof EDITOR_INTENTS[number]
export const EDITOR_REQUEST_ID = /^[a-z0-9]{6,16}$/
export const EDITOR_PENDING_LIMIT = 8
export const EDITOR_ENTRY_LIMIT = 64
export const EDITOR_TTL_MS = 30 * 60 * 1000
export const EDITOR_INSTRUCTION_LIMIT = 500
export const EDITOR_SELECTION_LIMIT = 8000
export const EDITOR_CONTEXT_LIMIT = 400
export const EDITOR_NOTE_LIMIT = 200
export const EDITOR_COMMENT_NOTE_LIMIT = 300
export const EDITOR_COMMENT_LIMIT = 12
export const EDITOR_REPLACE_CAP = 20000

export const EDITOR_UNKNOWN_REASON = '未知请求编号；只有书房编辑器发来的请求才能用此工具回复。'
export const EDITOR_CANCELLED_REASON = '作者已取消此请求，停止处理，不要改写文件。'
export const EDITOR_DUPLICATE_REASON = '该请求已经回复过；作者需要新版本时会重新发起。'
export const EDITOR_UNANSWERED_REASON = '此请求已结束且没有交回结果；作者需要新版本时会重新发起，不要改写文件。'
export const EDITOR_DELIVERED_MESSAGE = '已送到编辑器，等待作者决定是否采用；不要再直接修改文件里的这段文字。'

export type EditorRequestState = 'queued' | 'working' | 'replied' | 'unanswered' | 'cancelled'
export type EditorReply =
  | { readonly kind: 'replace'; readonly text: string; readonly note?: string }
  | { readonly kind: 'insert'; readonly text: string; readonly note?: string }
  | { readonly kind: 'comments'; readonly comments: readonly { readonly quote: string; readonly note: string }[]; readonly note?: string }
  | { readonly kind: 'none'; readonly note?: string }

export interface EditorRequestSnapshot {
  readonly requestId: string
  readonly intent: EditorIntent
  readonly instruction?: string
  readonly dirty: boolean
  readonly hash: string
  readonly ref: FileRef
  readonly document: {
    readonly owner: string
    readonly path: string
    readonly space: string
    readonly version: string | number | null
    readonly absolutePath: string
  }
  readonly selection: { readonly text: string; readonly line: number; readonly before: string; readonly after: string }
}

export interface EditorRequestItem {
  readonly requestId: string
  readonly state: EditorRequestState | 'unknown'
  readonly reply?: EditorReply
}

export interface EditorRequestAgent {
  readonly status?: string
  readonly session?: {
    readonly seq?: number
    readonly eventAt?: Session['eventAt']
  }
}

export class EditorRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditorRequestError'
  }
}

interface Entry {
  snapshot: EditorRequestSnapshot
  state: EditorRequestState
  reply?: EditorReply
  createdAt: number
  lastAccessAt: number
  closedAt?: number
}

const INTENT_LABEL: Record<EditorIntent, string> = {
  polish: '润色', expand: '扩写', condense: '精简', review: '审读', continue: '续写', custom: '按要求改',
}
const INTENT_REQUIREMENT: Record<EditorIntent, string> = {
  polish: '润色只调整措辞和节奏，不新增行动者、立场、动作或事实。',
  expand: '保持人物和事件不变，补充感官和动作细节。',
  condense: '保留信息和语气，删去重复。',
  review: '只标出问题，用 comments，每条 quote 必须逐字摘自原文。',
  continue: '从插入点接着写，不改动前文。',
  custom: '照作者要求处理。',
}

export function textLength(text: string): number {
  return Array.from(text).length
}

export function clipText(text: string, limit: number, side: 'head' | 'tail' = 'head'): string {
  const units = Array.from(text)
  if (units.length <= limit) return text
  if (side === 'tail') return '…' + units.slice(units.length - limit).join('')
  return units.slice(0, limit).join('') + '…'
}

/** Keep the directory of an absolute path and swap the relative draft path, including Windows separators. */
function movedAbsolutePath(absolutePath: string, fromPath: string, toPath: string): string {
  const slash = absolutePath.includes('\\') ? '\\' : '/'
  const from = fromPath.split('/').join(slash)
  const to = toPath.split('/').join(slash)
  if (!from || (!absolutePath.endsWith(from) && absolutePath !== from)) return absolutePath
  return absolutePath.slice(0, absolutePath.length - from.length) + to
}

function shortHash(hash: string): string {
  return hash.length > 12 ? hash.slice(0, 12) + '…' : hash
}

function quoted(text: string): string {
  return text.split('\n').map(line => '> ' + line).join('\n')
}

/** Followup text the author can open in the conversation, and the instruction the main agent must follow. */
export function requestMessage(request: EditorRequestSnapshot): string {
  const { document, selection } = request
  const lines = [
    `【书房编辑器 · ${INTENT_LABEL[request.intent]}】#${request.requestId}`,
    `文档：${document.owner} / ${document.path}（${document.space}，稿${document.version ?? '—'}，基线 ${shortHash(request.hash)}${request.dirty ? '，含未保存编辑' : ''}）`,
  ]
  if (request.intent === 'continue') {
    lines.push(`位置：第 ${selection.line} 行之后（续写插入点）`, `前文：${clipText(selection.before, 80, 'tail') || '（无）'}`)
  } else {
    lines.push(
      `位置：第 ${selection.line} 行起，共 ${textLength(selection.text)} 字`,
      '原文：',
      quoted(selection.text),
      `前文：${clipText(selection.before, 40, 'tail') || '（无）'}`,
      `后文：${clipText(selection.after, 40) || '（无）'}`,
    )
  }
  if (request.instruction) lines.push(`作者要求：${request.instruction}`)
  lines.push(
    INTENT_REQUIREMENT[request.intent],
    `请调用 novel_editor_suggest（requestId=${request.requestId}）把结果交回编辑器，由作者决定是否采用；不要直接改写文件，也不要把这次请求当作推进章节的授权。`,
    '[在书房打开原文](<' + studyFileLink(document.absolutePath) + '>)',
  )
  return lines.join('\n')
}

function copyReply(reply: EditorReply): EditorReply {
  if (reply.kind === 'comments') {
    return { kind: 'comments', comments: reply.comments.map(item => ({ quote: item.quote, note: item.note })), ...(reply.note === undefined ? {} : { note: reply.note }) }
  }
  if (reply.kind === 'none') return reply.note === undefined ? { kind: 'none' } : { kind: 'none', note: reply.note }
  return reply.note === undefined ? { kind: reply.kind, text: reply.text } : { kind: reply.kind, text: reply.text, note: reply.note }
}

/** In-memory editor requests, isolated per agent object. Nothing here is written to disk. */
export class EditorRequestHub {
  private readonly entries = new WeakMap<object, Map<string, Entry>>()
  private readonly cursors = new WeakMap<object, number>()

  constructor(private readonly now: () => number = Date.now) {}

  open(agent: EditorRequestAgent, snapshot: EditorRequestSnapshot): void {
    if (!EDITOR_REQUEST_ID.test(snapshot.requestId)) throw new EditorRequestError('请求编号必须是 6 到 16 位小写字母或数字')
    this.sync(agent)
    const map = this.map(agent)
    this.purge(map)
    if (map.has(snapshot.requestId)) throw new EditorRequestError('请求编号在本会话中已存在')
    if (this.pending(map) >= EDITOR_PENDING_LIMIT) throw new EditorRequestError('当前会话未决请求已达 8 条，请先取消或等待完成')
    this.evict(map)
    const now = this.now()
    map.set(snapshot.requestId, { snapshot, state: 'queued', createdAt: now, lastAccessAt: now })
  }

  drop(agent: object, requestId: string): void {
    this.entries.get(agent)?.delete(requestId)
  }

  cancel(agent: EditorRequestAgent, requestIds: readonly string[]): EditorRequestItem[] {
    this.sync(agent)
    const map = this.entries.get(agent)
    if (map) this.purge(map)
    const now = this.now()
    return requestIds.map(requestId => {
      const entry = map?.get(requestId)
      if (!entry) return { requestId, state: 'unknown' as const }
      if (entry.state === 'queued' || entry.state === 'working') {
        entry.state = 'cancelled'
        entry.closedAt = now
      }
      entry.lastAccessAt = now
      return { requestId, state: entry.state }
    })
  }

  view(agent: EditorRequestAgent, requestIds: readonly string[]): { busy: boolean; items: EditorRequestItem[] } {
    this.sync(agent)
    const map = this.entries.get(agent)
    if (map) this.purge(map)
    const now = this.now()
    return {
      busy: agent.status === 'running',
      items: requestIds.map(requestId => {
        const entry = map?.get(requestId)
        if (!entry) return { requestId, state: 'unknown' as const }
        entry.lastAccessAt = now
        return entry.state === 'replied' && entry.reply
          ? { requestId, state: entry.state, reply: copyReply(entry.reply) }
          : { requestId, state: entry.state }
      }),
    }
  }

  /**
   * A save that creates a new draft keeps every request for that agent and document on the new path.
   * Any state moves. Other agents and other documents stay where they are.
   */
  retarget(agent: EditorRequestAgent, from: FileRef, to: FileRef): void {
    if (from.space === to.space && from.path === to.path) return
    const map = this.entries.get(agent)
    if (!map) return
    for (const entry of map.values()) {
      const ref = entry.snapshot.ref
      if (ref.space !== from.space || ref.path !== from.path) continue
      const document = entry.snapshot.document
      entry.snapshot = {
        ...entry.snapshot,
        ref: { space: to.space, path: to.path },
        document: {
          ...document,
          space: to.space,
          path: to.path,
          absolutePath: movedAbsolutePath(document.absolutePath, from.path, to.path),
        },
      }
    }
  }

  /** Ids the author actually adopted: this agent, this document, a delivered replace or insert. */
  acceptedFor(agent: EditorRequestAgent, ids: readonly string[], ref: FileRef): string[] {
    this.sync(agent)
    const map = this.entries.get(agent)
    if (map) this.purge(map)
    const seen = new Set<string>()
    const accepted: string[] = []
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      const entry = map?.get(id)
      if (!entry || entry.state !== 'replied' || !entry.reply) continue
      if (entry.reply.kind !== 'replace' && entry.reply.kind !== 'insert') continue
      if (entry.snapshot.ref.space !== ref.space || entry.snapshot.ref.path !== ref.path) continue
      accepted.push(id)
    }
    return accepted
  }

  prepare(agent: EditorRequestAgent, requestId: string): { ok: true; intent: EditorIntent; text: string } | { ok: false; reason: string } {
    this.sync(agent)
    const map = this.entries.get(agent)
    if (map) this.purge(map)
    const entry = map?.get(requestId)
    if (!entry) return { ok: false, reason: EDITOR_UNKNOWN_REASON }
    if (entry.state === 'cancelled') return { ok: false, reason: EDITOR_CANCELLED_REASON }
    if (entry.state === 'replied') return { ok: false, reason: EDITOR_DUPLICATE_REASON }
    if (entry.state === 'unanswered') return { ok: false, reason: EDITOR_UNANSWERED_REASON }
    return { ok: true, intent: entry.snapshot.intent, text: entry.snapshot.selection.text }
  }

  reply(agent: EditorRequestAgent, requestId: string, reply: EditorReply): { ok: true } | { ok: false; reason: string } {
    const ready = this.prepare(agent, requestId)
    if (!ready.ok) return ready
    const entry = this.entries.get(agent)?.get(requestId)
    if (!entry || (entry.state !== 'queued' && entry.state !== 'working')) return { ok: false, reason: EDITOR_UNKNOWN_REASON }
    const now = this.now()
    entry.reply = copyReply(reply)
    entry.state = 'replied'
    entry.closedAt = now
    entry.lastAccessAt = now
    return { ok: true }
  }

  private map(agent: object): Map<string, Entry> {
    const existing = this.entries.get(agent)
    if (existing) return existing
    const created = new Map<string, Entry>()
    this.entries.set(agent, created)
    return created
  }

  private pending(map: Map<string, Entry>): number {
    let count = 0
    for (const entry of map.values()) if (entry.state === 'queued' || entry.state === 'working') count++
    return count
  }

  private purge(map: Map<string, Entry>): void {
    const now = this.now()
    for (const [id, entry] of map) {
      if (entry.closedAt !== undefined && now >= entry.closedAt + EDITOR_TTL_MS) map.delete(id)
    }
  }

  private evict(map: Map<string, Entry>): void {
    while (map.size >= EDITOR_ENTRY_LIMIT) {
      let oldestId: string | undefined
      let oldestAt = Number.POSITIVE_INFINITY
      for (const [id, entry] of map) {
        if (entry.closedAt === undefined || entry.closedAt >= oldestAt) continue
        oldestAt = entry.closedAt
        oldestId = id
      }
      if (oldestId === undefined) throw new EditorRequestError('当前会话保留的编辑器请求已达 64 条')
      map.delete(oldestId)
    }
  }

  private sync(agent: EditorRequestAgent): void {
    const session = agent.session
    const total = session?.seq
    const read = session?.eventAt
    if (!session || total === undefined || !read) return
    const map = this.entries.get(agent)
    if (!map) return
    let cursor = this.cursors.get(session) ?? 0
    if (cursor > total) cursor = 0
    for (; cursor < total; cursor++) {
      const event = read.call(session, cursor as SessionSeq)
      if (!event) continue
      if (event.type === 'user/message' && event.data.source.kind === EDITOR_REQUEST_SOURCE) {
        const entry = map.get(event.data.source.requestId)
        if (entry?.state === 'queued') entry.state = 'working'
      } else if (event.type === 'turn/end') {
        const now = this.now()
        for (const entry of map.values()) {
          if (entry.state !== 'working' || entry.reply !== undefined) continue
          entry.state = 'unanswered'
          entry.closedAt = now
          entry.lastAccessAt = now
        }
      }
    }
    this.cursors.set(session, cursor)
  }
}

function failure(requestId: string | undefined, reason: string): { ok: false; requestId?: string; reason: string } {
  return requestId === undefined ? { ok: false, reason } : { ok: false, requestId, reason }
}

function mismatch(intent: EditorIntent): string {
  if (intent === 'continue') return '续写只能回复 insert 或 none。'
  if (intent === 'review') return '审读只能回复 comments 或 none。'
  return '该意图只能回复 replace 或 none。'
}

function allows(intent: EditorIntent, kind: string): boolean {
  if (intent === 'continue') return kind === 'insert' || kind === 'none'
  if (intent === 'review') return kind === 'comments' || kind === 'none'
  return kind === 'replace' || kind === 'none'
}

function readNote(args: Record<string, unknown>): { ok: true; note?: string } | { ok: false; reason: string } {
  const note = args['note']
  if (note === undefined || note === '') return { ok: true }
  if (typeof note !== 'string') return { ok: false, reason: '给作者的说明必须是文字。' }
  if (textLength(note) > EDITOR_NOTE_LIMIT) return { ok: false, reason: '给作者的说明不超过 200 字。' }
  return { ok: true, note }
}

function buildReply(kind: string, args: Record<string, unknown>, intent: EditorIntent, original: string, note?: string): { ok: true; reply: EditorReply } | { ok: false; reason: string } {
  if (!allows(intent, kind)) return { ok: false, reason: mismatch(intent) }
  if (kind === 'none') return { ok: true, reply: note === undefined ? { kind: 'none' } : { kind: 'none', note } }
  if (kind === 'replace' || kind === 'insert') {
    const text = args['text']
    if (typeof text !== 'string' || textLength(text) === 0) {
      return { ok: false, reason: kind === 'replace' ? '替换文本不能为空；无需修改时请改用 none。' : '续写文本不能为空；无需续写时请改用 none。' }
    }
    if (kind === 'replace' && text === original) return { ok: true, reply: { kind: 'none', note: note ?? '与原文相同，无需改动。' } }
    if (kind === 'replace') {
      const limit = Math.min(textLength(original) * 4 + 2000, EDITOR_REPLACE_CAP)
      const size = textLength(text)
      if (size > limit) return { ok: false, reason: `替换文本过长（${size} 字，上限 ${limit} 字）。` }
      return { ok: true, reply: note === undefined ? { kind: 'replace', text } : { kind: 'replace', text, note } }
    }
    return { ok: true, reply: note === undefined ? { kind: 'insert', text } : { kind: 'insert', text, note } }
  }
  const value = args['comments']
  if (!Array.isArray(value) || value.length < 1 || value.length > EDITOR_COMMENT_LIMIT) return { ok: false, reason: '审读批注需要 1 到 12 条。' }
  const comments: { quote: string; note: string }[] = []
  for (let index = 0; index < value.length; index++) {
    const item = value[index]
    const record = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : undefined
    const quote = record?.['quote']
    const itemNote = record?.['note']
    const label = `第 ${index + 1} 条`
    if (typeof quote !== 'string' || textLength(quote) === 0 || typeof itemNote !== 'string') return { ok: false, reason: `${label}批注需要逐字引文和说明。` }
    if (!original.includes(quote)) return { ok: false, reason: `${label}引文必须逐字出现在请求原文里。` }
    if (textLength(itemNote) > EDITOR_COMMENT_NOTE_LIMIT) return { ok: false, reason: `${label}批注说明不超过 300 字。` }
    comments.push({ quote, note: itemNote })
  }
  return { ok: true, reply: note === undefined ? { kind: 'comments', comments } : { kind: 'comments', comments, note } }
}

export function acceptEditorSuggestion(hub: EditorRequestHub | undefined, agent: EditorRequestAgent | undefined, args: Record<string, unknown>): { ok: true; requestId: string; delivered: true; message: string } | { ok: false; requestId?: string; reason: string } {
  const requestId = typeof args['requestId'] === 'string' ? args['requestId'] : undefined
  if (!hub || !agent || requestId === undefined) return failure(requestId, EDITOR_UNKNOWN_REASON)
  const ready = hub.prepare(agent, requestId)
  if (!ready.ok) return failure(requestId, ready.reason)
  const kind = args['kind']
  if (kind !== 'replace' && kind !== 'insert' && kind !== 'comments' && kind !== 'none') {
    return failure(requestId, '回复类型必须是 replace、insert、comments 或 none。')
  }
  const note = readNote(args)
  if (!note.ok) return failure(requestId, note.reason)
  const built = buildReply(kind, args, ready.intent, ready.text, note.note)
  if (!built.ok) return failure(requestId, built.reason)
  const stored = hub.reply(agent, requestId, built.reply)
  if (!stored.ok) return failure(requestId, stored.reason)
  return { ok: true, requestId, delivered: true, message: EDITOR_DELIVERED_MESSAGE }
}
