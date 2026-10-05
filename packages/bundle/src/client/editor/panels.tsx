import * as React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { SearchQuery, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, setSearchQuery } from '@codemirror/search'
import {
  AArrowDown, AArrowUp, CaseSensitive, ChevronDown, ChevronUp, FoldHorizontal, IndentIncrease, Minus, Plus, RectangleHorizontal,
  Replace, ReplaceAll, Rows3, Search, UnfoldHorizontal, X,
} from 'lucide-react'
import type { OutlineEntry } from './commands'

export interface Typography { font: 'serif' | 'sans'; size: number; leading: number; measure: 'narrow' | 'medium' | 'full'; indent: boolean }
export const DEFAULT_TYPOGRAPHY: Typography = { font: 'serif', size: 17, leading: 1.9, measure: 'medium', indent: true }
export const TYPE_LIMITS = { sizeMin: 14, sizeMax: 22, leadingMin: 1.6, leadingMax: 2.2 }

function IconButton({ tip, onClick, children, pressed, disabled, className }: {
  tip: string; onClick: () => void; children: React.ReactNode; pressed?: boolean; disabled?: boolean; className?: string
}) {
  return <button type="button" className={'ed-icon' + (className ? ' ' + className : '')} aria-label={tip.split(' · ')[0]} data-tip={tip} aria-pressed={pressed} disabled={disabled}
    onMouseDown={event => event.preventDefault()} onClick={onClick}>{children}</button>
}

function matchInfo(view: EditorView): { index: number; total: number } {
  const query = getSearchQuery(view.state)
  if (!query.valid) return { index: 0, total: 0 }
  const cursor = query.getCursor(view.state)
  const { from, to } = view.state.selection.main
  let total = 0, index = 0
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    total++
    if (next.value.from === from && next.value.to === to) index = total
    if (total > 999) break
  }
  return { index, total }
}

export function FindPanel({ view, replace, tick, writable, onClose }: {
  view: EditorView; replace: boolean; tick: number; writable: boolean; onClose: () => void
}) {
  const [search, setSearch] = useState(() => getSearchQuery(view.state).search || view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to).split('\n')[0] || '')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [showReplace, setShowReplace] = useState(replace && writable)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (writable) setShowReplace(value => value || replace) }, [replace, writable])
  useEffect(() => { input.current?.focus(); input.current?.select() }, [])
  useEffect(() => {
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search, replace: replacement, caseSensitive, literal: true })) })
  }, [view, search, replacement, caseSensitive])
  const info = search ? matchInfo(view) : { index: 0, total: 0 }
  void tick
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    else if (event.key === 'Enter') { event.preventDefault(); (event.shiftKey ? findPrevious : findNext)(view) }
  }
  return <div className="ed-float ed-find" role="search" aria-label="查找替换">
    <div className="ed-find-row">
      <Search size={15} className="ed-find-lead" aria-hidden="true" />
      <input ref={input} value={search} placeholder="查找" aria-label="查找内容" onChange={event => setSearch(event.target.value)} onKeyDown={keys} />
      <span className="ed-find-count" aria-live="polite">{search ? info.total ? `${info.index || '–'}/${info.total}` : '无结果' : ''}</span>
      <IconButton tip="区分大小写" pressed={caseSensitive} onClick={() => setCaseSensitive(value => !value)}><CaseSensitive size={16} /></IconButton>
      <IconButton tip="上一个 · Shift Enter" disabled={!info.total} onClick={() => findPrevious(view)}><ChevronUp size={16} /></IconButton>
      <IconButton tip="下一个 · Enter" disabled={!info.total} onClick={() => findNext(view)}><ChevronDown size={16} /></IconButton>
      <IconButton tip="替换 · Ctrl H" pressed={showReplace} disabled={!writable} onClick={() => setShowReplace(value => !value)}><Replace size={16} /></IconButton>
      <IconButton tip="关闭 · Esc" onClick={onClose}><X size={16} /></IconButton>
    </div>
    {showReplace && writable && <div className="ed-find-row">
      <Replace size={15} className="ed-find-lead" aria-hidden="true" />
      <input value={replacement} placeholder="替换为" aria-label="替换为" onChange={event => setReplacement(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose() } else if (event.key === 'Enter') { event.preventDefault(); replaceNext(view) } }} />
      <IconButton tip="替换当前" disabled={!info.total} onClick={() => replaceNext(view)}><Replace size={16} /></IconButton>
      <IconButton tip="全部替换" disabled={!info.total} onClick={() => replaceAll(view)}><ReplaceAll size={16} /></IconButton>
    </div>}
  </div>
}

