/**
 * Domain types shared between the main process and the renderer.
 *
 * These cross the IPC boundary, so they must NEVER carry secrets
 * (OAuth access/refresh tokens, IPC keys, auth headers). Credentials
 * stay inside the main process in their own, non-exported types.
 */

export { IPC_CHANNELS } from './ipc-channels'
export type { IpcChannel, IpcChannelKey } from './ipc-channels'

/** Milliseconds since the Unix epoch. */
export type EpochMs = number

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** A linked Claude Code account, identified by its config directory. */
export interface Account {
  id: string
  /** User-provided label; the UI falls back to the account email when empty. */
  label: string
  /** Absolute path to the Claude config dir (e.g. ~/.claude or a CLAUDE_CONFIG_DIR). */
  configDir: string
}

export const WIDGET_KEYS = [
  'sessions',
  'model',
  'effort',
  'usage5h',
  'usageWeekly',
  'branch',
  'status'
] as const

export type WidgetKey = (typeof WIDGET_KEYS)[number]

export type WidgetToggles = Record<WidgetKey, boolean>

/** Either every live session, or an explicit list of session ids. */
export type WatchedSessions = 'all' | string[]

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

export interface AppConfig {
  accounts: Account[]
  activeAccountId: string | null
  /** Watched sessions per account id; a missing entry means 'all'. */
  watchedSessionIds: Record<string, WatchedSessions>
  widgets: WidgetToggles
  usagePollSeconds: number
  alwaysOnTop: boolean
  windowBounds: WindowBounds | null
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type SessionStatus = 'busy' | 'idle' | 'waiting' | 'unknown'

export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

export type SessionEntrypoint = 'cli' | 'sdk-cli' | 'claude-desktop' | (string & {})

/** A live Claude Code session merged from the sessions registry and its transcript. */
export interface SessionInfo {
  pid: number
  sessionId: string
  cwd: string
  /** basename(cwd) */
  repoName: string
  /** Session title from the registry name or custom-title/agent-name transcript lines. */
  title: string | null
  status: SessionStatus
  waitingFor: string | null
  entrypoint: SessionEntrypoint | null
  version: string | null
  startedAt: EpochMs | null
  updatedAt: EpochMs | null
  /** Model id from the latest non-sidechain assistant line, e.g. "claude-opus-5-5". */
  model: string | null
  /** Effort from the transcript, or the settings.json default; free-form strings are kept as-is. */
  effort: EffortLevel | (string & {}) | null
  /** True when effort came from the settings.json fallback rather than the transcript. */
  effortIsDefault: boolean
  gitBranch: string | null
  lastActivityAt: EpochMs | null
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

/** One rate-limit window as reported by the usage API. */
export interface UsageWindow {
  /** Utilization 0–100, or null when the server has no value. */
  percent: number | null
  resetsAt: EpochMs | null
}

/**
 * - ok: fresh data
 * - loading: no result yet
 * - stale: last fetch failed (network/429); data shown is from lastSuccessAt
 * - expired: token expired or 401; user must run `claude` to refresh
 * - error: unrecoverable/unknown failure
 * - unavailable: no credentials found for the account
 */
export type UsageStatus = 'ok' | 'loading' | 'stale' | 'expired' | 'error' | 'unavailable'

export interface UsageSnapshot {
  status: UsageStatus
  fiveHour: UsageWindow | null
  weekly: UsageWindow | null
  weeklyOpus: UsageWindow | null
  weeklySonnet: UsageWindow | null
  lastSuccessAt: EpochMs | null
  lastAttemptAt: EpochMs | null
  nextPollAt: EpochMs | null
  /** Human-readable, secret-free message (e.g. "Token expired, run `claude` to refresh"). */
  message: string | null
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export type TokenStatus = 'valid' | 'expired' | 'missing'

/** Non-secret identity info read from .claude.json / .credentials.json. */
export interface AccountIdentity {
  email: string | null
  displayName: string | null
  organizationName: string | null
  subscriptionType: string | null
  tokenStatus: TokenStatus
  tokenExpiresAt: EpochMs | null
}

export interface AccountSnapshot {
  accountId: string
  identity: AccountIdentity | null
  /** Sessions filtered by the account's watched list. */
  sessions: SessionInfo[]
  /** Every live session, for the session picker. */
  availableSessions: SessionInfo[]
  usage: UsageSnapshot
  updatedAt: EpochMs
}

// ---------------------------------------------------------------------------
// IPC payloads
// ---------------------------------------------------------------------------

export type AddAccountResult =
  | { ok: true; account: Account; config: AppConfig }
  | { ok: false; cancelled?: boolean; error: string }
