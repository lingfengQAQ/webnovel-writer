import * as React from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'

export interface MenuItem {
  id: string
  icon: LucideIcon
  label: string
  shortcut?: string
  disabled?: boolean
  checked?: boolean
  agent?: boolean
  run?: () => void
  submenu?: MenuItem[]
}
export interface MenuSection { id: string; row?: boolean; items: MenuItem[] }

const tipOf = (item: MenuItem) => item.label + (item.shortcut ? ' · ' + item.shortcut : '')
const SUBMENU_WIDTH = 196

/** Right-click menu: an icon row for clipboard and history, then icon-and-label sections. */
export function ContextMenu({ x, y, bounds, sections, header, onClose }: {
  x: number; y: number; bounds: { width: number; height: number }; sections: MenuSection[]; header: string
  onClose: (refocus: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState({ left: x, top: y, ready: false, sub: 'right' as 'right' | 'left' | 'inline' })
  const [open, setOpen] = useState<string | null>(null)
  const [subTop, setSubTop] = useState(0)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const width = node.offsetWidth, height = node.offsetHeight
    const left = Math.max(6, Math.min(x, bounds.width - width - 6))
    const top = y + height > bounds.height - 6 ? Math.max(6, Math.min(y, bounds.height - 6) - height) : y
    const sub = bounds.width - left - width >= SUBMENU_WIDTH ? 'right' : left >= SUBMENU_WIDTH ? 'left' : 'inline'
    setLayout({ left, top, ready: true, sub })
  }, [x, y, bounds.width, bounds.height, open])
  useLayoutEffect(() => { ref.current?.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus({ preventScroll: true }) }, [])

  const openSub = (id: string | null) => {
    setOpen(id)
    if (id) setSubTop(ref.current?.querySelector<HTMLElement>(`[data-sub="${id}"]`)?.offsetTop ?? 0)
  }
  const focusable = (from: Element | null) => {
    const scope = from?.closest('.ed-submenu, .ed-menu-main') ?? ref.current
    return Array.from(scope?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? []).filter(button => button.closest('.ed-submenu, .ed-menu-main') === scope)
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    const active = document.activeElement as HTMLElement | null
    const list = focusable(active)
    const index = list.indexOf(active as HTMLButtonElement)
    const horizontal = !!active?.classList.contains('is-icon')
    const move = (delta: number) => { event.preventDefault(); list[(index + delta + list.length) % list.length]?.focus() }
    if (event.key === 'Escape') { event.preventDefault(); if (open) { const id = open; openSub(null); ref.current?.querySelector<HTMLButtonElement>(`[data-sub="${id}"]`)?.focus() } else onClose(true) }
    else if (event.key === 'ArrowDown') move(1)
    else if (event.key === 'ArrowUp') move(-1)
    else if (event.key === 'ArrowRight' && active?.dataset.sub) { event.preventDefault(); openSub(active.dataset.sub); requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('.ed-submenu [role=menuitem]')?.focus()) }
    else if (event.key === 'ArrowRight' && horizontal) move(1)
    else if (event.key === 'ArrowLeft' && active?.closest('.ed-submenu')) { event.preventDefault(); const id = open; openSub(null); ref.current?.querySelector<HTMLButtonElement>(`[data-sub="${id}"]`)?.focus() }
    else if (event.key === 'ArrowLeft' && horizontal) move(-1)
    else if (event.key === 'Tab') { event.preventDefault(); onClose(true) }
  }
  const activate = (item: MenuItem) => {
    if (item.disabled) return
    if (item.submenu) { openSub(open === item.id ? null : item.id); return }
    onClose(false)
    item.run?.()
  }
  const button = (item: MenuItem, iconOnly: boolean) => {
    const Icon = item.icon
    return <button key={item.id} type="button" role="menuitem" className={'ed-menu-item' + (item.agent ? ' is-agent' : '') + (iconOnly ? ' is-icon' : '') + (open === item.id ? ' is-open' : '')}
      disabled={item.disabled} aria-label={item.label} aria-haspopup={item.submenu ? 'menu' : undefined} aria-expanded={item.submenu ? open === item.id : undefined}
      aria-pressed={item.checked} data-sub={item.submenu ? item.id : undefined} data-tip={iconOnly ? tipOf(item) : undefined}
      onMouseEnter={() => { if (iconOnly || layout.sub === 'inline') return; if (item.submenu) openSub(item.id); else if (open && !(document.activeElement as HTMLElement | null)?.closest('.ed-submenu')) openSub(null) }}
      onClick={() => activate(item)}>
      <Icon size={16} strokeWidth={1.75} />
      {!iconOnly && <span className="ed-menu-label">{item.label}</span>}
      {!iconOnly && item.checked !== undefined && <span className={'ed-menu-check' + (item.checked ? ' is-on' : '')} aria-hidden="true" />}
      {!iconOnly && item.shortcut && <kbd>{item.shortcut}</kbd>}
      {!iconOnly && item.submenu && <ChevronRight size={14} className="ed-menu-chevron" />}
    </button>
  }
  const submenu = sections.flatMap(section => section.items).find(item => item.id === open)?.submenu
  return <div ref={ref} className={'ed-float ed-menu is-labeled sub-' + layout.sub} role="menu" aria-label="编辑器菜单" onKeyDown={onKeyDown}
    style={{ left: layout.left, top: layout.top, opacity: layout.ready ? undefined : 0 }}
    onContextMenu={event => event.preventDefault()} onMouseDown={event => event.preventDefault()}>
    <div className="ed-menu-main">
      <div className="ed-menu-header">{header}</div>
      {sections.map(section => {
        const iconOnly = !!section.row
        return <div key={section.id} className={'ed-menu-section' + (iconOnly ? ' ed-menu-row' : '')} role="group">
          {section.items.map(item => <React.Fragment key={item.id}>
            {button(item, iconOnly)}
            {layout.sub === 'inline' && open === item.id && item.submenu && <div className="ed-submenu is-inline" role="menu">{item.submenu.map(sub => button(sub, false))}</div>}
          </React.Fragment>)}
        </div>
      })}
    </div>
    {layout.sub !== 'inline' && submenu && <div className="ed-float ed-submenu" role="menu" style={{ top: Math.max(0, subTop - 5) }}>
      {submenu.map(item => button(item, false))}
    </div>}
  </div>
}
