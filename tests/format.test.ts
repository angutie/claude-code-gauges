import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClock } from '../src/renderer/utils/clock'
import {
  clampPercent,
  formatDuration,
  formatLastUpdated,
  formatPercent,
  formatRelativeAge,
  formatResetCountdown,
  gaugeLevel
} from '../src/renderer/utils/format'

const S = 1000
const M = 60 * S
const H = 60 * M
const D = 24 * H
const NOW = 1_790_000_000_000

describe('gaugeLevel thresholds', () => {
  it.each([
    [0, 'normal'],
    [69.9, 'normal'],
    [70, 'warning'],
    [85, 'warning'],
    [90, 'warning'],
    [90.1, 'critical'],
    [100, 'critical'],
    [130, 'critical']
  ] as const)('%s percent is %s', (percent, level) => {
    expect(gaugeLevel(percent)).toBe(level)
  })

  it('treats null, undefined and NaN as unknown', () => {
    expect(gaugeLevel(null)).toBe('unknown')
    expect(gaugeLevel(undefined)).toBe('unknown')
    expect(gaugeLevel(Number.NaN)).toBe('unknown')
  })
})

describe('formatPercent / clampPercent', () => {
  it('rounds percentages and reports unknown for null', () => {
    expect(formatPercent(42.4)).toBe('42%')
    expect(formatPercent(99.5)).toBe('100%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(null)).toBe('unknown')
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('unknown')
  })

  it('clamps into 0–100 for drawing', () => {
    expect(clampPercent(-5)).toBe(0)
    expect(clampPercent(55)).toBe(55)
    expect(clampPercent(140)).toBe(100)
    expect(clampPercent(null)).toBe(0)
  })
})

describe('formatDuration', () => {
  it('uses the two most significant units', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(45 * S + 900)).toBe('45s')
    expect(formatDuration(4 * M + 9 * S)).toBe('4m 09s')
    expect(formatDuration(2 * H + 5 * M + 30 * S)).toBe('2h 05m')
    expect(formatDuration(3 * D + 4 * H + 10 * M)).toBe('3d 04h')
  })

  it('never goes negative', () => {
    expect(formatDuration(-10 * S)).toBe('0s')
  })
})

describe('formatResetCountdown', () => {
  it('counts down to resetsAt', () => {
    expect(formatResetCountdown(NOW + 2 * H + 5 * M, NOW)).toBe('resets in 2h 05m')
    expect(formatResetCountdown(NOW + 30 * S, NOW)).toBe('resets in 30s')
    expect(formatResetCountdown(NOW + 30 * S, NOW + S)).toBe('resets in 29s')
  })

  it('shows resetting once the reset time has passed', () => {
    expect(formatResetCountdown(NOW, NOW)).toBe('resetting…')
    expect(formatResetCountdown(NOW - M, NOW)).toBe('resetting…')
  })

  it('returns null when the reset time is unknown', () => {
    expect(formatResetCountdown(null, NOW)).toBeNull()
    expect(formatResetCountdown(undefined, NOW)).toBeNull()
  })
})

describe('formatRelativeAge / formatLastUpdated', () => {
  it('formats elapsed time', () => {
    expect(formatRelativeAge(NOW, NOW)).toBe('just now')
    expect(formatRelativeAge(NOW - 12 * S, NOW)).toBe('12 s ago')
    expect(formatRelativeAge(NOW - 3 * M - 10 * S, NOW)).toBe('3 min ago')
    expect(formatRelativeAge(NOW - 2 * H, NOW)).toBe('2 h ago')
    expect(formatRelativeAge(NOW - 4 * D, NOW)).toBe('4 d ago')
    expect(formatRelativeAge(NOW + 5 * S, NOW)).toBe('just now')
    expect(formatRelativeAge(null, NOW)).toBe('never')
  })

  it('prefixes last updated', () => {
    expect(formatLastUpdated(NOW - 20 * S, NOW)).toBe('last updated 20 s ago')
    expect(formatLastUpdated(null, NOW)).toBe('never updated')
  })
})

describe('createClock', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ticks every second while subscribed and stops when unsubscribed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const clock = createClock(1000)
    const listener = vi.fn()

    const unsubscribe = clock.subscribe(listener)
    expect(clock.now()).toBe(NOW)

    vi.advanceTimersByTime(1000)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(clock.now()).toBe(NOW + 1000)

    vi.advanceTimersByTime(3000)
    expect(listener).toHaveBeenCalledTimes(4)
    expect(clock.now()).toBe(NOW + 4000)

    unsubscribe()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('shares one timer across subscribers', () => {
    vi.useFakeTimers()
    const clock = createClock(1000)
    const a = clock.subscribe(() => {})
    const b = clock.subscribe(() => {})
    expect(vi.getTimerCount()).toBe(1)
    a()
    expect(vi.getTimerCount()).toBe(1)
    b()
    expect(vi.getTimerCount()).toBe(0)
  })
})
