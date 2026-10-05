import { diffArrays } from 'diff/lib/index.js'

export interface DiffPart { type: 'equal' | 'del' | 'ins'; text: string }

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter('zh-CN', { granularity: 'word' })
  : null

const tokens = (text: string): string[] => segmenter
  ? Array.from(segmenter.segment(text), part => part.segment)
  : Array.from(text)

/** Word-level diff. Shared runs of two characters or fewer between edits are folded into the change. */
export function readableDiff(before: string, after: string): DiffPart[] {
  const raw: DiffPart[] = diffArrays(tokens(before), tokens(after)).map(change => ({
    type: change.added ? 'ins' : change.removed ? 'del' : 'equal',
    text: change.value.join(''),
  }))
  const folded: DiffPart[] = []
  raw.forEach((part, index) => {
    const between = part.type === 'equal' && Array.from(part.text).length <= 2 && index > 0 && index < raw.length - 1
    if (between) {
      folded.push({ type: 'del', text: part.text }, { type: 'ins', text: part.text })
      return
    }
    folded.push(part)
  })
  const merged: DiffPart[] = []
  let del = ''
  let ins = ''
  const flush = () => {
    if (del) merged.push({ type: 'del', text: del })
    if (ins) merged.push({ type: 'ins', text: ins })
    del = ''
    ins = ''
  }
  for (const part of folded) {
    if (part.type === 'del') del += part.text
    else if (part.type === 'ins') ins += part.text
    else { flush(); merged.push(part) }
  }
  flush()
  return merged
}
