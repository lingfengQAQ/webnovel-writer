import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { callStudy } from './api'
import { mainSessionOf, type ClientHost } from './host'
import type { EditorStore } from './store'

export function useSession(host: ClientHost): string | undefined {
  return useSyncExternalStore(host.sessions.list.subscribe, () => mainSessionOf(host))
}

export function useEditor(store: EditorStore, id: string) {
  return useSyncExternalStore(store.subscribe, useCallback(() => store.get(id), [store, id]))
}

export function useStudy<T>(sessionId: string | undefined, method: string | null, payload: object = {}, refresh = 0) {
  const serialized = JSON.stringify(payload)
  const resource = JSON.stringify([sessionId, method, serialized])
  const key = JSON.stringify([resource, refresh])
  const [state, setState] = useState<{ key: string; resource: string; value?: T; error?: string }>({ key: '', resource: '' })
  useEffect(() => {
    if (!sessionId || !method) return
    const abort = new AbortController()
    void callStudy<T>(sessionId, method, JSON.parse(serialized) as object, abort.signal).then(
      value => { if (!abort.signal.aborted) setState({ key, resource, value }) },
      error => { if (!abort.signal.aborted) setState({ key, resource, error: error instanceof Error ? error.message : '读取失败' }) },
    )
    return () => abort.abort()
  }, [sessionId, method, serialized, key, resource])
  return state.key === key ? { ...state, loading: false } : { key, loading: !!sessionId && !!method, value: state.resource === resource ? state.value : undefined, error: undefined }
}
