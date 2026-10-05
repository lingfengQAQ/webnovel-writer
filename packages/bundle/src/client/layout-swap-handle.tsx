import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { applySwap, probeFrame, restoreSwap, swappable, type ProbeHit } from './layout-swap'

const FRAME_ATTRS = ['data-rightbar-collapsed', 'data-rightbar-fullscreen', 'data-rightbar-instant']

interface PlaceWindow extends Window {
  __webnovelSwapPlaces?: number
}

interface Bound {
  frame: Element
  rightbar: Element
  center: Element
  panel: Element
  shells: readonly Element[]
}

function sameNodes(left: readonly Element[], right: readonly Element[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function shellsOf(rightbar: Element): Element[] {
  return Array.from(rightbar.children)
}

/** Divider button. The overlay stays click-through; only this 22px control receives hits. */
export function SwapHandle(): React.ReactElement | null {
  const [box, setBox] = useState<{ x: number; y: number } | null>(null)
  const [pressed, setPressed] = useState(false)
  const last = useRef('')

  useEffect(() => {
    const ro = new ResizeObserver(() => { schedule() })
    const mo = new MutationObserver(() => { schedule() })
    let raf = 0
    let disposed = false
    let wide = false
    let bound: Bound | null = null

    const schedule = () => {
      if (disposed || raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (!disposed) place()
      })
    }

    const watchWide = () => {
      if (wide) return
      wide = true
      bound = null
      ro.disconnect()
      mo.disconnect()
      mo.observe(document.body, { childList: true, subtree: true })
    }

    const watchNarrow = (hit: ProbeHit<Element>) => {
      const shells = shellsOf(hit.rightbar)
      if (bound && !wide
        && bound.frame === hit.frame
        && bound.rightbar === hit.rightbar
        && bound.center === hit.center
        && bound.panel === hit.panel
        && sameNodes(bound.shells, shells)) return
      wide = false
      bound = { frame: hit.frame, rightbar: hit.rightbar, center: hit.center, panel: hit.panel, shells }
      ro.disconnect()
      mo.disconnect()
      mo.observe(hit.frame, { attributes: true, attributeFilter: FRAME_ATTRS, childList: true })
      mo.observe(hit.rightbar, { attributes: true, attributeFilter: ['data-rightbar-col'], childList: true })
      for (const shell of shells) mo.observe(shell, { childList: true })
      mo.observe(hit.panel, { attributes: true, attributeFilter: ['data-sidebar-right-panel'] })
      let parent = hit.frame.parentElement
      while (parent) {
        mo.observe(parent, { childList: true })
        parent = parent.parentElement
      }
      ro.observe(hit.frame)
      ro.observe(hit.rightbar)
      ro.observe(hit.center)
    }

    const place = () => {
      const placeWindow = window as PlaceWindow
      placeWindow.__webnovelSwapPlaces = (placeWindow.__webnovelSwapPlaces ?? 0) + 1
      const hit = probeFrame(document)
      if (!hit) watchWide()
      else watchNarrow(hit)
      restoreSwap(document, localStorage)
      const on = document.documentElement.hasAttribute('data-webnovel-swap')
      if (!hit || !swappable(hit.frame)) {
        const key = on ? 'hidden:on' : 'hidden'
        if (last.current === key) return
        last.current = key
        setPressed(on)
        setBox(null)
        return
      }
      const overlay = hit.frame.querySelector('[data-shell-overlay]') ?? hit.frame
      const origin = overlay.getBoundingClientRect()
      const edge = Math.max(hit.rightbar.getBoundingClientRect().left, hit.center.getBoundingClientRect().left)
      const next = { x: Math.round(edge - origin.left), y: Math.round(origin.height / 2) }
      const key = `${next.x}:${next.y}:${on}`
      if (last.current === key) return
      last.current = key
      setPressed(on)
      setBox(next)
    }

    schedule()
    return () => {
      disposed = true
      if (raf !== 0) cancelAnimationFrame(raf)
      ro.disconnect()
      mo.disconnect()
      document.documentElement.removeAttribute('data-webnovel-swap')
    }
  }, [])

  if (!box) return null
  const label = pressed ? '把对话移回中间' : '把对话移到右侧'
  return <button
    type="button"
    className="nw-swap"
    style={{ left: box.x, top: box.y }}
    aria-label={label}
    aria-pressed={pressed}
    title={label}
    onClick={() => {
      if (!applySwap(document, localStorage, !document.documentElement.hasAttribute('data-webnovel-swap'))) return
      last.current = ''
      setPressed(document.documentElement.hasAttribute('data-webnovel-swap'))
    }}
  ><ArrowLeftRight size={13} strokeWidth={1.75} /></button>
}
