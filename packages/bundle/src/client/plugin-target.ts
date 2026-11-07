// Packaged locally: Scriptor and retrieval can each be installed without the other client.
/** Minimal view of the Plugins page inventory the navigation needs. */
interface InventoryPackage { readonly name: string; readonly installed?: boolean; readonly rows?: readonly { readonly rowId: string }[] }
interface InventorySnapshot { readonly status?: string; readonly packages?: readonly InventoryPackage[] }
interface InventorySource { getSnapshot(): InventorySnapshot; subscribe?(listener: () => void): () => void }
interface PluginsEntry {
  readonly options?: { readonly key?: string }
  readonly inject?: () => { ensure?: () => void; hooks?: { pluginManager?: InventorySource } } | undefined
  readonly store?: { create?: () => { actions?: { setView?: (view: object) => void; close?: () => void } } | undefined }
}
type Navigation = { openBundle(packageName: string): void }
export interface PluginNavigationHost {
  readonly slots: unknown
  get?(name: string): unknown
  effect?(callback: () => () => void, label?: string): unknown
}

const WAIT_MS = 10_000

/**
 * Open the Plugins page on whichever candidate bundle the profile actually has, optionally on one row's
 * configuration page. The page registers its navigation store and inventory under `main#plugins`; the
 * documented `pluginNavigation.openBundle` selects the panel, and the same store's `setView` opens a row.
 * Before the inventory is loaded the first candidate is opened optimistically and corrected once it loads.
 * @param host - client context.
 * @param candidates - bundle names that may own the target, preferred first.
 * @param rowId - optional row whose configuration page to open.
 * @returns the bundle opened immediately.
 */
export function openPluginTarget(host: PluginNavigationHost, candidates: readonly string[], rowId?: string): string {
  const slots = host.slots as unknown as { entries?: (key: string) => readonly PluginsEntry[] }
  const entry = slots.entries?.('main')?.find(item => item.options?.key === 'plugins')
  const face = entry?.inject?.()
  const source = face?.hooks?.pluginManager
  const navigation = host.get?.('pluginNavigation') as Navigation | undefined
  if (!navigation) throw new Error('插件设置入口尚未就绪，请稍后重试')
  const resolve = (snapshot: InventorySnapshot | undefined): string | undefined => {
    if (!snapshot || (snapshot.status !== 'ready' && snapshot.status !== 'error')) return undefined
    const owned = candidates.flatMap(name => (snapshot.packages ?? []).filter(pkg => pkg.name === name && pkg.installed !== false))
    const match = rowId ? owned.find(pkg => pkg.rows?.some(row => row.rowId === rowId)) : undefined
    return (match ?? owned[0])?.name ?? candidates[0]
  }
  const go = (name: string) => {
    navigation.openBundle(name)
    if (rowId) entry?.store?.create?.()?.actions?.setView?.({ kind: 'row', name, rowId })
    slots.entries?.('sidebar.settings')?.[0]?.store?.create?.()?.actions?.close?.()
  }
  const known = resolve(source?.getSnapshot())
  const first = known ?? candidates[0]!
  go(first)
  if (known) return first
  if (!source?.subscribe) return first
  let done = false
  let stop = () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  const dispose = () => { done = true; stop(); if (timer) clearTimeout(timer) }
  const update = () => {
    if (done) return
    const resolved = resolve(source.getSnapshot())
    if (!resolved) return
    dispose()
    if (resolved !== first || rowId) go(resolved)
  }
  stop = source.subscribe(update)
  timer = setTimeout(dispose, WAIT_MS)
  host.effect?.(() => dispose, 'webnovel: plugin navigation')
  face?.ensure?.()
  update()
  if (done) stop()
  return first
}
