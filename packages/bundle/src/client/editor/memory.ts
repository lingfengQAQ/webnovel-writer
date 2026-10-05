import type { EditorState } from '@codemirror/state'
import type { StudyDocument } from '../../study/types'
import { fileKey } from '../store'
import { nextSaveToast, type AnnouncedSave, type SaveToastSource } from './save-toast'

const identityOf = (sessionId: string, document: StudyDocument) => sessionId + ':' + fileKey(document.ref)

/** EditorState cache keyed by session and document. `move` follows a save that creates a new draft path. */
export class EditorMemory {
  private readonly states = new Map<string, EditorState>()
  /** The view still owns the old key; its next `set` lands on the new draft. */
  private readonly pending = new Map<string, string>()
  private announced: ReadonlyMap<string, AnnouncedSave> = new Map()

  get(key: string): EditorState | undefined {
    return this.states.get(key)
  }

  set(key: string, state: EditorState): void {
    const next = this.pending.get(key)
    if (next) this.pending.delete(key)
    this.states.delete(key)
    this.states.set(next ?? key, state)
  }

  delete(key: string): void {
    this.pending.delete(key)
    this.states.delete(key)
  }

  clear(): void {
    this.pending.clear()
    this.states.clear()
    this.announced = new Map()
  }

  /** 记下这次保存已经提示到哪一步。调用方若在提示落地前卸载，应 undo，让下一个实例再提示一次。 */
  noteSave(saved: SaveToastSource | undefined): { readonly text?: string; undo(): void } {
    const before = this.announced
    const result = nextSaveToast(saved, before)
    this.announced = result.announced
    const applied = result.announced
    return {
      ...(result.text ? { text: result.text } : {}),
      undo: () => { if (this.announced === applied) this.announced = before },
    }
  }

  move(sessionId: string, from: StudyDocument, to: StudyDocument): void {
    const previous = identityOf(sessionId, from)
    const next = identityOf(sessionId, to)
    if (previous === next) return
    this.pending.set(previous, next)
    const state = this.states.get(previous)
    if (!state) return
    this.states.delete(previous)
    this.states.set(next, state)
  }
}
