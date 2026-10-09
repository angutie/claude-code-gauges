import { describe, expect, it } from 'vitest'
import {
  createWheelState,
  horizontalDelta,
  nextIndex,
  reduceWheel,
  visibleSlots,
  type CarouselStep,
  type WheelInput,
  type WheelOptions,
  type WheelState
} from '../src/renderer/mini/carousel-logic'

const OPTIONS: WheelOptions = { threshold: 60, cooldownMs: 400, gestureGapMs: 150 }

function wheel(timeMs: number, deltaX: number, extra: Partial<WheelInput> = {}): WheelInput {
  return { deltaX, deltaY: 0, shiftKey: false, timeMs, ...extra }
}

/** Feeds a sequence of events through the reducer and returns the emitted steps. */
function run(
  inputs: WheelInput[],
  initial: WheelState = createWheelState()
): { steps: CarouselStep[]; state: WheelState } {
  let state = initial
  const steps: CarouselStep[] = []
  for (const input of inputs) {
    const result = reduceWheel(state, input, OPTIONS)
    state = result.state
    steps.push(result.step)
  }
  return { steps, state }
}

describe('nextIndex', () => {
  it('moves forward and backward within range', () => {
    expect(nextIndex(1, 1, 4)).toBe(2)
    expect(nextIndex(2, -1, 4)).toBe(1)
    expect(nextIndex(2, 0, 4)).toBe(2)
  })

  it('wraps last -> first and first -> last', () => {
    expect(nextIndex(3, 1, 4)).toBe(0)
    expect(nextIndex(0, -1, 4)).toBe(3)
  })

  it('handles multi-step and out-of-range input', () => {
    expect(nextIndex(0, -5, 4)).toBe(3)
    expect(nextIndex(9, 1, 4)).toBe(2)
  })

  it('returns 0 for an empty or single-screen carousel', () => {
    expect(nextIndex(0, 1, 0)).toBe(0)
    expect(nextIndex(0, 1, 1)).toBe(0)
    expect(nextIndex(0, -1, 1)).toBe(0)
  })
})

describe('visibleSlots', () => {
  it('returns prev/current/next around the index', () => {
    expect(visibleSlots(1, 4)).toEqual({ prev: 0, current: 1, next: 2 })
  })

  it('wraps at both ends', () => {
    expect(visibleSlots(0, 4)).toEqual({ prev: 3, current: 0, next: 1 })
    expect(visibleSlots(3, 4)).toEqual({ prev: 2, current: 3, next: 0 })
  })

  it('normalizes an out-of-range index', () => {
    expect(visibleSlots(-1, 4)).toEqual({ prev: 2, current: 3, next: 0 })
  })
})

describe('horizontalDelta', () => {
  it('uses deltaX for horizontal scrolls', () => {
    expect(horizontalDelta({ deltaX: 30, deltaY: 2, shiftKey: false })).toBe(30)
  })

  it('ignores plain vertical scrolls', () => {
    expect(horizontalDelta({ deltaX: 0, deltaY: 100, shiftKey: false })).toBe(0)
    expect(horizontalDelta({ deltaX: 5, deltaY: 100, shiftKey: false })).toBe(0)
  })

  it('treats shift + vertical wheel as horizontal', () => {
    expect(horizontalDelta({ deltaX: 0, deltaY: 100, shiftKey: true })).toBe(100)
    expect(horizontalDelta({ deltaX: 0, deltaY: -100, shiftKey: true })).toBe(-100)
  })

  it('normalizes line-mode deltas to pixels', () => {
    expect(horizontalDelta({ deltaX: 3, deltaY: 0, shiftKey: false, deltaMode: 1 })).toBe(48)
  })
})

describe('reduceWheel', () => {
  it('ignores small deltas below the threshold', () => {
    const { steps, state } = run([wheel(0, 10), wheel(16, 15), wheel(32, 20)])
    expect(steps).toEqual([0, 0, 0])
    expect(state.accumulated).toBe(45)
  })

  it('emits +1 once the accumulated delta crosses the threshold', () => {
    const { steps } = run([wheel(0, 30), wheel(16, 35)])
    expect(steps).toEqual([0, 1])
  })

  it('emits -1 for leftward scrolls', () => {
    const { steps } = run([wheel(0, -40), wheel(16, -40)])
    expect(steps).toEqual([0, -1])
  })

  it('advances only once per continuous gesture (trackpad inertia)', () => {
    const events = Array.from({ length: 60 }, (_, i) => wheel(i * 16, 40))
    const { steps } = run(events)
    expect(steps.filter((s) => s !== 0)).toEqual([1])
  })

  it('respects the cooldown even if a new gesture starts immediately', () => {
    const first = run([wheel(0, 100)])
    expect(first.steps).toEqual([1])
    // Gap > gestureGapMs (new gesture) but still inside the 400ms cooldown.
    const second = run([wheel(200, 100)], first.state)
    expect(second.steps).toEqual([0])
    // After the cooldown and another idle gap, a new gesture can advance again.
    const third = run([wheel(600, 100)], second.state)
    expect(third.steps).toEqual([1])
  })

  it('does not carry partial deltas over into a new gesture', () => {
    const { steps } = run([wheel(0, 50), wheel(500, 50)])
    expect(steps).toEqual([0, 0])
  })

  it('restarts accumulation when the direction reverses mid-gesture', () => {
    const { steps, state } = run([wheel(0, 50), wheel(16, -20)])
    expect(steps).toEqual([0, 0])
    expect(state.accumulated).toBe(-20)
  })

  it('treats shift + vertical wheel as horizontal input', () => {
    const { steps } = run([wheel(0, 0, { deltaY: 100, shiftKey: true })])
    expect(steps).toEqual([1])
  })

  it('ignores vertical wheel without shift and leaves state untouched', () => {
    const initial = createWheelState()
    const result = reduceWheel(initial, wheel(0, 0, { deltaY: 500 }), OPTIONS)
    expect(result.step).toBe(0)
    expect(result.state).toBe(initial)
  })

  it('is pure: does not mutate the input state', () => {
    const initial = createWheelState()
    const snapshot = { ...initial }
    reduceWheel(initial, wheel(0, 100), OPTIONS)
    expect(initial).toEqual(snapshot)
  })
})
