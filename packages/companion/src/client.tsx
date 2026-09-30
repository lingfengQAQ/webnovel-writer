import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { CompanionStore, type Storage } from './state'
import { watchSession, type SessionHost } from './session'
import { PetOverlay, PetSettings } from './view'
import css from './style.css'

export const inject = ['slots', 'sessions', 'uiSession', 'connection']
export function apply(ctx: Context & SessionHost): void {
  let storage: Storage | undefined
  try { storage = window.localStorage } catch { /* Private browser policies may disable persistence. */ }
  const store = new CompanionStore(storage)
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.whaleCompanion = ''; style.textContent = css; document.head.append(style)
    const unwatch = watchSession(ctx, store)
    document.addEventListener('pointerdown', store.touch, { passive: true })
    document.addEventListener('keydown', store.touch, { passive: true })
    return () => {
      unwatch(); store.dispose(); style.remove()
      document.removeEventListener('pointerdown', store.touch); document.removeEventListener('keydown', store.touch)
    }
  }, 'whale-companion: presentation lifetime')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'whale-companion', inject: () => ({ store }) }, PetOverlay))
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({ name: 'settings.general.item', id: 'whale-companion', order: 80, inject: () => ({ store }) }, PetSettings))
}
