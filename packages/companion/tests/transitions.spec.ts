import { describe, expect, it } from 'vitest'
import { afterClip, isCurrentAction, returnSpeed } from '../src/transitions'

describe('gesture return before action changes', () => {
  it('puts the pen away before celebration, waiting or interaction', () => {
    for (const action of ['complete', 'waiting', 'interact'] as const) {
      expect(isCurrentAction('writing-loop', action)).toBe(false)
      expect(afterClip('writing-loop', action)).toBe('writing-exit')
      expect(afterClip('writing-exit', action)).toBe(action)
    }
  })
  it('keeps continuous writing and uses the latest state after a return', () => {
    expect(isCurrentAction('writing-enter', 'writing')).toBe(true)
    expect(afterClip('writing-enter', 'writing')).toBe('writing-loop')
    expect(afterClip('writing-loop', 'writing')).toBe('writing-loop')
    expect(afterClip('rest', 'thinking')).toBe('thinking')
    expect(afterClip('writing-exit', 'writing')).toBe('writing-enter')
  })
  it('bounds return speed and handles unready or ended media', () => {
    expect(returnSpeed(5, 4.8)).toBe(1)
    expect(returnSpeed(6, 0)).toBe(8)
    expect(returnSpeed(NaN, 0)).toBe(1)
  })
})
