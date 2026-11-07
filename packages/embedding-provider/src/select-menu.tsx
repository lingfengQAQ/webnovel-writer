import React, { useRef, useState } from 'react'
import { Button, Menu } from '@deepseek-ai/dsh-client-ui-primitives'

/** rc.3 has no public Select; its shared Menu provides the same choice control. */
export function SelectMenu({ label, value, options, onChange, disabled = false }: {
  label: string; value: string; options: readonly { value: string; label: string }[]; onChange(value: string): void; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  return <Menu open={open} anchor={<Button ref={button} variant="outline" size="sm" aria-label={label} aria-expanded={open}
    disabled={disabled} onClick={() => setOpen(current => !current)}>{options.find(option => option.value === value)?.label ?? '请选择'}</Button>}
    items={options.map(option => ({ id: option.value || '__empty', label: option.label }))}
    selectedId={value || '__empty'} portal minWidthFromAnchor autoFocus
    onSelect={id => { onChange(id === '__empty' ? '' : id); setOpen(false); button.current?.focus() }}
    onClose={() => setOpen(false)} />
}
