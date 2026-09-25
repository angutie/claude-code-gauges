import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AccountMonitor,
  type SnapshotBuilder,
  type UsagePollerLike,
  type WatcherKind,
  type WatcherLike
} from '../src/main/account-monitor'
import { computeBackoffDelay, emptyUsageSnapshot } from '../src/main/sources/usage-api'
import type { Account, AccountSnapshot, UsageSnapshot, WatchedSessions } from '../src/shared/types'

const ACCOUNT: Account = { id: 'acc-1', label: 'Test', configDir: '/fake/.claude' }

class FakeWatcher implements WatcherLike {
  readonly paths = new Set<string>()
  closed = false
  private allListeners: Array<(event: string, path: string) => void> = []
  private errorListeners: Array<(error: unknown) => void> = []

  constructor(initial: string[], readonly kind: WatcherKind) {
    initial.forEach((p) => this.paths.add(p))
  }

  on(event: 'all' | 'error', listener: (...args: never[]) => void): this {
    if (event === 'all') this.allListeners.push(listener as (event: string, path: string) => void)
    else this.errorListeners.push(listener as (error: unknown) => void)
    return this
  }

  add(paths: string | string[]): this {
    ;[paths].flat().forEach((p) => this.paths.add(p))
    return this
  }

  unwatch(paths: string | string[]): this {
    ;[paths].flat().forEach((p) => this.paths.delete(p))
    return this
  }

  async close(): Promise<void> {
    this.closed = true
  }

  fire(event: string, path: string): void {
    this.allListeners.forEach((l) => l(event, path))
  }
}

function fakeWatchFactory() {
  const watchers: Record<WatcherKind, FakeWatcher | null> = { sessions: null, transcripts: null }
  const factory = (paths: string[], kind: WatcherKind) => {
    const w = new FakeWatcher(paths, kind)
    watchers[kind] = w
    return w
  }
  return { factory, watchers }
}

/** Poller double implementing the same backoff rule as UsagePoller. */
class FakePoller implements UsagePollerLike {
  failureCount = 0
  intervalMs: number
  polls = 0
  outcomes: Array<'ok' | 'fail'> = []
  private snapshot: UsageSnapshot = emptyUsageSnapshot()

  constructor(intervalMs: number, private readonly now: () => number = Date.now) {
    this.intervalMs = intervalMs
  }

  get current(): UsageSnapshot {
    return { ...this.snapshot }
  }

  async poll(): Promise<UsageSnapshot> {
    this.polls += 1
    const outcome = this.outcomes.shift() ?? 'ok'
    this.failureCount = outcome === 'ok' ? 0 : this.failureCount + 1
    const at = this.now()
    this.snapshot = {
      ...this.snapshot,
      status: outcome === 'ok' ? 'ok' : 'error',
      fiveHour: { percent: this.polls, resetsAt: null },
      lastAttemptAt: at,
      nextPollAt: at + this.nextDelayMs()
    }
    return this.current
  }

  nextDelayMs(): number {
    return computeBackoffDelay(this.intervalMs, this.failureCount, 60 * 60_000)
  }

  setPollInterval(ms: number): void {
    this.intervalMs = ms
  }
}

function snapshotFor(sessionIds: string[], usage: UsageSnapshot | null | undefined, tag: string): AccountSnapshot {
  return {
    accountId: ACCOUNT.id,
    identity: null,
    sessions: sessionIds.map((sessionId) => ({
      pid: 1,
      sessionId,
      cwd: `/repos/${sessionId}`,
      repoName: sessionId,
      title: tag,
      status: 'idle',
      waitingFor: null,
      entrypoint: 'cli',
      version: null,
      startedAt: null,
      updatedAt: null,
      model: null,
      effort: null,
      effortIsDefault: false,
      gitBranch: null,
      lastActivityAt: null
    })),
    availableSessions: [],
    usage: usage ?? emptyUsageSnapshot(),
    updatedAt: Date.now()
  }
}

class FakeBuilder implements SnapshotBuilder {
  calls = 0
  sessionIds: string[] = ['s1']
  tag = 'v0'
  lastWatched: WatchedSessions | undefined

