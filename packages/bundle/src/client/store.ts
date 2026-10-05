import type { FileRef, StudyDocument, StudySave } from '../study/types'
import { callStudy, StudyApiError } from './api'

export const fileKey = (ref: FileRef): string => JSON.stringify([ref.space, ref.path])
interface SaveAttempt { readonly operationId: string; readonly hash: string; readonly body: string; readonly ref: FileRef; readonly accepted?: readonly string[] }
export interface BufferState {
  mode?: 'read' | 'edit' | 'changes'
  document: StudyDocument
  text: string
  saving?: boolean
  error?: string
  errorCode?: string
  saved?: StudySave
  disk?: StudyDocument
  attempt?: SaveAttempt
  /** Accepted suggestion ids submitted with the save. Notify retries send this same list. */
  accepted?: readonly string[]
}
export interface SessionEditor {
  readonly buffers: Readonly<Record<string, BufferState>>
  readonly current?: string
  readonly mode: 'read' | 'edit' | 'changes'
  readonly selection: string
  readonly refresh: number
  readonly error?: string
  readonly notice?: string
}

/** Per-session unsaved UI buffers; the filesystem remains the source of book state. */
export function createEditorStore(reveal?: (sessionId: string) => void) {
  const sessions = new Map<string, SessionEditor>()
  const listeners = new Set<() => void>()
  const openSequence = new Map<string, number>()
  const readSequence = new Map<string, number>()
  const moved = new Set<(id: string, previous: StudyDocument, next: StudyDocument) => void>()
  const discarded = new Set<(id: string, key: string) => void>()
  const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let live = true
  const get = (id: string): SessionEditor => {
    let current = sessions.get(id)
    if (!current) { current = { buffers: {}, mode: 'read', selection: '', refresh: 0 }; sessions.set(id, current) }
    return current
  }
  const update = (id: string, patch: Partial<SessionEditor>) => {
    if (!live) return
    sessions.set(id, { ...get(id), ...patch }); listeners.forEach(listener => listener())
  }
  const updateBuffer = (id: string, key: string, patch: Partial<BufferState>) => {
    const state = get(id), existing = state.buffers[key]
    if (existing) update(id, { buffers: { ...state.buffers, [key]: { ...existing, ...patch } } })
  }
  const failure = (error: unknown) => ({ error: error instanceof Error ? error.message : '操作失败', errorCode: error instanceof StudyApiError ? error.code : 'network' })
  const receive = (id: string, document: StudyDocument) => {
    const key = fileKey(document.ref), current = get(id).buffers[key]
    if (!current) { update(id, { buffers: { ...get(id).buffers, [key]: { document, text: document.body } } }); return }
    if (current.saving || current.attempt) return
    if (current.document.hash === document.hash) { if (current.disk) updateBuffer(id, key, { disk: undefined }); return }
    if (current.text !== current.document.body) updateBuffer(id, key, { disk: document })
    else updateBuffer(id, key, { document, text: document.body, disk: undefined, saved: undefined, error: undefined, errorCode: undefined })
  }
  const reload = async (id: string, key: string) => {
    const buffer = get(id).buffers[key]
    if (!buffer || buffer.saving || buffer.attempt) return
    const token = id + ':' + key, seq = (readSequence.get(token) ?? 0) + 1
    readSequence.set(token, seq)
    try {
      const document = await callStudy<StudyDocument>(id, 'read', { ref: buffer.document.ref })
      if (live && readSequence.get(token) === seq && get(id).buffers[key]?.document === buffer.document) receive(id, document)
    } catch (error) { if (live && readSequence.get(token) === seq && get(id).buffers[key]) updateBuffer(id, key, failure(error)) }
  }
  return {
    get, update, updateBuffer, receive, reload,
    onMove(listener: (id: string, previous: StudyDocument, next: StudyDocument) => void) { moved.add(listener); return () => { moved.delete(listener) } },
    onDiscard(listener: (id: string, key: string) => void) { discarded.add(listener); return () => { discarded.delete(listener) } },
    refresh(id: string) { update(id, { refresh: get(id).refresh + 1 }); return Promise.all(Object.keys(get(id).buffers).map(key => reload(id, key))) },
    invalidate(id: string) {
      if (!live || refreshTimers.has(id)) return
      refreshTimers.set(id, setTimeout(() => {
        refreshTimers.delete(id)
        if (!live) return
        update(id, { refresh: get(id).refresh + 1 })
        for (const key of Object.keys(get(id).buffers)) void reload(id, key)
      }, 250))
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    hasUnsaved() { return [...sessions.values()].some(state => Object.values(state.buffers).some(buffer => buffer.text !== buffer.document.body || buffer.saving || buffer.attempt)) },
    async open(id: string, ref: FileRef) {
      const sequence = (openSequence.get(id) ?? 0) + 1
      openSequence.set(id, sequence)
      let key = fileKey(ref)
      update(id, { error: undefined, notice: undefined })
      try {
        if (!get(id).buffers[key]) {
          const document = await callStudy<StudyDocument>(id, 'read', { ref })
          if (!live || openSequence.get(id) !== sequence) return
          key = fileKey(document.ref)
          if (!get(id).buffers[key]) update(id, { buffers: { ...get(id).buffers, [key]: { document, text: document.body } } })
        }
        if (openSequence.get(id) === sequence) {
          update(id, { current: key, mode: 'read', selection: '' })
          reveal?.(id)
        }
      } catch (error) {
        if (live && openSequence.get(id) === sequence) update(id, { error: failure(error).error })
      }
    },
    async save(id: string, key: string, accepted: readonly string[] = []) {
      const buffer = get(id).buffers[key]
      if (!buffer || buffer.saving || buffer.document.readOnly || !buffer.attempt && buffer.text === buffer.document.body) return
      const attempt = buffer.attempt ?? {
        operationId: crypto.randomUUID(), hash: buffer.document.hash, body: buffer.text, ref: buffer.document.ref,
        ...(accepted.length ? { accepted: [...accepted] } : {}),
      }
      updateBuffer(id, key, { saving: true, error: undefined, errorCode: undefined, attempt })
      try {
        const saved = await callStudy<StudySave>(id, 'save', attempt)
        if (!live) return
        const state = get(id), latest = state.buffers[key]
        if (!latest) return
        const nextKey = fileKey(saved.document.ref)
        const target = state.buffers[nextKey]
        if (nextKey !== key && target && (target.text !== target.document.body || target.saving || target.attempt)) {
          updateBuffer(id, key, { saving: false, saved, errorCode: 'conflict',
            error: '原保存已完成，但目标稿已有未合并的编辑或保存请求；两份文字均已保留。请先处理目标稿，再重试原保存。' })
          return
        }
        const buffers = { ...state.buffers }
        delete buffers[key]
        buffers[nextKey] = {
          document: saved.document, text: latest.text === attempt.body ? saved.document.body : latest.text, saved,
          ...(attempt.accepted?.length ? { accepted: attempt.accepted } : {}),
          ...(latest.mode ? { mode: latest.mode } : {}),
        }
        update(id, { buffers, current: state.current === key ? nextKey : state.current, refresh: state.refresh + 1, selection: '', notice: saved.changed ? '文档已保存' : '文档没有变化' })
        if (nextKey !== key) for (const listener of moved) listener(id, buffer.document, saved.document)
      } catch (error) {
        const refused = error instanceof StudyApiError && ['conflict', 'invalid-path', 'invalid-document', 'not-found', 'read-only', 'forbidden'].includes(error.code)
        if (live) updateBuffer(id, key, { saving: false, ...failure(error), ...(refused ? { attempt: undefined } : {}) })
      }
    },
    async compare(id: string, key: string) {
      const buffer = get(id).buffers[key]
      if (!buffer) return
      try {
        const disk = await callStudy<StudyDocument>(id, 'read', { ref: buffer.document.ref })
        if (live) updateBuffer(id, key, { disk, error: undefined })
      } catch (error) { if (live) updateBuffer(id, key, failure(error)) }
    },
    useDisk(id: string, key: string, keepEdits: boolean) {
      const buffer = get(id).buffers[key]
      if (!buffer?.disk || buffer.saving) return
      updateBuffer(id, key, { document: buffer.disk, text: keepEdits ? buffer.text : buffer.disk.body, disk: undefined, attempt: undefined, error: undefined, errorCode: undefined })
    },
    async retry(id: string, key: string, kind: 'notify' | 'retry-commit') {
      const buffer = get(id).buffers[key]
      if (!buffer?.saved || buffer.saving) return
      updateBuffer(id, key, { saving: true, error: undefined })
      try {
        const result = await callStudy<{ notification?: StudySave['notification']; notificationError?: string; ok?: boolean; reason?: string }>(id, kind, {
          ref: buffer.document.ref, hash: buffer.document.hash, operationId: buffer.saved.operationId,
          ...(kind === 'notify' && buffer.accepted?.length ? { accepted: buffer.accepted } : {}),
        })
        const latest = get(id).buffers[key]
        if (!live || !latest?.saved) return
        const saved = kind === 'notify'
          ? { ...latest.saved, notification: result.notification ?? 'failed', notificationError: result.notificationError }
          : { ...latest.saved, commit: result.ok ? 'saved' as const : 'failed' as const, commitError: result.reason }
        updateBuffer(id, key, { saving: false, saved })
      } catch (error) { if (live) updateBuffer(id, key, { saving: false, ...failure(error) }) }
    },
    cancelOpen(id: string) { openSequence.set(id, (openSequence.get(id) ?? 0) + 1); update(id, { selection: '' }) },
    close(id: string, key: string): boolean {
      const state = get(id), buffer = state.buffers[key]
      if (!buffer || buffer.saving) return false
      if ((buffer.text !== buffer.document.body || buffer.attempt) && !window.confirm('这份文档还有未保存或尚未确认的修改，确认关闭？')) return false
      const buffers = { ...state.buffers }
      delete buffers[key]
      const current = state.current === key ? Object.keys(buffers).at(-1) : state.current
      update(id, { buffers, current, selection: '' })
      for (const listener of discarded) listener(id, key)
      return true
    },
    dispose() { live = false; for (const timer of refreshTimers.values()) clearTimeout(timer); refreshTimers.clear(); listeners.clear(); moved.clear(); discarded.clear(); sessions.clear(); openSequence.clear(); readSequence.clear() },
  }
}
export type EditorStore = ReturnType<typeof createEditorStore>
