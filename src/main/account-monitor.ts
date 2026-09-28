import { watch as chokidarWatch } from 'chokidar'
import type { Stats } from 'node:fs'
import type { Account, AccountSnapshot, EpochMs, UsageSnapshot, WatchedSessions } from '../shared/types'
import { AccountAggregator, createDefaultSources } from './aggregator'
import { clampPollSeconds } from './config-store'
import { FileCredentialReader, type CredentialReader } from './sources/account-reader'
import { sessionsDirFor, type IsAlive } from './sources/sessions-registry'
import { findTranscriptPath } from './sources/transcript-tail'
import { UsagePoller, type FetchLike } from './sources/usage-api'

/**
 * Runs the real-time loop for one account: file watchers on the sessions
 * registry and watched transcripts (debounced), a low-frequency safety rescan,
 * and a usage poll timer that follows usagePollSeconds plus the poller's backoff.
 */

export const DEFAULT_DEBOUNCE_MS = 300
export const DEFAULT_RESCAN_MS = 5_000
/** Focus-triggered refreshes closer together than this are ignored. */
export const DEFAULT_MIN_FOCUS_REFRESH_MS = 10_000

/** The subset of a chokidar FSWatcher the monitor relies on (injectable for tests). */
export interface WatcherLike {
  on(event: 'all', listener: (event: string, path: string) => void): unknown
  on(event: 'error', listener: (error: unknown) => void): unknown
  add(paths: string | string[]): unknown
  unwatch(paths: string | string[]): unknown
  close(): Promise<void>
}

export type WatcherKind = 'sessions' | 'transcripts'

export type WatchFactory = (paths: string[], kind: WatcherKind) => WatcherLike

/** The subset of UsagePoller the monitor uses. */
export interface UsagePollerLike {
  readonly current: UsageSnapshot
  readonly failureCount: number
  poll(): Promise<UsageSnapshot>
  nextDelayMs(): number
  setPollInterval(ms: number): void
}

export interface SnapshotBuilder {
  build(watched: WatchedSessions | undefined, usage: UsageSnapshot | null | undefined, now?: EpochMs): Promise<AccountSnapshot>
}

export interface AccountMonitorOptions {
  account: Account
  watched?: WatchedSessions
  usagePollSeconds: number
  onSnapshot: (snapshot: AccountSnapshot) => void
  /** Called for non-fatal failures (watcher errors, build failures). Never receives secrets. */
  onError?: (error: unknown) => void
  debounceMs?: number
  rescanMs?: number
  minFocusRefreshMs?: number
  /** Overrides for tests / alternate wiring. */
  builder?: SnapshotBuilder
  poller?: UsagePollerLike
  watch?: WatchFactory
  locateTranscript?: (configDir: string, sessionId: string) => Promise<string | null>
  credentialReader?: CredentialReader
  fetch?: FetchLike
  isAlive?: IsAlive
  now?: () => EpochMs
}

function isSessionJson(path: string): boolean {
  return path.toLowerCase().endsWith('.json')
}

/** Real chokidar watchers; the sessions watcher only reports top-level *.json files. */
export const defaultWatchFactory: WatchFactory = (paths, kind) => {
  if (kind === 'sessions') {
    return chokidarWatch(paths, {
      ignoreInitial: true,
      depth: 0,
      ignored: (path: string, stats?: Stats) => stats?.isFile() === true && !isSessionJson(path)
    })
  }
  return chokidarWatch(paths, { ignoreInitial: true, depth: 0 })
}

/** Snapshot content minus the build timestamp, used to suppress no-op emits. */
function fingerprint(snapshot: AccountSnapshot): string {
  const { updatedAt: _updatedAt, ...rest } = snapshot
  return JSON.stringify(rest)
}

export class AccountMonitor {
  readonly account: Account

  private watched: WatchedSessions | undefined
  private readonly builder: SnapshotBuilder
  private readonly poller: UsagePollerLike
  private readonly watchFactory: WatchFactory
  private readonly locateTranscript: (configDir: string, sessionId: string) => Promise<string | null>
  private readonly now: () => EpochMs
  private readonly debounceMs: number
  private readonly rescanMs: number
  private readonly minFocusRefreshMs: number

