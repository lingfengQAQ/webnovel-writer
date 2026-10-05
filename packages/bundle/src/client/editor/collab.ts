import { type ChangeDesc, type EditorState, type Extension, type Range, StateEffect, StateField, type Transaction, type TransactionSpec } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { invertedEffects, isolateHistory } from '@codemirror/commands'
import type { EditorIntent, EditorReply } from '../../study/editor-requests'
import { LINE_PREFIX } from './commands'
import { readableDiff } from './diff'

export type Intent = EditorIntent
export const INTENT_LABEL: Record<Intent, string> = {
  polish: '润色', expand: '扩写', condense: '精简', review: '审读', continue: '续写', custom: '按要求改',
}

const WRITE_INTENTS: readonly Intent[] = ['polish', 'expand', 'condense', 'continue', 'custom']
export const isWriteIntent = (intent: Intent) => WRITE_INTENTS.includes(intent)

interface Anchored { id: string; from: number; to: number }
export interface PendingItem extends Anchored { kind: 'pending'; intent: Intent; original: string; status: 'sending' | 'queued' | 'working'; touched: boolean }
export interface SuggestionItem extends Anchored { kind: 'suggestion'; intent: Intent; original: string; text: string; note?: string; touched: boolean; confirm?: boolean }
export interface GhostItem extends Anchored { kind: 'ghost'; intent: Intent; text: string; note?: string }
export interface CommentItem extends Anchored { kind: 'comment'; requestId: string; note: string; index: number }
export type CollabItem = PendingItem | SuggestionItem | GhostItem | CommentItem

export interface EditorSurface {
  readonly state: EditorState
  dispatch(spec: Transaction | TransactionSpec): void
}

const CONTEXT_LIMIT = 400
const SELECTION_LIMIT = 8000
const textLength = (text: string) => Array.from(text).length
const head = (text: string, limit: number) => {
  const units = Array.from(text)
  return units.length <= limit ? text : units.slice(0, limit).join('')
}
const tail = (text: string, limit: number) => {
  const units = Array.from(text)
  return units.length <= limit ? text : units.slice(-limit).join('')
}

function mapItem<T extends CollabItem>(item: T, changes: ChangeDesc): T {
  const from = changes.mapPos(item.from, item.from === item.to ? -1 : 1)
  const to = item.from === item.to ? from : Math.max(from, changes.mapPos(item.to, -1))
  return { ...item, from, to }
}

export const addItems = StateEffect.define<readonly CollabItem[]>({ map: (items, changes) => items.map(item => mapItem(item, changes)) })
export const removeItems = StateEffect.define<readonly string[]>()
export const patchItem = StateEffect.define<{ id: string; patch: { status?: PendingItem['status']; touched?: boolean; confirm?: boolean } }>()
export const restoreItem = StateEffect.define<CollabItem>({ map: (item, changes) => mapItem(item, changes) })
export const noteAdopted = StateEffect.define<string>()
export const forgetAdopted = StateEffect.define<string>()

/** A change strictly inside an anchored range means the author rewrote what the Agent is working on. */
function editedInside(changes: ChangeDesc, from: number, to: number): boolean {
  let inside = false
  changes.iterChangedRanges((changeFrom, changeTo) => {
    if (changeFrom < to && changeTo > from) inside = true
    else if (changeFrom === changeTo && changeFrom > from && changeFrom < to) inside = true
  })
  return inside
}

export const collabField = StateField.define<readonly CollabItem[]>({
  create: () => [],
  update(items, tr) {
    let next = items
    if (tr.docChanged) {
      const moved: CollabItem[] = []
      for (const item of items) {
        if (item.kind === 'ghost' && editedInside(tr.changes, item.from - 1, item.to + 1)) continue
        const mapped = mapItem(item, tr.changes)
        if (item.kind === 'comment' && mapped.from === mapped.to) continue
        if ((item.kind === 'pending' || item.kind === 'suggestion') && !item.touched && editedInside(tr.changes, item.from, item.to)) {
          moved.push({ ...mapped, touched: true } as CollabItem)
        } else moved.push(mapped)
      }
      next = moved
    }
    for (const effect of tr.effects) {
      if (effect.is(addItems)) next = [...next.filter(item => !effect.value.some(added => added.id === item.id)), ...effect.value]
      else if (effect.is(restoreItem)) next = [...next.filter(item => item.id !== effect.value.id), effect.value]
      else if (effect.is(removeItems)) next = next.filter(item => !effect.value.includes(item.id))
      else if (effect.is(patchItem)) next = next.map(item => item.id === effect.value.id ? { ...item, ...effect.value.patch } as CollabItem : item)
    }
    return next
  },
  provide: field => EditorView.decorations.compute([field], state => decorate(state.field(field), state)),
})

