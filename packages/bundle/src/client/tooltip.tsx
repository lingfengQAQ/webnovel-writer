import * as React from 'react'
import { useSyncExternalStore } from 'react'
import { Tooltip, type TooltipSide } from '@deepseek-ai/dsh-client-ui-primitives'

/*
 * DSH's plain Tooltip has no Escape handling (only its openOnClick mode does), while our hints always
 * closed on Escape. Escape mutes every hint until the pointer or focus reaches a different anchor; the key
 * is never consumed, so the editor's own Escape handling still runs.
 */
let muted = false
let held: Element | null = null
let hovered: Element | null = null
const listeners = new Set<() => void>()
const anchorOf = (target: EventTarget | null) => target instanceof Element ? target.closest('[data-hint]') : null
const set = (next: boolean) => { if (muted !== next) { muted = next; for (const listener of listeners) listener() } }
const onKey = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.isComposing) return
  held = anchorOf(document.activeElement) ?? hovered
  set(true)
}
const onMove = (event: Event) => {
  const anchor = anchorOf(event.target)
  if (event.type === 'pointerover') hovered = anchor
  if (muted && anchor !== held) set(false)
}
function subscribe(listener: () => void) {
  if (typeof document === 'undefined') return () => {}
  if (!listeners.size) {
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerover', onMove, true)
    document.addEventListener('focusin', onMove, true)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size) return
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('pointerover', onMove, true)
    document.removeEventListener('focusin', onMove, true)
    muted = false; held = null; hovered = null
  }
}

/** Split our "label · Ctrl Shift Z" hint copy into the label and DSH keycaps. */
export function splitHint(tip: string): { label: string; keys?: string[] } {
  const [label = '', keys] = tip.split(' · ')
  return keys ? { label, keys: keys.split(' ') } : { label }
}

/**
 * Hover and keyboard-focus hint on a single anchor, with the DSH hover delay. The anchor keeps its own
 * aria-label: a plain DSH tooltip does not describe its anchor.
 */
export function HintTooltip({ tip, side = 'top', children }: { tip: string; side?: TooltipSide; children: React.ReactElement }) {
  const quiet = useSyncExternalStore(subscribe, () => muted, () => false)
  const { label, keys } = splitHint(tip)
  return <Tooltip label={label} shortcutKeys={keys} side={side} delayMs={500} portal disabled={quiet}>
    {React.cloneElement(children, { 'data-hint': '' })}
  </Tooltip>
}
