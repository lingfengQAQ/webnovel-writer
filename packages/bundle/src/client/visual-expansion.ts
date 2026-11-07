import { useEffect, useRef, useState } from 'react'

const COLLAPSE = 'scriptor:collapse-visual'
/** Expand inside the app so the native composer remains usable below the visualization. */
export function useVisualExpansion(getRoot: () => HTMLElement | null | undefined) {
  const latest = useRef(getRoot); latest.current = getRoot
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (!expanded) return
    const root = latest.current()
    if (!root) return
    const close = () => setExpanded(false)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close() } }
    root.dataset.visualExpanded = ''
    root.addEventListener(COLLAPSE, close); document.addEventListener('keydown', escape)
    return () => {
      delete root.dataset.visualExpanded; root.removeEventListener(COLLAPSE, close); document.removeEventListener('keydown', escape)
      if (root.isConnected) root.querySelector<HTMLButtonElement>('[data-visual-expand]')?.focus({ preventScroll: true })
    }
  }, [expanded])
  return { expanded, toggle: () => setExpanded(value => !value) }
}
export function collapseVisual(root: HTMLElement | null): void { root?.dispatchEvent(new Event(COLLAPSE)) }
