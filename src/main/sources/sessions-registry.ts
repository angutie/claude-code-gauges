import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { EpochMs, SessionInfo, SessionStatus } from '../../shared/types'

/**
 * Scans the live sessions registry: `<configDir>/sessions/<pid>.json`.
 *
 * Each running Claude Code process writes one JSON file. Files can outlive
 * their process, so dead PIDs are filtered out with an injectable liveness
 * check. `<pid>.<hash>.key` files in the same folder are IPC secrets and are
 * never opened.
 */

export const SESSIONS_DIR_NAME = 'sessions'

export type IsAlive = (pid: number) => boolean

export interface ScanOptions {
  /** Liveness check; defaults to `process.kill(pid, 0)`. */
  isAlive?: IsAlive
}

const KNOWN_STATUSES: readonly SessionStatus[] = ['busy', 'idle', 'waiting']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function optionalEpoch(value: unknown): EpochMs | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseStatus(value: unknown): SessionStatus {
  return KNOWN_STATUSES.includes(value as SessionStatus) ? (value as SessionStatus) : 'unknown'
}

/**
 * Separator-agnostic basename, so Windows cwds parse correctly regardless of
 * the platform the code runs on (e.g. tests on Linux CI).
 */
export function repoNameFromCwd(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || trimmed
}

/** True when the process exists. EPERM means it exists but belongs to another user. */
export const defaultIsAlive: IsAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

/** Registry files are `<name>.json`; `.key` files and anything else are ignored. */
export function isSessionFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.json')
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Parses one registry record; returns null when required fields are missing. */
export function parseSessionRecord(raw: unknown): SessionInfo | null {
  if (!isRecord(raw)) return null

  const pid = raw.pid
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null

  const sessionId = optionalString(raw.sessionId)
  const cwd = optionalString(raw.cwd)
  if (!sessionId || !cwd) return null

  const status = parseStatus(raw.status)

  return {
    pid,
    sessionId,
    cwd,
    repoName: repoNameFromCwd(cwd),
    title: optionalString(raw.name),
    status,
    waitingFor: status === 'waiting' ? optionalString(raw.waitingFor) : null,
    entrypoint: optionalString(raw.entrypoint),
    version: optionalString(raw.version),
    startedAt: optionalEpoch(raw.startedAt),
    updatedAt: optionalEpoch(raw.updatedAt) ?? optionalEpoch(raw.statusUpdatedAt),
    model: null,
    effort: null,
    effortIsDefault: false,
    gitBranch: null,
    lastActivityAt: null
  }
}

/** Parses registry file contents; malformed JSON yields null instead of throwing. */
export function parseSessionFile(content: string): SessionInfo | null {
  try {
    return parseSessionRecord(JSON.parse(content))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

export function sessionsDirFor(configDir: string): string {
  return join(configDir, SESSIONS_DIR_NAME)
}

/**
 * Returns live sessions for a config dir, sorted by most recently started.
 * A missing sessions folder yields an empty list. Duplicate session ids keep
 * the most recently updated record.
 */
export async function scanSessions(
  configDir: string,
  options: ScanOptions = {}
): Promise<SessionInfo[]> {
  const isAlive = options.isAlive ?? defaultIsAlive
  const dir = sessionsDirFor(configDir)

  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }

  const parsed = await Promise.all(
    entries.filter(isSessionFileName).map(async (fileName) => {
      try {
        return parseSessionFile(await fs.readFile(join(dir, fileName), 'utf8'))
      } catch {
        return null
      }
    })
  )

  const bySessionId = new Map<string, SessionInfo>()
  for (const session of parsed) {
    if (!session || !safeIsAlive(isAlive, session.pid)) continue
    const existing = bySessionId.get(session.sessionId)
    if (!existing || (session.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
      bySessionId.set(session.sessionId, session)
    }
  }

  return [...bySessionId.values()].sort(
    (a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0) || a.pid - b.pid
  )
}

function safeIsAlive(isAlive: IsAlive, pid: number): boolean {
  try {
    return isAlive(pid)
  } catch {
    return false
  }
}
