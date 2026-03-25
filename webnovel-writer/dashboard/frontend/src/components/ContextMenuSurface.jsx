const MENU_SURFACE_STYLE = {
    position: 'fixed',
    minWidth: 220,
    maxWidth: 320,
    background: '#111827',
    color: '#f9fafb',
    border: '1px solid #374151',
    borderRadius: 10,
    boxShadow: '0 16px 40px rgba(0, 0, 0, 0.35)',
    zIndex: 3000,
    padding: 8,
}

const OVERLAY_STYLE = {
    position: 'fixed',
    inset: 0,
    zIndex: 2999,
}

const ITEM_BASE_STYLE = {
    width: '100%',
    border: 0,
    borderRadius: 8,
    background: 'transparent',
    color: 'inherit',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    textAlign: 'left',
    cursor: 'pointer',
    padding: '8px 10px',
    fontSize: 13,
}

const EMPTY_STYLE = {
    color: '#9ca3af',
    fontSize: 12,
    padding: '8px 10px',
}

function resolveLeft(left) {
    const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
    const menuWidth = 280
    return Math.max(8, Math.min(left, viewportWidth - menuWidth - 8))
}

function resolveTop(top) {
    const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight
    const menuHeight = 320
    return Math.max(8, Math.min(top, viewportHeight - menuHeight - 8))
}

export default function ContextMenuSurface({ menu, onSelect, onClose }) {
    if (!menu.open) return null

    const items = Array.isArray(menu.items) ? menu.items : []
    const left = resolveLeft(menu.x)
    const top = resolveTop(menu.y)

    return (
        <div style={OVERLAY_STYLE} onMouseDown={onClose}>
            <div
                role="menu"
                aria-label={menu.sourceId || 'context-menu'}
                style={{ ...MENU_SURFACE_STYLE, left, top }}
                onMouseDown={event => event.stopPropagation()}
            >
                {items.length === 0 ? (
                    <div style={EMPTY_STYLE}>No actions available.</div>
                ) : (
                    items.map(item => {
                        const disabled = Boolean(item.disabled)
                        const color = item.danger ? '#fca5a5' : undefined

                        return (
                            <button
                                key={item.id}
                                type="button"
                                role="menuitem"
                                disabled={disabled}
                                style={{
                                    ...ITEM_BASE_STYLE,
                                    color,
                                    opacity: disabled ? 0.45 : 1,
                                }}
                                onClick={() => onSelect(item)}
                            >
                                <span>{item.label}</span>
                                {item.shortcut ? <span>{item.shortcut}</span> : null}
                            </button>
                        )
                    })
                )}
            </div>
        </div>
    )
}