export function TypePanel({ value, onChange, onClose }: { value: Typography; onChange: (patch: Partial<Typography>) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }) }, [])
  const set = onChange
  return <div ref={ref} className="ed-float ed-type" role="dialog" aria-label="排版" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }}>
    <div className="ed-type-row" role="group" aria-label="字体">
      <button type="button" className="ed-font-sample is-serif" aria-label="宋体" data-tip="宋体" aria-pressed={value.font === 'serif'} onClick={() => set({ font: 'serif' })}>文</button>
      <button type="button" className="ed-font-sample is-sans" aria-label="黑体" data-tip="黑体" aria-pressed={value.font === 'sans'} onClick={() => set({ font: 'sans' })}>文</button>
      <span className="ed-type-gap" />
      <IconButton tip="首行缩进两字" pressed={value.indent} onClick={() => set({ indent: !value.indent })}><IndentIncrease size={16} /></IconButton>
      <IconButton tip="关闭 · Esc" onClick={onClose}><X size={16} /></IconButton>
    </div>
    <div className="ed-type-row" role="group" aria-label="字号">
      <IconButton tip="缩小字号" disabled={value.size <= TYPE_LIMITS.sizeMin} onClick={() => set({ size: value.size - 1 })}><AArrowDown size={16} /></IconButton>
      <span className="ed-type-value" aria-label={'字号 ' + value.size}>{value.size}</span>
      <IconButton tip="放大字号" disabled={value.size >= TYPE_LIMITS.sizeMax} onClick={() => set({ size: value.size + 1 })}><AArrowUp size={16} /></IconButton>
      <span className="ed-type-gap" />
      <Rows3 size={15} className="ed-type-lead" aria-hidden="true" />
      <IconButton tip="收紧行距" disabled={value.leading <= TYPE_LIMITS.leadingMin} onClick={() => set({ leading: Math.round((value.leading - 0.1) * 10) / 10 })}><Minus size={15} /></IconButton>
      <span className="ed-type-value" aria-label={'行距 ' + value.leading}>{value.leading.toFixed(1)}</span>
      <IconButton tip="放宽行距" disabled={value.leading >= TYPE_LIMITS.leadingMax} onClick={() => set({ leading: Math.round((value.leading + 0.1) * 10) / 10 })}><Plus size={15} /></IconButton>
    </div>
    <div className="ed-type-row" role="group" aria-label="版心宽度">
      <IconButton tip="窄版心" pressed={value.measure === 'narrow'} onClick={() => set({ measure: 'narrow' })}><FoldHorizontal size={16} /></IconButton>
      <IconButton tip="标准版心" pressed={value.measure === 'medium'} onClick={() => set({ measure: 'medium' })}><RectangleHorizontal size={16} /></IconButton>
      <IconButton tip="铺满侧栏" pressed={value.measure === 'full'} onClick={() => set({ measure: 'full' })}><UnfoldHorizontal size={16} /></IconButton>
    </div>
  </div>
}

export function OutlinePanel({ entries, current, onPick, onClose }: { entries: OutlineEntry[]; current: number; onPick: (entry: OutlineEntry) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { ref.current?.querySelector<HTMLButtonElement>('.is-current, button')?.focus({ preventScroll: true }) }, [])
  const keys = (event: React.KeyboardEvent) => {
    const list = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('.ed-outline-item') ?? [])
    const index = list.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    else if (event.key === 'ArrowDown' && list.length) { event.preventDefault(); list[(index + 1) % list.length]?.focus() }
    else if (event.key === 'ArrowUp' && list.length) { event.preventDefault(); list[(index - 1 + list.length) % list.length]?.focus() }
  }
  return <div ref={ref} className="ed-float ed-outline" role="dialog" aria-label="大纲" onKeyDown={keys}>
    {entries.length ? entries.map((entry, index) => <button key={entry.from} type="button" className={'ed-outline-item level-' + entry.level + (index === current ? ' is-current' : '')}
      onClick={() => onPick(entry)}>{entry.text || '无题'}</button>) : <p className="ed-outline-empty">这份文档没有标题</p>}
  </div>
}