/** Ids accepted in the buffer and not yet undone. A successful save records them separately so the next save does not repeat them. */
export const adoptedField = StateField.define<readonly string[]>({
  create: () => [],
  update(ids, tr) {
    let next = ids
    for (const effect of tr.effects) {
      if (effect.is(noteAdopted)) {
        if (!next.includes(effect.value)) next = [...next, effect.value]
      } else if (effect.is(forgetAdopted)) {
        if (next.includes(effect.value)) next = next.filter(id => id !== effect.value)
      }
    }
    return next
  },
})

/** Undoing an accept (or a dismissal) brings the suggestion back; redo removes it again. */
export const collabHistory = invertedEffects.of(tr => {
  const inverted: StateEffect<unknown>[] = []
  for (const effect of tr.effects) {
    if (effect.is(noteAdopted)) inverted.push(forgetAdopted.of(effect.value))
    if (effect.is(forgetAdopted)) inverted.push(noteAdopted.of(effect.value))
    if (effect.is(restoreItem)) inverted.push(removeItems.of([effect.value.id]))
    if (!effect.is(removeItems)) continue
    for (const id of effect.value) {
      const item = tr.startState.field(collabField, false)?.find(candidate => candidate.id === id)
      if (item && item.kind !== 'pending') inverted.push(restoreItem.of(item))
    }
  }
  return inverted
})

export const collab: Extension = [collabField, adoptedField, collabHistory]

export function suggestionMode(item: SuggestionItem, current: string): 'inline' | 'block' {
  if (item.touched || current !== item.original) return 'block'
  if (item.original.includes('\n') || item.text.includes('\n')) return 'block'
  const parts = readableDiff(item.original, item.text)
  const changed = parts.filter(part => part.type !== 'equal').reduce((sum, part) => sum + part.text.length, 0)
  return changed / Math.max(1, item.original.length + item.text.length) > 0.55 ? 'block' : 'inline'
}

