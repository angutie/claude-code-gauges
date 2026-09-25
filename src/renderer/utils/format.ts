import type { EpochMs } from '../../shared/types'
import { gaugeLevel, USAGE_THRESHOLDS, type GaugeLevel } from '../theme'

export { gaugeLevel, USAGE_THRESHOLDS, type GaugeLevel }

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const pad2 = (n: number): string => String(n).padStart(2, '0')

function isFiniteNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value)
}

/** Clamps a utilization value into 0–100 for drawing; non-finite values become 0. */
export function clampPercent(percent: number | null | undefined): number {
  if (!isFiniteNumber(percent)) return 0
  return Math.min(100, Math.max(0, percent))
}

/** "42%" (rounded), or "unknown" when the server returned no value. */
export function formatPercent(percent: number | null | undefined): string {
  if (!isFiniteNumber(percent)) return 'unknown'
  return `${Math.round(percent)}%`
}

/**
 * Compact duration for countdowns:
 * - ≥ 1 day: "3d 04h"
 * - ≥ 1 hour: "2h 05m"
 * - ≥ 1 minute: "4m 09s"
 * - otherwise: "45s"
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / SECOND))
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) return `${days}d ${pad2(hours)}h`
  if (hours > 0) return `${hours}h ${pad2(minutes)}m`
  if (minutes > 0) return `${minutes}m ${pad2(seconds)}s`
  return `${seconds}s`
}

/** "resets in 2h 05m", "resetting…" once the reset time has passed, or null when unknown. */
export function formatResetCountdown(resetsAt: EpochMs | null | undefined, now: EpochMs): string | null {
  if (!isFiniteNumber(resetsAt)) return null
  const remaining = resetsAt - now
  if (remaining <= 0) return 'resetting…'
  return `resets in ${formatDuration(remaining)}`
}

/** "just now", "12 s ago", "3 min ago", "2 h ago", "4 d ago"; "never" when there is no timestamp. */
export function formatRelativeAge(since: EpochMs | null | undefined, now: EpochMs): string {
  if (!isFiniteNumber(since)) return 'never'
  const elapsed = Math.max(0, now - since)
  if (elapsed < 5 * SECOND) return 'just now'
  if (elapsed < MINUTE) return `${Math.floor(elapsed / SECOND)} s ago`
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`
  return `${Math.floor(elapsed / DAY)} d ago`
}

/** "last updated 12 s ago" / "never updated". */
export function formatLastUpdated(since: EpochMs | null | undefined, now: EpochMs): string {
  if (!isFiniteNumber(since)) return 'never updated'
  return `last updated ${formatRelativeAge(since, now)}`
}
