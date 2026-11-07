import * as React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ShortcutKeys } from '@deepseek-ai/dsh-client-ui-primitives'

interface Tip { text: string; shortcut?: string; x: number; y: number; below: boolean }

/**
 * Hints for the CodeMirror widget buttons (`[data-tip]` in collab.ts). Those are plain DOM built inside the
 * editor view, so they cannot host a React anchor for the DSH Tooltip that every React control uses; this
 * layer paints the same bubble material and DSH keycaps for them.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    let current: HTMLElement | null = null
    const show = (target: HTMLElement) => {
      const raw = target.dataset.tip
      if (!raw) return
      const [text, shortcut] = raw.split(' · ')
      if (!text) return
      const rect = target.getBoundingClientRect()
      const below = rect.top < 44
      setTip({ text, shortcut, x: rect.left + rect.width / 2, y: below ? rect.bottom + 8 : rect.top - 8, below })
    }
    const over = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.cm-editor [data-tip]') : null
      if (target === current) return
      current = target
      window.clearTimeout(timer.current)
      if (!target) { setTip(null); return }
      // The DSH hover delay; keyboard focus shows at once, as DSH tooltips do.
      timer.current = window.setTimeout(() => { if (current === target && target.isConnected) show(target) }, event.type === 'focusin' ? 0 : 500)
    }
    const hide = () => { current = null; window.clearTimeout(timer.current); setTip(null) }
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') hide() }
    document.addEventListener('pointerover', over)
    document.addEventListener('focusin', over)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('keydown', keydown)
    window.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('pointerover', over)
      document.removeEventListener('focusin', over)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('keydown', keydown)
      window.removeEventListener('scroll', hide, true)
    }
  }, [])
  const ref = useRef<HTMLDivElement>(null)
  const [shift, setShift] = useState(0)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node || !tip) return
    const rect = node.getBoundingClientRect()
    const left = rect.left - shift, right = rect.right - shift
    const next = right > window.innerWidth - 12 ? window.innerWidth - 12 - right : left < 12 ? 12 - left : 0
    if (next !== shift) setShift(next)
  }, [tip, shift])
  if (!tip) return null
  return <div ref={ref} className={'ui-tooltip' + (tip.below ? ' is-below' : '')} role="tooltip"
    style={{ left: tip.x + shift, top: tip.y }}>
    <span className="ui-tooltip-label">{tip.text}</span>{tip.shortcut ? <ShortcutKeys keys={tip.shortcut.split(' ')} variant="tooltip" /> : null}
  </div>
}