  private sessionsWatcher: WatcherLike | null = null
  private transcriptsWatcher: WatcherLike | null = null
  /** sessionId → transcript path currently being watched. */
  private readonly transcriptPaths = new Map<string, string>()

  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private rescanTimer: ReturnType<typeof setInterval> | null = null
  private usageTimer: ReturnType<typeof setTimeout> | null = null

  private building: Promise<AccountSnapshot | null> | null = null
  private rebuildQueued = false
  private polling: Promise<void> | null = null
  private lastFingerprint: string | null = null
  private lastSnapshot: AccountSnapshot | null = null
  private lastUsagePollAt: EpochMs | null = null
  private started = false
  private disposed = false

  constructor(private readonly options: AccountMonitorOptions) {
    this.account = options.account
    this.watched = options.watched
    this.now = options.now ?? Date.now
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.rescanMs = options.rescanMs ?? DEFAULT_RESCAN_MS
    this.minFocusRefreshMs = options.minFocusRefreshMs ?? DEFAULT_MIN_FOCUS_REFRESH_MS
    this.watchFactory = options.watch ?? defaultWatchFactory
    this.locateTranscript = options.locateTranscript ?? findTranscriptPath
    this.builder =
      options.builder ??
      new AccountAggregator(options.account, createDefaultSources(options.account.configDir, { isAlive: options.isAlive }))
    this.poller =
      options.poller ??
      new UsagePoller({
        configDir: options.account.configDir,
        credentialReader: options.credentialReader ?? new FileCredentialReader(),
        pollIntervalMs: clampPollSeconds(options.usagePollSeconds) * 1000,
        fetch: options.fetch,
        now: this.now
      })
  }

