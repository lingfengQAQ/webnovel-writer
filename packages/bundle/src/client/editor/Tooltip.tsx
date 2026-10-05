import * as React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

interface Tip { text: string; shortcut?: string; x: number; y: number; below: boolean }

/** One shared tooltip for every `[data-tip]` control inside the editor. */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const warm = useRef(0)
  useEffect(() => {
    let current: HTMLElement | null = null
    const show = (target: HTMLElement) => {
      const raw = target.dataset.tip
      if (!raw) return
      const [text, shortcut] = raw.split(' · ')
      if (!text) return
      const rect = target.getBoundingClientRect()
      const below = rect.top < 44
      setTip({ text, shortcut, x: rect.left + rect.width / 2, y: below ? rect.bottom + 6 : rect.top - 6, below })
      warm.current = Date.now()
    }
    const over = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tip]') : null
      if (target === current) return
      current = target
      window.clearTimeout(timer.current)
      if (!target) { setTip(null); return }
      const delay = Date.now() - warm.current < 600 ? 40 : event.type === 'focusin' ? 200 : 380
      timer.current = window.setTimeout(() => { if (current === target && target.isConnected) show(target) }, delay)
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
    const next = right > window.innerWidth - 6 ? window.innerWidth - 6 - right : left < 6 ? 6 - left : 0
    if (next !== shift) setShift(next)
  }, [tip, shift])
  if (!tip) return null
  return <div ref={ref} className={'ui-tooltip' + (tip.below ? ' is-below' : '')} role="tooltip"
    style={{ left: tip.x + shift, top: tip.y }}>
    <span>{tip.text}</span>{tip.shortcut ? <kbd>{tip.shortcut}</kbd> : null}
  </div>
}
