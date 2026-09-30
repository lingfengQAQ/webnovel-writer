import { useEffect, useState } from 'react'
import type { ClientHost } from './host'
import type { EditorStore } from './store'

type Frame = { kind: 'ready' } | { kind: 'change'; change: { absolutePath: string } }
interface WatchRemote {
  workspaceFiles: { changes(sessionId: string, path: string, signal: AbortSignal): AsyncIterable<Frame> }
  $stream<T>(options: { name: string; open(signal: AbortSignal): AsyncIterable<T>; ended(accepted: boolean): Error }): AsyncIterable<{ value: T; accept(): void }> & { dispose(): Promise<void> }
}

/** Watch mounted directory views; never notify an Agent or write business files. */
export function useDirectoryWatch(host: ClientHost, sessionId: string, path: string | undefined, store: EditorStore): string | undefined {
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!path) return
    const remote = host.get('remote') as WatchRemote | undefined
    if (!remote?.workspaceFiles?.changes || !remote.$stream) { setError('当前宿主不支持目录监听，请手动刷新'); return }
    let live = true
    const stream = remote.$stream<Frame>({ name: '书房目录 ' + path,
      open: signal => remote.workspaceFiles.changes(sessionId, path, signal),
      ended: () => new Error('目录监听已结束，请手动刷新'),
    })
    void (async () => {
      try {
        for await (const item of stream) {
          if (!live) break
          if (item.value.kind === 'ready') { item.accept(); setError(undefined) }
          store.invalidate(sessionId)
        }
      } catch { if (live) setError('目录自动刷新暂不可用，请手动刷新') }
    })()
    return () => { live = false; void stream.dispose().catch(() => {}) }
  }, [host, sessionId, path, store])
  return error
}
