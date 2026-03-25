import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import ContextMenuSurface from './ContextMenuSurface.jsx'

const ContextMenuContext = createContext(null)

function getClosedMenuState() {
    return {
        open: false,
        x: 0,
        y: 0,
        sourceId: '',
        items: [],
        meta: null,
        onAction: null,
    }
}

/**
 * Reusable menu item protocol:
 * - id: stable item id
 * - label: UI text
 * - actionId: optional logical action id, defaults to id
 * - disabled: whether the item is clickable
 * - danger: mark destructive action
 * - shortcut: optional shortcut hint
 * - onSelect(payload): optional action handler
 */
export function ContextMenuProvider({ children }) {
    const [menu, setMenu] = useState(() => getClosedMenuState())

    const closeMenu = useCallback(() => {
        setMenu(getClosedMenuState())
    }, [])

    const openMenu = useCallback(config => {
        const x = Number.isFinite(config?.x) ? config.x : 16
        const y = Number.isFinite(config?.y) ? config.y : 16

        setMenu({
            open: true,
            x,
            y,
            sourceId: config?.sourceId || '',
            items: Array.isArray(config?.items) ? config.items : [],
            meta: config?.meta || null,
            onAction: config?.onAction || null,
        })
    }, [])

    const openForEvent = useCallback((event, config) => {
        event.preventDefault()
        openMenu({
            ...config,
            x: event.clientX,
            y: event.clientY,
        })
    }, [openMenu])

    const handleSelect = useCallback(item => {
        const payload = {
            actionId: item.actionId || item.id,
            itemId: item.id,
            sourceId: menu.sourceId,
            meta: menu.meta,
        }

        closeMenu()

        if (typeof item.onSelect === 'function') {
            item.onSelect(payload)
        }

        if (typeof menu.onAction === 'function') {
            menu.onAction(payload)
        }
    }, [closeMenu, menu])

    useEffect(() => {
        if (!menu.open) return undefined

        const handleKeyDown = event => {
            if (event.key === 'Escape') {
                closeMenu()
            }
        }

        const handleWindowChange = () => {
            closeMenu()
        }

        window.addEventListener('keydown', handleKeyDown)
        window.addEventListener('resize', handleWindowChange)
        window.addEventListener('scroll', handleWindowChange, true)

        return () => {
            window.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('resize', handleWindowChange)
            window.removeEventListener('scroll', handleWindowChange, true)
        }
    }, [closeMenu, menu.open])

    const contextValue = useMemo(() => {
        return {
            openMenu,
            openForEvent,
            closeMenu,
        }
    }, [openMenu, openForEvent, closeMenu])

    return (
        <ContextMenuContext.Provider value={contextValue}>
            {children}
            <ContextMenuSurface menu={menu} onSelect={handleSelect} onClose={closeMenu} />
        </ContextMenuContext.Provider>
    )
}

export function useContextMenu() {
    const contextValue = useContext(ContextMenuContext)
    if (!contextValue) {
        throw new Error('useContextMenu must be used within ContextMenuProvider')
    }
    return contextValue
}
