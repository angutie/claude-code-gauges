import { describe, expect, it } from 'vitest'
import type { SessionInfo } from '../src/shared/types'
import {
  BASE_SPAWN_INTERVAL_MS,
  DEFAULT_EFFORT_WEIGHT,
  MAX_SPAWN_INTERVAL_MS,
  MIN_SPAWN_INTERVAL_MS,
  effortWeight,
  folderSpawnIntervalMs
} from '../src/renderer/mini/spawn-rate'

type SpawnSession = Pick<SessionInfo, 'status' | 'effort'>

function busy(effort: SessionInfo['effort'] = 'medium'): SpawnSession {
  return { status: 'busy', effort }
}

describe('effortWeight', () => {
  it('maps known effort levels', () => {
    expect(effortWeight('low')).toBe(1)
    expect(effortWeight('medium')).toBe(2)
    expect(effortWeight('high')).toBe(3)
    expect(effortWeight('max')).toBe(4)
  })

  it('is case- and whitespace-insensitive', () => {
    expect(effortWeight(' HIGH ')).toBe(3)
  })

  it('falls back to the default weight for null and unknown values', () => {
    expect(DEFAULT_EFFORT_WEIGHT).toBe(2)
    expect(effortWeight(null)).toBe(2)
    expect(effortWeight('ultra')).toBe(2)
    expect(effortWeight('')).toBe(2)
    expect(effortWeight('toString')).toBe(2)
  })
})

describe('folderSpawnIntervalMs', () => {
  it('returns null with no sessions', () => {
    expect(folderSpawnIntervalMs([])).toBeNull()
  })

  it('returns null when no session is busy', () => {
    expect(
      folderSpawnIntervalMs([
        { status: 'idle', effort: 'max' },
        { status: 'waiting', effort: 'high' },
        { status: 'unknown', effort: 'max' }
      ])
    ).toBeNull()
  })

  it('only counts busy sessions', () => {
    const alone = folderSpawnIntervalMs([busy('high')])
    const withIdle = folderSpawnIntervalMs([busy('high'), { status: 'idle', effort: 'max' }])
    expect(withIdle).toBe(alone)
  })

  it('shortens the interval as more sessions are busy', () => {
    const one = folderSpawnIntervalMs([busy('low')])!
    const two = folderSpawnIntervalMs([busy('low'), busy('low')])!
    const three = folderSpawnIntervalMs([busy('low'), busy('low'), busy('low')])!
    expect(two).toBeLessThan(one)
    expect(three).toBeLessThan(two)
  })

  it('shortens the interval as effort increases', () => {
    const intervals = (['low', 'medium', 'high', 'max'] as const).map(
      (effort) => folderSpawnIntervalMs([busy(effort)])!
    )
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]).toBeLessThan(intervals[i - 1]!)
    }
  })

  it('scales inversely with total effort weight', () => {
    expect(folderSpawnIntervalMs([busy('low')])).toBe(BASE_SPAWN_INTERVAL_MS)
    expect(folderSpawnIntervalMs([busy('medium')])).toBe(BASE_SPAWN_INTERVAL_MS / 2)
    expect(folderSpawnIntervalMs([busy('low'), busy('high')])).toBe(BASE_SPAWN_INTERVAL_MS / 4)
  })

  it('clamps to the minimum interval with many high-effort sessions', () => {
    const many = Array.from({ length: 50 }, () => busy('max'))
    expect(folderSpawnIntervalMs(many)).toBe(MIN_SPAWN_INTERVAL_MS)
  })

  it('never exceeds the maximum interval', () => {
    const interval = folderSpawnIntervalMs([busy('low')])!
    expect(interval).toBeLessThanOrEqual(MAX_SPAWN_INTERVAL_MS)
    expect(interval).toBeGreaterThanOrEqual(MIN_SPAWN_INTERVAL_MS)
  })

  it('returns whole milliseconds', () => {
    expect(Number.isInteger(folderSpawnIntervalMs([busy('high')]))).toBe(true)
  })
})
