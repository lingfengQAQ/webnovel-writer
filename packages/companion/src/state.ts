export const actions = ['idle', 'thinking', 'writing', 'complete', 'interact', 'waiting', 'rest'] as const
export type Action = typeof actions[number]
export type Activity = 'idle' | 'thinking' | 'writing' | 'waiting'
export const labels: Record<Action, string> = { idle: '陪你写作', thinking: '正在构思', writing: '正在写作', complete: '本次生成完成', interact: '你好呀', waiting: '等你回应', rest: '休息一下' }
export const sizes = { small: 160, medium: 220, large: 300 } as const
export interface Position { x: number; y: number }
export interface Preferences { visible: boolean; size: keyof typeof sizes; position: Position | null }
export interface Snapshot { action: Action; label: string; busy: boolean; preferences: Preferences; mediaError: string }
export interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void }
const KEY = 'whale-companion:v1'
const defaults: Preferences = { visible: true, size: 'medium', position: null }

export function readPreferences(storage?: Storage): Preferences {
  try {
    const value: unknown = JSON.parse(storage?.getItem(KEY) ?? 'null')
    if (!value || typeof value !== 'object') return { ...defaults }
    const p = value as Partial<Preferences>
    const point = p.position
    return { visible: typeof p.visible === 'boolean' ? p.visible : true,
      size: p.size && Object.hasOwn(sizes, p.size) ? p.size : 'medium',
      position: point && Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: point.x, y: point.y } : null }
  } catch { return { ...defaults } }
}

export function constrain(position: Position | null, size: number, width: number, height: number): Position {
  const margin = 8
  const xMax = Math.max(margin, width - size * .75 - margin)
  const yMax = Math.max(margin, height - size - margin)
  return { x: Math.min(xMax, Math.max(margin, position?.x ?? width - size * .75 - 28)),
    y: Math.min(yMax, Math.max(margin, position?.y ?? height - size - 115)) }
}

/** Local presentation only. This store never sends a Host command or a model request. */
export class CompanionStore {
  private listeners = new Set<() => void>()
  private activity: Activity = 'idle'
  private activityLabel = labels.idle
  private transient: Action | undefined
  private rest = false
  private restingTimer: ReturnType<typeof setTimeout> | undefined
  private transientTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private value: Snapshot
  constructor(private readonly storage?: Storage) {
    this.value = { action: 'idle', label: labels.idle, busy: false, preferences: readPreferences(storage), mediaError: '' }
    this.touch()
  }
  getSnapshot = (): Snapshot => this.value
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish() {
    if (this.disposed) return
    const busy = this.activity !== 'idle'
    const action = busy ? this.activity : this.transient ?? (this.rest ? 'rest' : 'idle')
    this.value = { ...this.value, action, busy, label: action === this.activity ? this.activityLabel : labels[action] }
    for (const listener of this.listeners) listener()
  }
  setActivity(activity: Activity, label = labels[activity]) {
    if (this.activity === activity && this.activityLabel === label) return
    this.activity = activity; this.activityLabel = label
    if (activity !== 'idle') { this.rest = false; this.clearTransient(); clearTimeout(this.restingTimer) }
    else this.touch()
    this.publish()
  }
  reset() { this.clearTransient(); this.rest = false; this.activity = 'idle'; this.activityLabel = labels.idle; this.touch(); this.publish() }
  complete() { if (this.activity === 'idle') this.preview('complete') }
  preview(action: Action) {
    if (this.activity !== 'idle') return
    this.clearTransient(); this.rest = false; this.transient = action
    this.transientTimer = setTimeout(() => this.finishPreview(), action === 'writing' ? 15000 : action === 'rest' ? 8500 : 5100)
    this.touch(); this.publish()
  }
  finishPreview() { this.clearTransient(); this.touch(); this.publish() }
  private clearTransient() { clearTimeout(this.transientTimer); this.transientTimer = undefined; this.transient = undefined }
  touch = () => {
    if (this.disposed) return
    clearTimeout(this.restingTimer)
    const wasRest = this.rest
    this.rest = false
    if (this.activity === 'idle') this.restingTimer = setTimeout(() => { this.rest = true; this.clearTransient(); this.publish() }, 120000)
    if (wasRest) this.publish()
  }
  sleep() { if (this.activity !== 'idle') return; clearTimeout(this.restingTimer); this.clearTransient(); this.rest = true; this.publish() }
  preferences(change: Partial<Preferences>) {
    this.value = { ...this.value, preferences: { ...this.value.preferences, ...change } }
    try { this.storage?.setItem(KEY, JSON.stringify(this.value.preferences)) } catch { /* Browser storage can be disabled. */ }
    this.publish()
  }
  mediaError(message: string) { if (this.value.mediaError !== message) { this.value = { ...this.value, mediaError: message }; this.publish() } }
  dispose() { this.disposed = true; clearTimeout(this.restingTimer); this.clearTransient(); this.listeners.clear() }
}