  async build(watched: WatchedSessions | undefined, usage: UsageSnapshot | null | undefined): Promise<AccountSnapshot> {
    this.calls += 1
    this.lastWatched = watched
    return snapshotFor(this.sessionIds, usage, this.tag)
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('AccountMonitor (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function setup(overrides: { pollSeconds?: number } = {}) {
    const { factory, watchers } = fakeWatchFactory()
    const builder = new FakeBuilder()
    const poller = new FakePoller((overrides.pollSeconds ?? 90) * 1000)
    const onSnapshot = vi.fn<(s: AccountSnapshot) => void>()
    const locateTranscript = vi.fn(async (_dir: string, id: string) => `/fake/projects/p/${id}.jsonl`)
    const monitor = new AccountMonitor({
      account: ACCOUNT,
      usagePollSeconds: overrides.pollSeconds ?? 90,
      onSnapshot,
      builder,
      poller,
      watch: factory,
      locateTranscript
    })
    return { monitor, builder, poller, onSnapshot, watchers, locateTranscript }
  }

  it('emits an initial snapshot and polls usage on start', async () => {
    const { monitor, poller, onSnapshot, watchers } = setup()
    await monitor.start()
    expect(poller.polls).toBe(1)
    expect(onSnapshot).toHaveBeenCalled()
    expect(onSnapshot.mock.lastCall?.[0].usage.status).toBe('ok')
    expect([...watchers.sessions!.paths][0]).toMatch(/sessions$/)
    await monitor.dispose()
  })

  it('debounces bursts of session file events into one rebuild', async () => {
    const { monitor, builder, onSnapshot, watchers } = setup()
    await monitor.start()
    const buildsBefore = builder.calls
    const emitsBefore = onSnapshot.mock.calls.length

    builder.tag = 'v1'
    watchers.sessions!.fire('change', '/fake/.claude/sessions/1.json')
    await vi.advanceTimersByTimeAsync(100)
    watchers.sessions!.fire('add', '/fake/.claude/sessions/2.json')
    await vi.advanceTimersByTimeAsync(299)
    expect(builder.calls).toBe(buildsBefore)

    await vi.advanceTimersByTimeAsync(1)
    await flush()
    expect(builder.calls).toBe(buildsBefore + 1)
    expect(onSnapshot.mock.calls.length).toBe(emitsBefore + 1)
    expect(onSnapshot.mock.lastCall?.[0].sessions[0].title).toBe('v1')
    await monitor.dispose()
  })

  it('ignores non-json files in the sessions folder', async () => {
    const { monitor, builder, watchers } = setup()
    await monitor.start()
    const before = builder.calls
    watchers.sessions!.fire('change', '/fake/.claude/sessions/1.abc.key')
    await vi.advanceTimersByTimeAsync(400)
    expect(builder.calls).toBe(before)
    await monitor.dispose()
  })

  it('watches transcripts of watched sessions only and follows changes', async () => {
    const { monitor, builder, watchers } = setup()
    builder.sessionIds = ['s1', 's2']
    await monitor.start()
    expect([...watchers.transcripts!.paths].sort()).toEqual([
      '/fake/projects/p/s1.jsonl',
      '/fake/projects/p/s2.jsonl'
    ])

    builder.sessionIds = ['s2']
    await monitor.refreshNow()
    expect([...watchers.transcripts!.paths]).toEqual(['/fake/projects/p/s2.jsonl'])

    const before = builder.calls
    watchers.transcripts!.fire('change', '/fake/projects/p/s2.jsonl')
    await vi.advanceTimersByTimeAsync(300)
    await flush()
    expect(builder.calls).toBe(before + 1)
    await monitor.dispose()
  })

  it('passes the watched filter and rebuilds when it changes', async () => {
    const { monitor, builder } = setup()
    await monitor.start()
    monitor.setWatched(['s9'])
    await flush()
    expect(builder.lastWatched).toEqual(['s9'])
    await monitor.dispose()
  })

  it('runs a safety rescan every 5 seconds', async () => {
    const { monitor, builder } = setup()
    await monitor.start()
    const before = builder.calls
    await vi.advanceTimersByTimeAsync(5_000)
    expect(builder.calls).toBe(before + 1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(builder.calls).toBe(before + 2)
    await monitor.dispose()
  })

  it('does not re-emit identical snapshots on rescan', async () => {
    const { monitor, onSnapshot } = setup()
    await monitor.start()
    const emits = onSnapshot.mock.calls.length
    await vi.advanceTimersByTimeAsync(15_000)
    expect(onSnapshot.mock.calls.length).toBe(emits)
    await monitor.dispose()
  })

  it('polls usage at usagePollSeconds', async () => {
    const { monitor, poller } = setup({ pollSeconds: 120 })
    await monitor.start()
    expect(poller.polls).toBe(1)
    await vi.advanceTimersByTimeAsync(119_999)
    expect(poller.polls).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(poller.polls).toBe(2)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(poller.polls).toBe(3)
    await monitor.dispose()
  })

  it('uses the poller backoff after failures', async () => {
    const { monitor, poller } = setup({ pollSeconds: 60 })
    poller.outcomes = ['fail', 'fail', 'ok']
    await monitor.start()
    expect(monitor.nextUsageDelayMs()).toBe(120_000)

    await vi.advanceTimersByTimeAsync(119_999)
    expect(poller.polls).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(poller.polls).toBe(2)
    expect(monitor.nextUsageDelayMs()).toBe(240_000)

    await vi.advanceTimersByTimeAsync(240_000)
    expect(poller.polls).toBe(3)
    expect(monitor.nextUsageDelayMs()).toBe(60_000)
    await monitor.dispose()
  })

  it('reschedules with a new poll interval', async () => {
    const { monitor, poller } = setup({ pollSeconds: 90 })
    await monitor.start()
    monitor.setUsagePollSeconds(300)
    await vi.advanceTimersByTimeAsync(299_999)
    expect(poller.polls).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(poller.polls).toBe(2)
    await monitor.dispose()
  })

  it('refreshUsage polls immediately, resets the timer, and throttles rapid focus', async () => {
    const { monitor, poller } = setup({ pollSeconds: 90 })
    await monitor.start()
    await vi.advanceTimersByTimeAsync(30_000)
    await monitor.refreshUsage()
    expect(poller.polls).toBe(2)

    await monitor.refreshUsage() // too soon after the last poll
    expect(poller.polls).toBe(2)

    await vi.advanceTimersByTimeAsync(89_999)
    expect(poller.polls).toBe(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(poller.polls).toBe(3)
    await monitor.dispose()
  })

  it('refreshUsage does not bypass backoff unless forced', async () => {
    const { monitor, poller } = setup({ pollSeconds: 60 })
    poller.outcomes = ['fail']
    await monitor.start()
    await vi.advanceTimersByTimeAsync(30_000)
    await monitor.refreshUsage()
    expect(poller.polls).toBe(1)
    await monitor.refreshUsage(true)
    expect(poller.polls).toBe(2)
    await monitor.dispose()
  })

  it('dispose closes watchers and clears all timers', async () => {
    const { monitor, builder, poller, onSnapshot, watchers } = setup()
    await monitor.start()
    watchers.sessions!.fire('change', '/fake/.claude/sessions/1.json')
    await monitor.dispose()

    expect(watchers.sessions!.closed).toBe(true)
    expect(watchers.transcripts!.closed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(monitor.isDisposed).toBe(true)

    const builds = builder.calls
    const emits = onSnapshot.mock.calls.length
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    await monitor.refreshUsage(true)
    expect(builder.calls).toBe(builds)
    expect(poller.polls).toBe(1)
    expect(onSnapshot.mock.calls.length).toBe(emits)
  })

  it('reports builder errors without crashing', async () => {
    const { factory } = fakeWatchFactory()
    const onError = vi.fn()
    const monitor = new AccountMonitor({
      account: ACCOUNT,
      usagePollSeconds: 90,
      onSnapshot: vi.fn(),
      onError,
      builder: { build: () => Promise.reject(new Error('boom')) },
      poller: new FakePoller(90_000),
      watch: factory,
      locateTranscript: async () => null
    })
    await monitor.start()
    expect(onError).toHaveBeenCalled()
    await monitor.dispose()
  })
})

describe('AccountMonitor (real files)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gauges-monitor-'))
    await mkdir(join(dir, 'sessions'), { recursive: true })
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writing a session file triggers a debounced snapshot emit', async () => {
    const session = {
      pid: process.pid,
      sessionId: 'sess-a',
      cwd: join(dir, 'repo-a'),
      status: 'idle',
      startedAt: 1,
      updatedAt: 1
    }
    const sessionFile = join(dir, 'sessions', `${process.pid}.json`)
    await writeFile(sessionFile, JSON.stringify(session))

    const snapshots: AccountSnapshot[] = []
    const monitor = new AccountMonitor({
      account: { id: 'real', label: '', configDir: dir },
      usagePollSeconds: 600,
      onSnapshot: (s) => snapshots.push(s),
      poller: new FakePoller(600_000),
      rescanMs: 60_000,
      isAlive: () => true
    })

    try {
      await monitor.start()
      expect(snapshots.at(-1)?.sessions.map((s) => s.status)).toEqual(['idle'])
      // Give chokidar a moment to attach its watchers.
      await new Promise((r) => setTimeout(r, 300))

      const writtenAt = Date.now()
      await writeFile(sessionFile, JSON.stringify({ ...session, status: 'busy', updatedAt: 2 }))

      await vi.waitFor(
        () => {
          expect(snapshots.at(-1)?.sessions.map((s) => s.status)).toEqual(['busy'])
        },
        { timeout: 5_000, interval: 50 }
      )
      expect(Date.now() - writtenAt).toBeGreaterThanOrEqual(250)
    } finally {
      await monitor.dispose()
    }
  }, 10_000)
})
