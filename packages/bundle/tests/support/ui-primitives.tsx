/**
 * Node stand-in for @deepseek-ai/dsh-client-ui-primitives (aliased in vitest.config.ts).
 * The published package only loads through the DSH shell build (CSS Modules, devDependency-only imports),
 * so unit tests render these semantic equivalents. Signatures follow the real types; behavior and
 * appearance are verified by the browser probes against the shell's real instance.
 */
import * as React from 'react'
import type * as Real from '@deepseek-ai/dsh-client-ui-primitives'

type Loose = Record<string, any>

export const Button = React.forwardRef<HTMLButtonElement, Loose>(function Button({ variant: _variant, size: _size, icon, children, ...rest }, ref) {
  return <button ref={ref} type="button" {...rest}>{icon}{children}</button>
}) as unknown as typeof Real.Button

export const Checkbox: typeof Real.Checkbox = ({ checked, onChange, label, disabled, title, className }) =>
  <label className={className} title={title}><input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />{label}</label>

export const Switch: typeof Real.Switch = ({ checked, onChange, label, disabled = false, title, className }) =>
  <button type="button" role="switch" aria-checked={checked} aria-label={label} title={title} disabled={disabled} className={className} onClick={() => onChange(!checked)}><span /></button>

export const Input = React.forwardRef<HTMLInputElement, Loose>(function Input({ icon, className, ...rest }, ref) {
  return <span className={className}>{icon}<input ref={ref} {...rest} /></span>
}) as unknown as typeof Real.Input

export const MenuSurface = React.forwardRef<HTMLDivElement, Loose>(function MenuSurface({ compact: _compact, ...rest }, ref) {
  return <div ref={ref} {...rest} />
}) as unknown as typeof Real.MenuSurface

export const Menu = (({ open, anchor, items = [], children, selectedId, onSelect, className }: Loose) => <span className={className}>
  {anchor}
  {open ? <div role="menu">{items.map((entry: Loose) => 'type' in entry ? <div key={entry.id} role={entry.type === 'separator' ? 'separator' : 'presentation'}>{entry.text}</div>
    : <button key={entry.id} type="button" role="menuitem" disabled={entry.disabled} data-selected={entry.id === selectedId || undefined} onClick={() => onSelect?.(entry.id)}>{entry.label}</button>)}{children}</div> : null}
</span>) as unknown as typeof Real.Menu

export const Tooltip = (({ children }: Loose) => children) as unknown as typeof Real.Tooltip

export const Toast: typeof Real.Toast = ({ text }) => <div role="alert">{text}</div> as unknown as React.ReactPortal

export const StateDot: typeof Real.StateDot = ({ state, className }) => <span className={className} data-state={state} aria-hidden="true" />

export const Tag: typeof Real.Tag = ({ tone, className, children }) => <span className={className} data-tone={tone ?? 'outline'}>{children}</span>

export const PathLabel: typeof Real.PathLabel = ({ path, ...attributes }) => <span {...attributes} title={path}>{path}</span>

export const SegmentedTabs = (({ items, value, onChange, label, className }: Loose) => <div role="tablist" aria-label={label} className={className}>
  {items.map((item: Loose) => <button key={item.id} type="button" role="tab" id={item.id} aria-controls={item.panelId} aria-selected={item.value === value} onClick={() => onChange(item.value)}>{item.label}</button>)}
</div>) as unknown as typeof Real.SegmentedTabs

export const SegmentedControl = (({ id, value, options, onChange, label, disabled, className }: Loose) => <div role="tablist" aria-label={label} className={className}>
  {options.map((option: Loose) => <button key={option.value} type="button" role="tab" id={`${id}-${option.value}`} aria-selected={option.value === value}
    disabled={disabled || option.disabled} title={option.title} onClick={() => { if (option.value !== value) onChange(option.value) }}>{option.label}</button>)}
</div>) as unknown as typeof Real.SegmentedControl

export const Pill = (({ active: _active, onClick, children, ...rest }: Loose) => onClick
  ? <button type="button" onClick={onClick} {...rest}>{children}</button>
  : <span className={rest.className}>{children}</span>) as unknown as typeof Real.Pill

export const DisclosureRow = (({ icon, title, open, expandable, onToggle, collapsedContent, children, className }: Loose) => <div className={className} data-open={open || undefined}>
  {expandable ? <button type="button" aria-label={title} aria-expanded={open} onClick={onToggle}>{icon}</button> : icon}
  <span>{title}</span>{!open && collapsedContent}
  {open && children}
</div>) as unknown as typeof Real.DisclosureRow

export const ShortcutKeys: typeof Real.ShortcutKeys = ({ keys, className }) => <span className={className}>{keys.map((key, index) => <kbd key={index}>{key}</kbd>)}</span>

const extensionTypes: Record<string, string> = { md: 'markdown', markdown: 'markdown', mdx: 'markdown', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image', json: 'json', yaml: 'yaml', yml: 'yaml' }
export const classifyFileType = ((path: string) => extensionTypes[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'other') as unknown as typeof Real.classifyFileType

export const FileTypeIcon = ((props: Loose) => <svg data-file-type={'kind' in props ? props.kind : classifyFileType(props.path)} className={props.className} aria-hidden="true" />) as unknown as typeof Real.FileTypeIcon

const icon = (name: string) => (({ className }: Loose) => <svg data-icon={name} className={className} aria-hidden="true" />) as unknown as typeof Real.IconCheckOutlineRegular
export const IconCheckOutlineRegular = icon('CheckOutline')
export const IconChevronDownOutlineRegular = icon('ChevronDownOutline')
export const IconChevronLeftOutlineRegular = icon('ChevronLeftOutline')
export const IconChevronRightOutlineRegular = icon('ChevronRightOutline')
export const IconChevronUpOutlineRegular = icon('ChevronUpOutline')
export const IconChevronsUpDownOutlineRegular = icon('ChevronsUpDownOutline')
export const IconCloseOutlineRegular = icon('CloseOutline')
export const IconCompareSplitOutlineRegular = icon('CompareSplitOutline')
export const IconContextInjectionOutlineRegular = icon('ContextInjectionOutline')
export const IconCopyOutlineRegular = icon('CopyOutline')
export const IconDatabaseOutlineRegular = icon('DatabaseOutline')
export const IconDownloadOutlineRegular = icon('DownloadOutline')
export const IconEditOutlineRegular = icon('EditOutline')
export const IconEllipsisOutlineRegular = icon('EllipsisOutline')
export const IconFlatListOutlineRegular = icon('FlatListOutline')
export const IconFolderCloseRegular = icon('FolderClose')
export const IconFolderOpenRegular = icon('FolderOpen')
export const IconFullscreenOutlineRegular = icon('FullscreenOutline')
export const IconGoalOutlineRegular = icon('GoalOutline')
export const IconPauseOutlineRegular = icon('PauseOutline')
export const IconPlayOutlineRegular = icon('PlayOutline')
export const IconPlusOutlineRegular = icon('PlusOutline')
export const IconRefreshOutlineRegular = icon('RefreshOutline')
export const IconRightUpOutlineRegular = icon('RightUpOutline')
export const IconSearchOutlineRegular = icon('SearchOutline')
export const IconSendOutlineRegular = icon('SendOutline')
export const IconSettingsOutlineRegular = icon('SettingsOutline')
export const IconSlidersTwoOutlineRegular = icon('SlidersTwoOutline')
export const IconSparkleRegular = icon('Sparkle')
export const IconWarningTriangleOutlineRegular = icon('WarningTriangleOutline')
