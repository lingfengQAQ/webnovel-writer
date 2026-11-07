import type { ClientHost } from './host'
import { openPluginTarget } from './plugin-target'

export type SettingsTarget = { kind: 'bundle'; group?: 'visibility' | 'views' | 'retrieval' }
  | { kind: 'row'; rowId: 'webnovel-embeddings' | 'webnovel-scenes' | 'webnovel-reranking' | 'webnovel-graph' }
const BUNDLES = ['@linfengqaqtat/dsh-scriptor-full', '@linfengqaqtat/dsh-scriptor']
const RETRIEVAL = ['@linfengqaqtat/dsh-scriptor-full', '@linfengqaqtat/dsh-scriptor-retrieval']

export function openPluginSettings(host: ClientHost, target: SettingsTarget): void {
  openPluginTarget(host, target.kind === 'bundle' ? BUNDLES : RETRIEVAL, target.kind === 'row' ? target.rowId : undefined)
  if (target.kind !== 'bundle' || typeof document === 'undefined') return
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const observer = new MutationObserver(() => locate())
  const stop = () => { stopped = true; observer.disconnect(); if (timer) clearTimeout(timer) }
  const locate = () => {
    if (stopped) return
    const group = document.querySelector<HTMLElement>(`[data-webnovel-pref-group="${target.group ?? 'visibility'}"]`)
    if (!group) return
    group.scrollIntoView({ block: 'start', behavior: 'auto' }); group.focus({ preventScroll: true }); stop()
  }
  observer.observe(document.body, { childList: true, subtree: true })
  timer = setTimeout(stop, 10_000)
  host.effect(() => stop, 'webnovel: preference navigation')
  locate()
}
