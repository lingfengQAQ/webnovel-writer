import { useSyncExternalStore } from 'react'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientHost } from './host'
import { normalizeWebnovelPreferences, type WebnovelPreferences, type WebnovelPreferencesInput } from '../preferences'

export interface PreferenceSnapshot {
  readonly value: WebnovelPreferences
  readonly writable: boolean
  readonly busy: boolean
  readonly notice?: string
}

/** One Host-backed view shared by the preference card and all entry points. */
export function createPreferencesStore() {
  let form: ConfigForm<WebnovelPreferencesInput> | undefined
  let accepted: ConfigFormSnapshot<WebnovelPreferencesInput> | undefined
  let snapshot: PreferenceSnapshot = { value: normalizeWebnovelPreferences(undefined), writable: false, busy: false }
  let off = () => {}
  let generation = 0
  const listeners = new Set<() => void>()
  const publish = (next: PreferenceSnapshot) => { snapshot = next; for (const listener of listeners) listener() }
  const sync = () => {
    accepted = form?.getSnapshot()
    publish({ ...snapshot, value: normalizeWebnovelPreferences(accepted?.value),
      writable: accepted?.status === 'ready' && accepted.writable })
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    bind(next: typeof form) {
      generation++; off(); form = next
      off = form?.subscribe(sync) ?? (() => {})
      snapshot = { ...snapshot, busy: false, notice: undefined }; sync()
      return () => {
        if (form !== next) return
        generation++; off(); off = () => {}; form = undefined; accepted = undefined
        publish({ value: normalizeWebnovelPreferences(undefined), writable: false, busy: false })
      }
    },
    async set<K extends keyof WebnovelPreferences>(key: K, value: WebnovelPreferences[K]): Promise<boolean> {
      if (!form || !snapshot.writable || snapshot.busy || accepted?.revision === undefined) return false
      const currentForm = form, currentGeneration = generation, revision = accepted.revision
      publish({ ...snapshot, value: { ...snapshot.value, [key]: value }, busy: true, notice: undefined })
      try {
        const ok = await currentForm.mutate([{ op: 'set', path: [key], value }], revision)
        if (currentGeneration !== generation) return false
        if (!ok) throw new Error('偏好未保存，已载入宿主当前值；请核对后重试。')
        publish({ ...snapshot, value: normalizeWebnovelPreferences(currentForm.getSnapshot().value), busy: false, notice: '偏好已保存' })
        return true
      } catch (error) {
        if (currentGeneration === generation) publish({ ...snapshot, value: normalizeWebnovelPreferences(currentForm.getSnapshot().value),
          busy: false, notice: error instanceof Error ? error.message : '偏好保存失败，请重试' })
        return false
      }
    },
  }
}

export type PreferencesStore = ReturnType<typeof createPreferencesStore>
const stores = new WeakMap<ClientHost, PreferencesStore>()
export function preferencesFor(host: ClientHost): PreferencesStore {
  let store = stores.get(host)
  if (!store) { store = createPreferencesStore(); stores.set(host, store) }
  return store
}
export function installPreferences(host: ClientHost): PreferencesStore {
  const store = preferencesFor(host)
  host.inject(['configForms'], scope => scope.effect(() => {
    const forms = scope.get('configForms') as { get<T>(id: string): ConfigForm<T> } | undefined
    return store.bind(forms?.get<WebnovelPreferencesInput>('webnovel'))
  }, 'webnovel: preferences'))
  return store
}
export function usePreferences(host: ClientHost): PreferenceSnapshot {
  const store = preferencesFor(host)
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

/** Slot entries keep their own lifecycle while a preference adds or removes them. */
export function followPreference(store: PreferencesStore, key: 'showVisualTab' | 'showIndexGuideCard', mount: () => () => void): () => void {
  let enabled: boolean | undefined, off: (() => void) | undefined
  const sync = () => {
    const next = store.getSnapshot().value[key]
    if (enabled === next) return
    off?.(); off = undefined; enabled = next
    if (next) off = mount()
  }
  const unsubscribe = store.subscribe(sync); sync()
  return () => { unsubscribe(); off?.() }
}
