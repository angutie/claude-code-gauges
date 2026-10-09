import type { SessionInfo } from '../../shared/types'

/** Weight used for efforts that are missing or not one of the known levels. */
export const DEFAULT_EFFORT_WEIGHT = 2

/** Spawn interval for a total effort weight of 1 (one busy low-effort session). */
export const BASE_SPAWN_INTERVAL_MS = 12_000

/** Fastest allowed spawn interval, however many sessions are busy. */
export const MIN_SPAWN_INTERVAL_MS = 1_000

/** Slowest allowed spawn interval while at least one session is active. */
export const MAX_SPAWN_INTERVAL_MS = 12_000

const EFFORT_WEIGHTS: Readonly<Record<string, number>> = {
  low: 1,
  medium: 2,
  high: 3,
  max: 4
}

/**
 * Maps a session effort to its spawn weight: low=1, medium=2, high=3, max=4.
 * Unknown strings and null fall back to {@link DEFAULT_EFFORT_WEIGHT} (medium).
 */
export function effortWeight(effort: SessionInfo['effort']): number {
  if (typeof effort !== 'string') return DEFAULT_EFFORT_WEIGHT
  const key = effort.trim().toLowerCase()
  return Object.hasOwn(EFFORT_WEIGHTS, key) ? EFFORT_WEIGHTS[key]! : DEFAULT_EFFORT_WEIGHT
}

/**
 * Milliseconds between folder spawns in the pet playground, or `null` when
 * nothing should spawn.
 *
 * A session is **active** when its `status` is `'busy'` — i.e. Claude is
 * currently working on a turn. Idle, waiting (for user input/permission) and
 * unknown sessions do not contribute.
 *
 * The interval is `BASE_SPAWN_INTERVAL_MS / Σ effortWeight(active)`, so more
 * busy sessions and higher effort spawn folders faster. The result is clamped
 * to [`MIN_SPAWN_INTERVAL_MS`, `MAX_SPAWN_INTERVAL_MS`] and rounded to whole ms.
 */
export function folderSpawnIntervalMs(
  sessions: readonly Pick<SessionInfo, 'status' | 'effort'>[]
): number | null {
  let totalWeight = 0
  for (const session of sessions) {
    if (session.status === 'busy') totalWeight += effortWeight(session.effort)
  }
  if (totalWeight <= 0) return null
  const interval = BASE_SPAWN_INTERVAL_MS / totalWeight
  return Math.round(Math.min(MAX_SPAWN_INTERVAL_MS, Math.max(MIN_SPAWN_INTERVAL_MS, interval)))
}
