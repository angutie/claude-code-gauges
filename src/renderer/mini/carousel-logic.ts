/**
 * Pure carousel math and wheel-gesture handling for the mini window.
 * Deliberately free of DOM types so it compiles under the node tsconfig and is unit-testable.
 */

/** Direction of a carousel move: -1 = previous, 0 = stay, +1 = next. */
export type CarouselStep = -1 | 0 | 1

/** Returns the index reached by moving `dir` from `current`, wrapping seamlessly in both directions. */
export function nextIndex(current: number, dir: number, count: number): number {
  if (count <= 0) return 0
  return (((current + dir) % count) + count) % count
}

/** The indices rendered around the current screen (prev / current / next). */
export interface VisibleSlots {
  prev: number
  current: number
  next: number
}

/** Returns the prev/current/next indices for `index`, wrapping at both ends. */
export function visibleSlots(index: number, count: number): VisibleSlots {
  const current = nextIndex(index, 0, count)
  return {
    prev: nextIndex(current, -1, count),
    current,
    next: nextIndex(current, 1, count)
  }
}

/** Tuning for the wheel accumulator. */
export interface WheelOptions {
  /** Accumulated horizontal delta (px) required to move one screen. */
  threshold: number
  /** Minimum time after a move before another move may fire (covers the slide transition). */
  cooldownMs: number
  /** Idle time after which subsequent wheel events are treated as a new gesture. */
  gestureGapMs: number
}

export const DEFAULT_WHEEL_OPTIONS: WheelOptions = {
  threshold: 60,
  cooldownMs: 450,
  gestureGapMs: 180
}

/** The subset of a wheel event the reducer needs, plus a timestamp. */
export interface WheelInput {
  deltaX: number
  deltaY: number
  shiftKey: boolean
  /** 0 = pixels, 1 = lines, 2 = pages (as in `WheelEvent.deltaMode`). Defaults to pixels. */
  deltaMode?: number
  /** Event time in ms (e.g. `event.timeStamp` or `performance.now()`). */
  timeMs: number
}

/** Accumulator state carried between wheel events. */
export interface WheelState {
  /** Horizontal delta accumulated in the current gesture. */
  accumulated: number
  /** No move may fire before this time. */
  lockedUntil: number
  /** True once the current gesture has produced a move; cleared when a new gesture starts. */
  gestureConsumed: boolean
  /** Time of the last horizontal wheel event, or null before the first one. */
  lastEventMs: number | null
}

export function createWheelState(): WheelState {
  return { accumulated: 0, lockedUntil: 0, gestureConsumed: false, lastEventMs: null }
}

export interface WheelResult {
  state: WheelState
  step: CarouselStep
}

const LINE_HEIGHT_PX = 16
const PAGE_WIDTH_PX = 400

/** Normalizes a delta to pixels according to `deltaMode`. */
function toPixels(delta: number, deltaMode: number | undefined): number {
  if (deltaMode === 1) return delta * LINE_HEIGHT_PX
  if (deltaMode === 2) return delta * PAGE_WIDTH_PX
  return delta
}

/**
 * Extracts the horizontal scroll delta from a wheel event. Shift + vertical wheel is treated as
 * horizontal; a plain vertical scroll yields 0 so it never moves the carousel.
 */
export function horizontalDelta(input: Omit<WheelInput, 'timeMs'>): number {
  const dx = toPixels(input.deltaX, input.deltaMode)
  const dy = toPixels(input.deltaY, input.deltaMode)
  if (input.shiftKey) return dx !== 0 ? dx : dy
  return Math.abs(dx) > Math.abs(dy) ? dx : 0
}

/**
 * Wheel accumulator reducer. Small deltas accumulate until `threshold` is crossed, then a single
 * ±1 step is emitted. Further events in the same gesture (including trackpad inertia) are ignored,
 * and no step fires again until the cooldown has elapsed and a new gesture has begun.
 */
export function reduceWheel(
  state: WheelState,
  input: WheelInput,
  options: WheelOptions = DEFAULT_WHEEL_OPTIONS
): WheelResult {
  const delta = horizontalDelta(input)
  if (delta === 0) return { state, step: 0 }

  const now = input.timeMs
  const isNewGesture = state.lastEventMs === null || now - state.lastEventMs > options.gestureGapMs
  let accumulated = isNewGesture ? 0 : state.accumulated
  const gestureConsumed = isNewGesture ? false : state.gestureConsumed

  if (gestureConsumed || now < state.lockedUntil) {
    return {
      state: { ...state, accumulated: 0, gestureConsumed, lastEventMs: now },
      step: 0
    }
  }

  // A reversal within a gesture starts accumulating afresh in the new direction.
  if (accumulated !== 0 && Math.sign(accumulated) !== Math.sign(delta)) accumulated = 0
  accumulated += delta

  if (Math.abs(accumulated) >= options.threshold) {
    return {
      state: {
        accumulated: 0,
        lockedUntil: now + options.cooldownMs,
        gestureConsumed: true,
        lastEventMs: now
      },
      step: accumulated > 0 ? 1 : -1
    }
  }

  return {
    state: { ...state, accumulated, gestureConsumed, lastEventMs: now },
    step: 0
  }
}
