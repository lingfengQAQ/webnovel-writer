import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'

class BulletWidget extends WidgetType {
  eq(other: WidgetType): boolean { return other instanceof BulletWidget }
  toDOM(): HTMLElement {
    const node = document.createElement('span')
    node.className = 'cm-lp-bullet'
    node.textContent = '•'
    return node
  }
}

class RuleWidget extends WidgetType {
  eq(other: WidgetType): boolean { return other instanceof RuleWidget }
  toDOM(): HTMLElement {
    const node = document.createElement('span')
    node.className = 'cm-lp-rule'
    node.setAttribute('aria-hidden', 'true')
    return node
  }
}

const hidden = Decoration.replace({})
const bullet = Decoration.replace({ widget: new BulletWidget() })
const rule = Decoration.replace({ widget: new RuleWidget() })
const lineClass = (name: string) => Decoration.line({ class: name })
const markClass = (name: string) => Decoration.mark({ class: name })
const INLINE_STYLE: Record<string, string> = {
  Emphasis: 'cm-lp-em', StrongEmphasis: 'cm-lp-strong', InlineCode: 'cm-lp-code', Strikethrough: 'cm-lp-strike', Link: 'cm-lp-link',
}
const INLINE_MARKS = new Set(['EmphasisMark', 'CodeMark', 'LinkMark', 'StrikethroughMark', 'URL'])
const FULLWIDTH_INDENT = /^[\u3000\s]/

interface Reveal { lines: Set<number>; ranges: readonly { from: number; to: number }[] }

/** Focus that survives the window losing focus, so marks stay while the author switches apps. */
export const editorFocused = (view: EditorView) => view.root.activeElement === view.contentDOM

function revealOf(view: EditorView): Reveal {
  if (!editorFocused(view)) return { lines: new Set(), ranges: [] }
  const { state } = view
  const lines = new Set<number>()
  for (const range of state.selection.ranges) lines.add(state.doc.lineAt(range.head).number)
  return { lines, ranges: state.selection.ranges }
}

const touches = (reveal: Reveal, from: number, to: number) => reveal.ranges.some(range => range.from <= to && range.to >= from)

/** Hide the mark plus one following space so `## 标题` reads as a heading. */
function markWithSpace(state: EditorState, to: number): number {
  return state.doc.sliceString(to, to + 1) === ' ' ? to + 1 : to
}

function build(view: EditorView): DecorationSet {
  const { state } = view
  const reveal = revealOf(view)
  const ranges: Range<Decoration>[] = []
  const lineOpen = (pos: number) => reveal.lines.has(state.doc.lineAt(pos).number)
  ensureSyntaxTree(state, view.viewport.to, 20)
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos)
      if (!line.text.trim()) ranges.push(lineClass('cm-lp-blank').range(line.from))
      pos = line.to + 1
    }
    syntaxTree(state).iterate({
      from, to,
      enter: node => {
        const name = node.name
        const headingLevel = /^ATXHeading(\d)$/.exec(name)?.[1]
        if (headingLevel) {
          ranges.push(lineClass('cm-lp-h' + headingLevel).range(state.doc.lineAt(node.from).from))
          return
        }
        if (name === 'HeaderMark') {
          const end = markWithSpace(state, node.to)
          if (node.from === state.doc.lineAt(node.from).from) ranges.push((lineOpen(node.from) ? markClass('cm-lp-mark') : hidden).range(node.from, end))
          else if (!lineOpen(node.from)) ranges.push(hidden.range(Math.max(state.doc.lineAt(node.from).from, node.from - 1), node.to))
          return
        }
        if (name === 'Blockquote') {
          for (let pos = node.from; pos <= node.to;) {
            const line = state.doc.lineAt(pos)
            ranges.push(lineClass('cm-lp-quote').range(line.from))
            pos = line.to + 1
          }
          return
        }
        if (name === 'QuoteMark') {
          ranges.push((lineOpen(node.from) ? markClass('cm-lp-mark') : hidden).range(node.from, markWithSpace(state, node.to)))
          return
        }
        if (name === 'ListItem') {
          ranges.push(lineClass('cm-lp-li').range(state.doc.lineAt(node.from).from))
          return
        }
        if (name === 'ListMark') {
          const ordered = node.node.parent?.parent?.name === 'OrderedList'
          if (lineOpen(node.from)) ranges.push(markClass('cm-lp-mark').range(node.from, node.to))
          else if (!ordered) ranges.push(bullet.range(node.from, node.to))
          else ranges.push(markClass('cm-lp-ol').range(node.from, node.to))
          return
        }
        if (name === 'HorizontalRule') {
          ranges.push(lineClass('cm-lp-hr').range(state.doc.lineAt(node.from).from))
          if (!lineOpen(node.from)) ranges.push(rule.range(node.from, node.to))
          return
        }
        if (name === 'Paragraph') {
          if (node.node.parent?.name !== 'Document') return
          for (let pos = node.from; pos <= node.to;) {
            const line = state.doc.lineAt(pos)
            ranges.push(lineClass(FULLWIDTH_INDENT.test(line.text) ? 'cm-lp-p cm-lp-p-manual' : 'cm-lp-p').range(line.from))
            pos = line.to + 1
          }
          return
        }
        const inline = INLINE_STYLE[name]
        if (inline) {
          if (node.to > node.from) ranges.push(markClass(inline).range(node.from, node.to))
          return
        }
        if (INLINE_MARKS.has(name)) {
          const parent = node.node.parent
          if (!parent || node.to <= node.from) return
          if (name === 'URL' && parent.name !== 'Link') return
          ranges.push((touches(reveal, parent.from, parent.to) ? markClass('cm-lp-mark') : hidden).range(node.from, node.to))
        }
      },
    })
  }
  return Decoration.set(ranges, true)
}

export const livePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = build(view) }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged
      || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = build(update.view)
  }
}, { decorations: plugin => plugin.decorations })

/** Ctrl/Cmd-click opens links through the study; a plain click keeps editing. */
export function linkClicks(open: (href: string) => void) {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos === null) return false
      let node = syntaxTree(view.state).resolveInner(pos, 1)
      while (node.parent && node.name !== 'Link') node = node.parent
      if (node.name !== 'Link') return false
      const url = node.getChild('URL')
      if (!url) return false
      open(view.state.sliceDoc(url.from, url.to))
      event.preventDefault()
      return true
    },
  })
}
