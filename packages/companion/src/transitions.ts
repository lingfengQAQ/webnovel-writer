import type { Action } from './state'
import type { Clip } from './media'

export const entryClip = (action: Action): Clip => action === 'writing' ? 'writing-enter' : action
export const isWriting = (clip: Clip) => clip === 'writing-enter' || clip === 'writing-loop'
export const isCurrentAction = (clip: Clip, action: Action) => clip === action || (action === 'writing' && isWriting(clip))
export const isLoop = (clip: Clip) => !['writing-enter', 'writing-exit', 'complete', 'interact'].includes(clip)

/** Finish the interrupted gesture before entering the latest requested action. */
export function afterClip(clip: Clip, requested: Action): Clip {
  if (isWriting(clip)) return requested === 'writing' ? 'writing-loop' : 'writing-exit'
  return entryClip(requested)
}

/** Return to the seated endpoint promptly, without seeking to a different pose. */
export function returnSpeed(duration: number, time: number): number {
  return Number.isFinite(duration) ? Math.max(1, Math.min(8, (duration - time) / .55)) : 1
}
