import { useSyncExternalStore } from 'react'
import type { EpochMs } from '../../shared/types'

export interface Clock {
  /** Current time as of the last tick. */
  now(): EpochMs
  /** Subscribes to ticks. The timer only runs while at least one listener is attached. */
  subscribe(listener: () => void): () => void
}

/** A shared ticking clock so every countdown on screen updates on the same beat. */
export function createClock(intervalMs = 1000, readTime: () => EpochMs = Date.now): Clock {
  let current = readTime()
  let timer: ReturnType<typeof setInterval> | null = null
  const listeners = new Set<() => void>()

  const tick = (): void => {
    current = readTime()
    listeners.forEach((listener) => listener())
  }

  return {
    now: () => current,
    subscribe(listener) {
      listeners.add(listener)
      if (timer === null) {
        current = readTime()
        timer = setInterval(tick, intervalMs)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && timer !== null) {
          clearInterval(timer)
          timer = null
        }
      }
    }
  }
}

const secondClock = createClock(1000)

/** Current time, re-rendering the component once per second. */
export function useNow(clock: Clock = secondClock): EpochMs {
  return useSyncExternalStore(clock.subscribe, clock.now, clock.now)
}