function iconSvg(name: keyof typeof ICONS): string {
  return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`
}
const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  retry: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  spark: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
}

function actionButton(id: string, action: string, icon: keyof typeof ICONS, tip: string, extra = ''): string {
  const label = tip.split(' · ')[0] ?? tip
  return `<button type="button" class="cm-collab-btn ${extra}" data-collab-id="${id}" data-collab-action="${action}" aria-label="${label}" data-tip="${tip}">${iconSvg(icon)}</button>`
}

function actionsHtml(item: SuggestionItem | GhostItem): string {
  const confirm = item.kind === 'suggestion' && item.touched
  const accept = confirm && item.confirm
    ? actionButton(item.id, 'accept', 'check', '确认替换：会覆盖你在这段里的改动', 'is-accept is-danger')
    : confirm
      ? actionButton(item.id, 'accept', 'warn', '原文已被你改动，点一次查看提示，再点确认替换', 'is-warn')
      : actionButton(item.id, 'accept', 'check', '接受 · Tab', 'is-accept')
  return accept + actionButton(item.id, 'reject', 'x', '拒绝 · Esc') + actionButton(item.id, 'retry', 'retry', '换一版') + actionButton(item.id, 'reveal', 'chat', '在对话中查看')
}

class InsertionWidget extends WidgetType {
  constructor(readonly text: string, readonly className: string) { super() }
  eq(other: WidgetType): boolean { return other instanceof InsertionWidget && other.text === this.text && other.className === this.className }
  toDOM(): HTMLElement {
    const node = document.createElement('span')
    node.className = this.className
    const [first, ...paragraphs] = this.text.split(/\n+/)
    node.append(first ?? '')
    for (const paragraph of paragraphs) {
      const block = document.createElement('span')
      block.className = 'cm-ghost-p'
      block.textContent = paragraph
      node.append(block)
    }
    return node
  }
}

class ActionsWidget extends WidgetType {
  constructor(readonly item: SuggestionItem | GhostItem) { super() }
  eq(other: WidgetType): boolean {
    return other instanceof ActionsWidget && other.item.id === this.item.id
      && (other.item as SuggestionItem).confirm === (this.item as SuggestionItem).confirm
      && (other.item as SuggestionItem).touched === (this.item as SuggestionItem).touched
  }
  toDOM(): HTMLElement {
    const node = document.createElement('span')
    node.className = 'cm-collab-actions'
    node.setAttribute('role', 'group')
    node.setAttribute('aria-label', '主 Agent 建议')
    node.innerHTML = actionsHtml(this.item)
    return node
  }
  ignoreEvent(): boolean { return true }
}

class BlockSuggestionWidget extends WidgetType {
  constructor(readonly item: SuggestionItem) { super() }
  eq(other: WidgetType): boolean {
    return other instanceof BlockSuggestionWidget && other.item.id === this.item.id && other.item.text === this.item.text
      && other.item.confirm === this.item.confirm && other.item.touched === this.item.touched
  }
  toDOM(): HTMLElement {
    const node = document.createElement('div')
    node.className = 'cm-sg-block' + (this.item.touched ? ' is-touched' : '')
    node.dataset.collabId = this.item.id
    const body = document.createElement('div')
    body.className = 'cm-sg-block-text'
    for (const paragraph of this.item.text.split(/\n+/)) {
      const paragraphNode = document.createElement('p')
      paragraphNode.textContent = paragraph
      body.append(paragraphNode)
    }
    const footer = document.createElement('div')
    footer.className = 'cm-sg-block-footer'
    const note = document.createElement('span')
    note.className = 'cm-sg-note'
    note.innerHTML = iconSvg('spark')
    note.append(this.item.touched ? '你改动过这段原文，建议基于改动前的文字' : this.item.note ?? INTENT_LABEL[this.item.intent])
    const actions = document.createElement('span')
    actions.className = 'cm-collab-actions'
    actions.innerHTML = actionsHtml(this.item)
    footer.append(note, actions)
    node.append(body, footer)
    return node
  }
  ignoreEvent(): boolean { return true }
}

class PendingWidget extends WidgetType {
  constructor(readonly item: PendingItem) { super() }
  eq(other: WidgetType): boolean {
    return other instanceof PendingWidget && other.item.id === this.item.id && other.item.status === this.item.status && other.item.touched === this.item.touched
  }
  toDOM(): HTMLElement {
    const node = document.createElement('span')
    node.className = 'cm-collab-pending-chip is-' + this.item.status
    const label = INTENT_LABEL[this.item.intent]
    const statusLabel = this.item.status === 'queued' ? '排队中' : this.item.status === 'sending' ? '正在发送' : '处理中'
    const tip = this.item.status === 'queued' ? `排队中：主 Agent 处理完上一条后就会${label}` : this.item.status === 'sending' ? '正在交给主 Agent' : `主 Agent 正在${label}`
    node.setAttribute('role', 'status')
    node.setAttribute('aria-label', statusLabel)
    node.innerHTML = `<span class="cm-collab-spinner" data-tip="${tip}${this.item.touched ? ' · 这段原文已被你改动' : ''}">${iconSvg('loader')}</span>` + actionButton(this.item.id, 'cancel', 'x', '取消这次请求', 'cm-collab-cancel')
    return node
  }
  ignoreEvent(): boolean { return true }
}

class CommentMarker extends WidgetType {
  constructor(readonly item: CommentItem) { super() }
  eq(other: WidgetType): boolean { return other instanceof CommentMarker && other.item.id === this.item.id && other.item.index === this.item.index }
  toDOM(): HTMLElement {
    const node = document.createElement('button')
    node.type = 'button'
    node.className = 'cm-note-marker'
    node.dataset.collabId = this.item.id
    node.dataset.collabAction = 'comment-open'
    node.setAttribute('aria-label', '查看审读批注 ' + this.item.index)
    node.dataset.tip = '审读批注 · 点击查看'
    node.textContent = String(this.item.index)
    return node
  }
  ignoreEvent(): boolean { return true }
}

function decorate(items: readonly CollabItem[], state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = []
  for (const item of items) {
    if (item.kind === 'pending') {
      if (item.to > item.from) ranges.push(Decoration.mark({ class: 'cm-collab-pending' }).range(item.from, item.to))
      ranges.push(Decoration.widget({ widget: new PendingWidget(item), side: 1 }).range(item.to))
    } else if (item.kind === 'suggestion') {
      const current = state.sliceDoc(item.from, item.to)
      if (suggestionMode(item, current) === 'inline') {
        let pos = item.from
        for (const part of readableDiff(item.original, item.text)) {
          if (part.type === 'equal') pos += part.text.length
          else if (part.type === 'del') {
            ranges.push(Decoration.mark({ class: 'cm-sg-del' }).range(pos, pos + part.text.length))
            pos += part.text.length
          } else ranges.push(Decoration.widget({ widget: new InsertionWidget(part.text, 'cm-sg-ins'), side: 1 }).range(pos))
        }
        ranges.push(Decoration.widget({ widget: new ActionsWidget(item), side: 2 }).range(item.to))
      } else {
        if (item.to > item.from) ranges.push(Decoration.mark({ class: 'cm-sg-old' }).range(item.from, item.to))
        ranges.push(Decoration.widget({ widget: new BlockSuggestionWidget(item), block: true, side: 1 }).range(state.doc.lineAt(item.to).to))
      }
    } else if (item.kind === 'ghost') {
      ranges.push(Decoration.widget({ widget: new InsertionWidget(item.text, 'cm-ghost'), side: 1 }).range(item.from))
      ranges.push(Decoration.widget({ widget: new ActionsWidget(item), side: 2 }).range(item.from))
    } else {
      if (item.to > item.from) ranges.push(Decoration.mark({ class: 'cm-note-range', attributes: { 'data-collab-id': item.id } }).range(item.from, item.to))
      ranges.push(Decoration.widget({ widget: new CommentMarker(item), side: 1 }).range(item.to))
    }
  }
  return Decoration.set(ranges, true)
}

export const findItem = (state: EditorState, id: string) => state.field(collabField, false)?.find(item => item.id === id)

export function requestBlocked(state: EditorState, from: number, to: number): boolean {
  return state.field(collabField, false)?.some(item => {
    if (item.kind !== 'pending' && item.kind !== 'suggestion' && item.kind !== 'ghost') return false
    if (from === to && item.from === item.to) return item.from === from
    return item.from < Math.max(to, from + 1) && item.to > from
  }) ?? false
}

export type AskTarget = { ok: true; from: number; to: number; text: string; line: number; before: string; after: string } | { ok: false; message: string }

/** Selection, current paragraph, or continue-at-caret. Rejects an empty write target, an overlong selection, and a range that already has a request. */
export function resolveAsk(state: EditorState, intent: Intent, range?: { from: number; to: number }): AskTarget {
  let from = range?.from ?? state.selection.main.from
  let to = range?.to ?? state.selection.main.to
  if (intent === 'continue') {
    const at = !range && from === to ? state.doc.lineAt(to).to : to
    from = at
    to = at
  } else if (from === to) {
    const line = state.doc.lineAt(from)
    if (!line.text.trim()) return { ok: false, message: '先选中文字，或把光标放进一段正文' }
    const prefix = LINE_PREFIX.exec(line.text)?.[0].length ?? 0
    from = line.from + prefix
    to = line.to
  }
  const text = state.sliceDoc(from, to)
  if (intent !== 'continue' && !text.trim()) return { ok: false, message: '先选中文字，或把光标放进一段正文' }
  if (textLength(text) > SELECTION_LIMIT) return { ok: false, message: '选区超过 8000 字，请缩短后再交给主 Agent' }
  if (requestBlocked(state, from, to)) return { ok: false, message: '这段已经有一条在处理的请求' }
  return {
    ok: true, from, to, text, line: state.doc.lineAt(from).number,
    before: tail(state.sliceDoc(0, from), CONTEXT_LIMIT),
    after: head(state.sliceDoc(to, state.doc.length), CONTEXT_LIMIT),
  }
}

export function acceptItem(id: string): (target: { state: EditorState; dispatch: (transaction: Transaction) => void }) => boolean {
  return ({ state, dispatch }) => {
    const item = findItem(state, id)
    if (!item || (item.kind !== 'suggestion' && item.kind !== 'ghost')) return false
    if (item.kind === 'suggestion' && item.touched && !item.confirm) {
      dispatch(state.update({ effects: patchItem.of({ id, patch: { confirm: true } }) }))
      return false
    }
    const insert = item.text
    dispatch(state.update({
      changes: { from: item.from, to: item.to, insert },
      selection: { anchor: item.from + insert.length },
      effects: [removeItems.of([id]), noteAdopted.of(id)],
      annotations: isolateHistory.of('full'),
      userEvent: 'input.agent',
      scrollIntoView: true,
    }))
    return true
  }
}

export function dismissItem(id: string): (target: { state: EditorState; dispatch: (transaction: Transaction) => void }) => boolean {
  return ({ state, dispatch }) => {
    if (!findItem(state, id)) return false
    dispatch(state.update({ effects: removeItems.of([id]), annotations: isolateHistory.of('full') }))
    return true
  }
}

/** The suggestion nearest the caret is the one Tab and Esc act on. */
export function focusedItem(state: EditorState): SuggestionItem | GhostItem | undefined {
  const items = state.field(collabField, false)
  if (!items) return undefined
  const headPos = state.selection.main.head
  let best: SuggestionItem | GhostItem | undefined
  let distance = Infinity
  for (const item of items) {
    if (item.kind !== 'suggestion' && item.kind !== 'ghost') continue
    const gap = headPos < item.from ? item.from - headPos : headPos > item.to ? headPos - item.to : 0
    if (gap < distance) { best = item; distance = gap }
  }
  return distance <= 400 ? best : undefined
}

export interface ReplyPlan {
  status: 'applied' | 'none' | 'expired'
  message?: string
  effects: readonly StateEffect<unknown>[]
}

export function planReply(state: EditorState, requestId: string, reply: EditorReply): ReplyPlan {
  const item = findItem(state, requestId)
  if (!item || item.kind !== 'pending') return { status: 'expired', effects: [] }
  if (reply.kind === 'none') {
    return { status: 'none', message: reply.note || '主 Agent 认为无需改动', effects: [removeItems.of([requestId])] }
  }
  if (reply.kind === 'replace') {
    const suggestion: SuggestionItem = {
      kind: 'suggestion', id: item.id, intent: item.intent, from: item.from, to: item.to,
      original: item.original, text: reply.text, touched: item.touched, ...(reply.note ? { note: reply.note } : {}),
    }
    return { status: 'applied', effects: [addItems.of([suggestion])] }
  }
  if (reply.kind === 'insert') {
    const ghost: GhostItem = {
      kind: 'ghost', id: item.id, intent: item.intent, from: item.to, to: item.to, text: reply.text,
      ...(reply.note ? { note: reply.note } : {}),
    }
    return { status: 'applied', effects: [addItems.of([ghost])] }
  }
  const text = state.sliceDoc(item.from, item.to)
  let index = 0
  for (const existing of state.field(collabField)) if (existing.kind === 'comment') index = Math.max(index, existing.index)
  const notes: CommentItem[] = []
  reply.comments.forEach((entry, offset) => {
    if (!entry.quote) return
    const at = text.indexOf(entry.quote)
    if (at < 0) return
    index += 1
    notes.push({
      kind: 'comment', id: item.id + '-' + offset, requestId: item.id,
      from: item.from + at, to: item.from + at + entry.quote.length, note: entry.note, index,
    })
  })
  if (!notes.length) {
    return { status: 'none', message: reply.note || '审读完成，没有需要标注的地方', effects: [removeItems.of([requestId])] }
  }
  return { status: 'applied', effects: [removeItems.of([requestId]), addItems.of(notes)] }
}

export function planStatus(state: EditorState, id: string, status: PendingItem['status']): StateEffect<unknown> | undefined {
  const item = findItem(state, id)
  if (!item || item.kind !== 'pending' || item.status === status) return undefined
  return patchItem.of({ id, patch: { status } })
}

/** Pending items whose whole range was deleted. Point items (续写) are left alone. */
export function collapsedPending(tr: Transaction): string[] {
  if (!tr.docChanged) return []
  const before = tr.startState.field(collabField, false) ?? []
  const after = tr.state.field(collabField, false) ?? []
  const ids: string[] = []
  for (const item of before) {
    if (item.kind !== 'pending' || item.from === item.to) continue
    const mapped = after.find(next => next.id === item.id && next.kind === 'pending')
    if (mapped && mapped.from === mapped.to) ids.push(item.id)
  }
  return ids
}

/** Ghosts removed because the author edited next to the insertion point, not because they were dismissed. */
export function expiredGhosts(tr: Transaction): string[] {
  if (!tr.docChanged) return []
  const removed = new Set<string>()
  for (const effect of tr.effects) if (effect.is(removeItems)) for (const id of effect.value) removed.add(id)
  const after = tr.state.field(collabField, false) ?? []
  const ids: string[] = []
  for (const item of tr.startState.field(collabField, false) ?? []) {
    if (item.kind !== 'ghost' || removed.has(item.id)) continue
    if (!after.some(next => next.id === item.id)) ids.push(item.id)
  }
  return ids
}
