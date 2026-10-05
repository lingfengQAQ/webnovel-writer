import { EditorSelection, type ChangeSpec, type EditorState, type Range, type StateCommand } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { Decoration, type DecorationSet, type EditorView, WidgetType, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { readableDiff } from './diff'

export const LINE_PREFIX = /^(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/
export type LineKind = 'h1' | 'h2' | 'h3' | 'p' | 'quote' | 'list'
const PREFIX: Record<LineKind, string> = { h1: '# ', h2: '## ', h3: '### ', p: '', quote: '> ', list: '- ' }

export function toggleWrap(mark: string): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false
    const spec = state.changeByRange(range => {
      const text = state.sliceDoc(range.from, range.to)
      const before = state.sliceDoc(range.from - mark.length, range.from)
      const after = state.sliceDoc(range.to, range.to + mark.length)
      if (before === mark && after === mark) {
        return {
          changes: [{ from: range.from - mark.length, to: range.from }, { from: range.to, to: range.to + mark.length }],
          range: EditorSelection.range(range.from - mark.length, range.to - mark.length),
        }
      }
      if (text.length >= mark.length * 2 && text.startsWith(mark) && text.endsWith(mark)) {
        return {
          changes: { from: range.from, to: range.to, insert: text.slice(mark.length, -mark.length) },
          range: EditorSelection.range(range.from, range.to - mark.length * 2),
        }
      }
      return {
        changes: [{ from: range.from, insert: mark }, { from: range.to, insert: mark }],
        range: EditorSelection.range(range.from + mark.length, range.to + mark.length),
      }
    })
    dispatch(state.update(spec, { scrollIntoView: true, userEvent: 'input.format' }))
    return true
  }
}

export function setLineKind(kind: LineKind): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false
    const lines = new Map<number, { from: number; text: string }>()
    for (const range of state.selection.ranges) {
      for (let pos = range.from; pos <= range.to;) {
        const line = state.doc.lineAt(pos)
        lines.set(line.number, { from: line.from, text: line.text })
        pos = line.to + 1
      }
    }
    const all = [...lines.values()]
    const prefix = PREFIX[kind]
    const already = kind !== 'p' && all.every(line => line.text.startsWith(prefix) && (kind !== 'h1' || !line.text.startsWith('##')) && (kind !== 'h2' || !line.text.startsWith('###')))
    const changes: ChangeSpec[] = all.map(line => {
      const existing = LINE_PREFIX.exec(line.text)?.[0] ?? ''
      return { from: line.from, to: line.from + existing.length, insert: already ? '' : prefix }
    })
    dispatch(state.update({ changes, scrollIntoView: true, userEvent: 'input.format' }))
    return true
  }
}

export const insertRule: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false
  const line = state.doc.lineAt(state.selection.main.head)
  const block = line.text.trim().length > 0
  const insert = block ? '\n\n---\n' : '---'
  const from = block ? line.to : line.from
  dispatch(state.update({
    changes: { from, to: line.to, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true,
    userEvent: 'input.format',
  }))
  return true
}

/** Readable characters: CJK and letters, without Markdown marks or whitespace. */
export function countChars(text: string): number {
  return Array.from(text.replace(/^(#{1,6}\s+|>\s?|[-*+]\s+)/gm, '').replace(/[*_`~\s]/g, '')).length
}

export interface OutlineEntry { level: number; text: string; from: number }

export function outlineOf(state: EditorState): OutlineEntry[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state)
  const entries: OutlineEntry[] = []
  tree.iterate({
    enter(node) {
      const level = /^ATXHeading(\d)$/.exec(node.name)?.[1]
      if (!level) return
      entries.push({
        level: Number(level),
        text: state.sliceDoc(node.from, node.to).replace(/^#+\s*/, '').replace(/[*_`]/g, ''),
        from: node.from,
      })
      return false
    },
  })
  return entries
}

/** Shrink a whole-document replacement to the changed middle so history and caret survive. */
export function minimalChange(before: string, after: string): { from: number; to: number; insert: string } {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let end = 0
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) }
}

class DeletedText extends WidgetType {
  constructor(readonly text: string) { super() }
  eq(other: WidgetType): boolean { return other instanceof DeletedText && other.text === this.text }
  toDOM(): HTMLElement {
    const node = document.createElement('span')
    node.className = 'cm-chg-del'
    node.textContent = this.text
    return node
  }
}

/** Marks how `current` differs from `baseline` (saved body, or the disk body during a conflict). */
export function unsavedChanges(baseline: () => string) {
  const build = (view: EditorView): DecorationSet => {
    const ranges: Range<Decoration>[] = []
    let pos = 0
    for (const part of readableDiff(baseline(), view.state.doc.toString())) {
      if (part.type === 'equal') pos += part.text.length
      else if (part.type === 'ins') {
        if (part.text.trim()) ranges.push(Decoration.mark({ class: 'cm-chg-ins' }).range(pos, pos + part.text.length))
        pos += part.text.length
      } else if (part.text.trim()) ranges.push(Decoration.widget({ widget: new DeletedText(part.text), side: -1 }).range(pos))
    }
    return Decoration.set(ranges, true)
  }
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = build(view) }
    update(update: ViewUpdate) { if (update.docChanged) this.decorations = build(update.view) }
  }, { decorations: plugin => plugin.decorations })
}