  /** Latest emitted snapshot, if any. */
  get snapshot(): AccountSnapshot | null {
    return this.lastSnapshot
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  /** Starts watchers and timers, emits an initial snapshot, and kicks off the first usage poll. */
  async start(): Promise<void> {
    if (this.started || this.disposed) return
    this.started = true

    this.sessionsWatcher = this.createWatcher([sessionsDirFor(this.account.configDir)], 'sessions')
    this.transcriptsWatcher = this.createWatcher([], 'transcripts')
    this.rescanTimer = setInterval(() => void this.refreshNow(), this.rescanMs)

    await this.refreshNow()
    await this.runUsagePoll()
  }

  /** Schedules a debounced snapshot rebuild. */
  scheduleRefresh(): void {
    if (this.disposed) return
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.refreshNow()
    }, this.debounceMs)
  }

  /**
   * Rebuilds the snapshot immediately. Concurrent calls are coalesced: a call
   * during a build queues exactly one follow-up build.
   */
  async refreshNow(): Promise<AccountSnapshot | null> {
    if (this.disposed) return null
    if (this.building) {
      this.rebuildQueued = true
      return this.building
    }
    this.building = this.buildLoop()
    try {
      return await this.building
    } finally {
      this.building = null
    }
  }

  /**
   * Polls usage now (e.g. on window focus) and reschedules the poll timer.
   * Skipped while backing off after failures or when the last poll was very
   * recent, unless `force` is set.
   */
  async refreshUsage(force = false): Promise<void> {
    if (this.disposed || !this.started) return
    if (this.polling) return this.polling
    if (!force && !this.shouldRefreshOnFocus()) return
    await this.runUsagePoll()
  }

  setWatched(watched: WatchedSessions | undefined): void {
    this.watched = watched
    void this.refreshNow()
  }

  /** Applies a new poll interval; the pending timer is rescheduled with the new delay. */
  setUsagePollSeconds(seconds: number): void {
    this.poller.setPollInterval(clampPollSeconds(seconds) * 1000)
    if (this.usageTimer && !this.polling) this.scheduleUsagePoll()
  }

  /** Delay the next usage poll will use (poll interval plus any backoff). */
  nextUsageDelayMs(): number {
    return this.poller.nextDelayMs()
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.rescanTimer) clearInterval(this.rescanTimer)
    if (this.usageTimer) clearTimeout(this.usageTimer)
    this.debounceTimer = null
    this.rescanTimer = null
    this.usageTimer = null

    const watchers = [this.sessionsWatcher, this.transcriptsWatcher]
    this.sessionsWatcher = null
    this.transcriptsWatcher = null
    this.transcriptPaths.clear()
    await Promise.all(watchers.map((w) => w?.close().catch((error) => this.reportError(error))))
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private createWatcher(paths: string[], kind: WatcherKind): WatcherLike | null {
    try {
      const watcher = this.watchFactory(paths, kind)
      watcher.on('all', (event, path) => {
        if (kind === 'sessions' && !event.endsWith('Dir') && !isSessionJson(path)) return
        this.scheduleRefresh()
      })
      watcher.on('error', (error) => this.reportError(error))
      return watcher
    } catch (error) {
      // The safety rescan keeps the snapshot current without a watcher.
      this.reportError(error)
      return null
    }
  }

  private async buildLoop(): Promise<AccountSnapshot | null> {
    let snapshot: AccountSnapshot | null = null
    do {
      this.rebuildQueued = false
      snapshot = await this.buildOnce()
    } while (this.rebuildQueued && !this.disposed)
    return snapshot
  }

  private async buildOnce(): Promise<AccountSnapshot | null> {
    let snapshot: AccountSnapshot
    try {
      snapshot = await this.builder.build(this.watched, this.poller.current, this.now())
    } catch (error) {
      this.reportError(error)
      return null
    }
    if (this.disposed) return null
    await this.syncTranscriptWatches(snapshot.sessions.map((s) => s.sessionId))
    if (this.disposed) return null
    this.emit(snapshot)
    return snapshot
  }

  private emit(snapshot: AccountSnapshot): void {
    this.lastSnapshot = snapshot
    const print = fingerprint(snapshot)
    if (print === this.lastFingerprint) return
    this.lastFingerprint = print
    try {
      this.options.onSnapshot(snapshot)
    } catch (error) {
      this.reportError(error)
    }
  }

  /** Watches transcripts of the given sessions only; transcripts not yet created are retried on later builds. */
  private async syncTranscriptWatches(sessionIds: readonly string[]): Promise<void> {
    const watcher = this.transcriptsWatcher
    if (!watcher) return
    const keep = new Set(sessionIds)

    const removed: string[] = []
    for (const [id, path] of this.transcriptPaths) {
      if (!keep.has(id)) {
        removed.push(path)
        this.transcriptPaths.delete(id)
      }
    }

    const missing = sessionIds.filter((id) => !this.transcriptPaths.has(id))
    const located = await Promise.all(
      missing.map(async (id) => [id, await this.locateTranscript(this.account.configDir, id).catch(() => null)] as const)
    )
    if (this.disposed) return

    const added: string[] = []
    for (const [id, path] of located) {
      if (path && !this.transcriptPaths.has(id)) {
        this.transcriptPaths.set(id, path)
        added.push(path)
      }
    }

    try {
      if (removed.length > 0) watcher.unwatch(removed)
      if (added.length > 0) watcher.add(added)
    } catch (error) {
      this.reportError(error)
    }
  }

  private shouldRefreshOnFocus(): boolean {
    const now = this.now()
    const nextPollAt = this.poller.current.nextPollAt
    // Respect backoff after rate limits / network errors.
    if (this.poller.failureCount > 0 && nextPollAt !== null && now < nextPollAt) return false
    return this.lastUsagePollAt === null || now - this.lastUsagePollAt >= this.minFocusRefreshMs
  }

  private runUsagePoll(): Promise<void> {
    if (this.polling) return this.polling
    if (this.usageTimer) clearTimeout(this.usageTimer)
    this.usageTimer = null

    this.polling = (async () => {
      this.lastUsagePollAt = this.now()
      try {
        await this.poller.poll()
      } catch (error) {
        this.reportError(error)
      }
      if (this.disposed) return
      this.scheduleUsagePoll()
      await this.refreshNow()
    })().finally(() => {
      this.polling = null
    })
    return this.polling
  }

  private scheduleUsagePoll(): void {
    if (this.disposed) return
    if (this.usageTimer) clearTimeout(this.usageTimer)
    this.usageTimer = setTimeout(() => {
      this.usageTimer = null
      void this.runUsagePoll()
    }, this.poller.nextDelayMs())
  }

  private reportError(error: unknown): void {
    try {
      this.options.onError?.(error)
    } catch {
      // Error reporting must never break the monitor.
    }
  }
}

export function createAccountMonitor(options: AccountMonitorOptions): AccountMonitor {
  return new AccountMonitor(options)
}
