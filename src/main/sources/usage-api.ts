import type { EpochMs, UsageSnapshot, UsageWindow } from '../../shared/types'
import { isTokenExpired, type CredentialReader } from './account-reader'

/**
 * Adapter for Claude Code's (undocumented) OAuth usage endpoint, which backs
 * the "Session (5h)" and "Weekly" gauges.
 *
 * SECURITY: the bearer token and request headers are never logged, stored on
 * returned objects, or included in messages. Response bodies are never echoed.
 */

export const USAGE_API_URL = 'https://api.anthropic.com/api/oauth/usage'
export const USAGE_API_BETA = 'oauth-2025-04-20'
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
export const DEFAULT_MAX_BACKOFF_MS = 30 * 60_000

export const EXPIRED_MESSAGE = 'Token expired, run `claude` to refresh'

/** Minimal fetch signature so tests (and non-global implementations) can be injected. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; signal?: AbortSignal }
) => Promise<{ status: number; ok: boolean; headers?: { get(name: string): string | null }; json(): Promise<unknown> }>

export interface UsageWindows {
  fiveHour: UsageWindow | null
  weekly: UsageWindow | null
  weeklyOpus: UsageWindow | null
  weeklySonnet: UsageWindow | null
}

export type FetchUsageResult =
  | { kind: 'ok'; windows: UsageWindows }
  | { kind: 'expired' }
  | { kind: 'rate-limited'; retryAfterMs: number | null }
  | { kind: 'error'; message: string }

// ---------------------------------------------------------------------------
// Response mapping
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseTimestamp(value: unknown): EpochMs | null {
  if (typeof value === 'string' && value.trim() !== '') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Accept epoch seconds as well as epoch ms.
    return value < 1e12 ? value * 1000 : value
  }
  return null
}

/** Maps `{ utilization, resets_at }` to a UsageWindow; absent/invalid input yields null. */
export function mapUsageWindow(raw: unknown): UsageWindow | null {
  if (!isRecord(raw)) return null
  const utilization = raw['utilization']
  const percent = typeof utilization === 'number' && Number.isFinite(utilization) ? utilization : null
  return { percent, resetsAt: parseTimestamp(raw['resets_at']) }
}

export function mapUsageResponse(raw: unknown): UsageWindows {
  const body = isRecord(raw) ? raw : {}
  return {
    fiveHour: mapUsageWindow(body['five_hour']),
    weekly: mapUsageWindow(body['seven_day']),
    weeklyOpus: mapUsageWindow(body['seven_day_opus']),
    weeklySonnet: mapUsageWindow(body['seven_day_sonnet'])
  }
}

/** Parses a Retry-After header (delta-seconds or HTTP date). */
export function parseRetryAfter(value: string | null | undefined, now: EpochMs = Date.now()): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000)
  const date = Date.parse(trimmed)
  return Number.isFinite(date) ? Math.max(0, date - now) : null
}

// ---------------------------------------------------------------------------
// Single request
// ---------------------------------------------------------------------------

export interface FetchUsageOptions {
  fetch?: FetchLike
  timeoutMs?: number
  now?: () => EpochMs
}

function defaultFetch(): FetchLike {
  return globalThis.fetch as unknown as FetchLike
}

