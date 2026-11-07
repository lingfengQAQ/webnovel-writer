import * as React from 'react'
import { useCallback, useState } from 'react'
import { Button, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconChevronsUpDown } from './icons'

export interface SelectOption { readonly value: string; readonly label: string }

/**
 * Single choice from a short list through the DSH Menu (DSH replaces native selects with menus).
 * Menu leaves the trigger's popup state to its owner, so the trigger names the choice and its value.
 */
export function SelectMenu({ label, value, options, onChange, disabled, className }: {
  label: string; value: string; options: readonly SelectOption[]; onChange: (value: string) => void; disabled?: boolean; className?: string
}) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const current = options.find(option => option.value === value)
  return <Menu open={open} onClose={close} portal minWidthFromAnchor className={'nw-select' + (className ? ' ' + className : '')}
    items={options.map(option => ({ id: option.value, label: option.label }))} selectedId={value}
    onSelect={id => { setOpen(false); if (id !== value) onChange(id) }}
    anchor={<Button variant="outline" size="sm" className="nw-select-trigger" aria-label={current ? label + '：' + current.label : label}
      aria-haspopup="menu" aria-expanded={open} disabled={disabled || !options.length} onClick={() => setOpen(value => !value)}>
      <span className="nw-select-value">{current?.label ?? ''}</span><IconChevronsUpDown size={14} className="nw-select-chevron" />
    </Button>} />
}