export async function fetchUsage(accessToken: string, options: FetchUsageOptions = {}): Promise<FetchUsageResult> {
  const doFetch = options.fetch ?? defaultFetch()
  const now = options.now ?? Date.now
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)

  try {
    const response = await doFetch(USAGE_API_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': USAGE_API_BETA,
        Accept: 'application/json'
      },
      signal: controller.signal
    })

    if (response.status === 401) return { kind: 'expired' }
    if (response.status === 429) {
      return { kind: 'rate-limited', retryAfterMs: parseRetryAfter(response.headers?.get('retry-after'), now()) }
    }
    if (!response.ok) return { kind: 'error', message: `Usage API returned HTTP ${response.status}` }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      return { kind: 'error', message: 'Usage API returned invalid JSON' }
    }
    if (!isRecord(body)) return { kind: 'error', message: 'Usage API returned an unexpected response' }
    return { kind: 'ok', windows: mapUsageResponse(body) }
  } catch (error) {
    // Only the error class/name is surfaced; messages may include request details.
    const name = error instanceof Error ? error.name : 'Error'
    return {
      kind: 'error',
      message: name === 'AbortError' ? 'Usage API request timed out' : 'Network error contacting the usage API'
    }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

/** Exponential backoff: base * 2^failures, capped at maxMs. */
export function computeBackoffDelay(baseMs: number, failures: number, maxMs: number = DEFAULT_MAX_BACKOFF_MS): number {
  if (failures <= 0) return Math.min(baseMs, maxMs)
  return Math.min(baseMs * 2 ** Math.min(failures, 30), maxMs)
}

// ---------------------------------------------------------------------------
// Stateful poller (one per account)
// ---------------------------------------------------------------------------

export interface UsagePollerOptions extends FetchUsageOptions {
  configDir: string
  credentialReader: CredentialReader
  /** Normal poll interval in ms (usagePollSeconds * 1000). */
  pollIntervalMs: number
  maxBackoffMs?: number
}

export function emptyUsageSnapshot(): UsageSnapshot {
  return {
    status: 'loading',
    fiveHour: null,
    weekly: null,
    weeklyOpus: null,
    weeklySonnet: null,
    lastSuccessAt: null,
    lastAttemptAt: null,
    nextPollAt: null,
    message: null
  }
}

/**
 * Re-reads credentials on every poll (the CLI keeps them fresh; we never
 * refresh tokens ourselves), calls the usage API, and tracks backoff state.
 * Failures keep the last good windows so the UI can show them as stale.
 */
export class UsagePoller {
  private snapshot: UsageSnapshot = emptyUsageSnapshot()
  private failures = 0
  /** Server-requested minimum delay from the last 429's Retry-After header. */
  private retryAfterMs = 0
  private pollIntervalMs: number
  private readonly now: () => EpochMs

  constructor(private readonly options: UsagePollerOptions) {
    this.pollIntervalMs = options.pollIntervalMs
    this.now = options.now ?? Date.now
  }

  get current(): UsageSnapshot {
    return { ...this.snapshot }
  }

  /** Consecutive rate-limit/network failures driving the backoff. */
  get failureCount(): number {
    return this.failures
  }

  setPollInterval(ms: number): void {
    this.pollIntervalMs = ms
  }

  /** Delay before the next poll, including backoff and any Retry-After (both capped). */
  nextDelayMs(): number {
    const maxBackoff = this.options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
    const backoff = computeBackoffDelay(this.pollIntervalMs, this.failures, maxBackoff)
    return Math.max(backoff, Math.min(this.retryAfterMs, maxBackoff))
  }

  async poll(): Promise<UsageSnapshot> {
    const attemptAt = this.now()
    this.retryAfterMs = 0
    const credentials = await this.options.credentialReader
      .read(this.options.configDir)
      .catch(() => ({ status: 'unavailable' as const, reason: 'unreadable' as const, message: 'Credentials could not be read' }))

    if (credentials.status !== 'ok') {
      this.failures = 0
      return this.finish(attemptAt, { status: 'unavailable', message: credentials.message })
    }
    if (isTokenExpired(credentials.value, attemptAt)) {
      this.failures = 0
      return this.finish(attemptAt, { status: 'expired', message: EXPIRED_MESSAGE })
    }

    const result = await fetchUsage(credentials.value.accessToken, this.options)
    switch (result.kind) {
      case 'ok':
        this.failures = 0
        return this.finish(attemptAt, { ...result.windows, status: 'ok', message: null, lastSuccessAt: attemptAt })
      case 'expired':
        this.failures = 0
        return this.finish(attemptAt, { status: 'expired', message: EXPIRED_MESSAGE })
      case 'rate-limited': {
        this.failures += 1
        this.retryAfterMs = result.retryAfterMs ?? 0
        return this.finish(attemptAt, {
          status: this.staleOrError(),
          message: 'Rate limited by the usage API; backing off'
        })
      }
      case 'error':
        this.failures += 1
        return this.finish(attemptAt, { status: this.staleOrError(), message: result.message })
    }
  }

  private staleOrError(): UsageSnapshot['status'] {
    return this.snapshot.lastSuccessAt !== null ? 'stale' : 'error'
  }

  private finish(attemptAt: EpochMs, patch: Partial<UsageSnapshot>): UsageSnapshot {
    this.snapshot = { ...this.snapshot, ...patch, lastAttemptAt: attemptAt, nextPollAt: attemptAt + this.nextDelayMs() }
    return this.current
  }
}
