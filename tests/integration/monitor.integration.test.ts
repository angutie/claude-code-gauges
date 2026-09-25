import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountMonitor, DEFAULT_DEBOUNCE_MS } from '../../src/main/account-monitor'
import { EXPIRED_MESSAGE, USAGE_API_BETA, USAGE_API_URL } from '../../src/main/sources/usage-api'
import type { AccountSnapshot } from '../../src/shared/types'
import { FakeConfigDir, FakeProcesses, MockUsageApi } from './helpers'

/**
 * End-to-end: real files on disk → sessions registry + transcript tail +
 * account reader → aggregator → AccountMonitor (real chokidar watchers),
 * with only the network (usage fetch) and PID liveness faked.
 */

// Chokidar delivery + the 300 ms debounce; generous for slow Windows CI.
const EMIT_TIMEOUT_MS = 4_000
// The safety rescan is pushed out so every update below must come from the watchers.
const NO_RESCAN_MS = 10 * 60_000

interface Harness {
  dir: FakeConfigDir
  monitor: AccountMonitor
  snapshots: AccountSnapshot[]
  errors: unknown[]
  latest(): AccountSnapshot
}

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function startMonitor(
  dir: FakeConfigDir,
  opts: { id: string; api: MockUsageApi; procs: FakeProcesses; usagePollSeconds?: number }
): Promise<Harness> {
  const snapshots: AccountSnapshot[] = []
  const errors: unknown[] = []
  const monitor = new AccountMonitor({
    account: { id: opts.id, label: '', configDir: dir.root },
    watched: 'all',
    usagePollSeconds: opts.usagePollSeconds ?? 600,
    onSnapshot: (s) => snapshots.push(s),
    onError: (e) => errors.push(e),
    rescanMs: NO_RESCAN_MS,
    fetch: opts.api.fetch,
    isAlive: opts.procs.isAlive
  })
  cleanups.push(() => monitor.dispose())
  await monitor.start()
  // Let chokidar attach its native watchers before mutating files.
  await new Promise((r) => setTimeout(r, 300))
  return {
    dir,
    monitor,
    snapshots,
    errors,
    latest: () => {
      const s = snapshots.at(-1)
      if (!s) throw new Error('no snapshot emitted')
      return s
    }
  }
}

async function makeDir(prefix: string, email: string, accessToken: string, expiresAt?: number): Promise<FakeConfigDir> {
  const dir = await FakeConfigDir.create(prefix, { email, accessToken, expiresAt })
  cleanups.push(() => dir.dispose())
  return dir
}

/** Waits for the latest emitted snapshot to satisfy `assert`, and returns the elapsed ms. */
async function waitForSnapshot(h: Harness, assert: (s: AccountSnapshot) => void): Promise<number> {
  const startedAt = Date.now()
  await vi.waitFor(() => assert(h.latest()), { timeout: EMIT_TIMEOUT_MS, interval: 25 })
  return Date.now() - startedAt
}

describe('monitor integration: sessions lifecycle', () => {
  it('adding and removing session files updates the snapshot via the debounced watcher', async () => {
    const api = new MockUsageApi().reply('tok-a', { status: 200, fiveHour: 12, weekly: 34 })
    const procs = new FakeProcesses()
    const dir = await makeDir('a', 'a@example.com', 'tok-a')
    const h = await startMonitor(dir, { id: 'acct-a', api, procs })

    expect(h.latest().sessions).toEqual([])
    expect(h.latest().identity?.email).toBe('a@example.com')

    const repoOne = { pid: 41001, sessionId: 'sess-one', cwd: 'C:\\Users\\dev\\Repos\\phoenix-core', status: 'busy' as const }
    const repoTwo = {
      pid: 41002,
      sessionId: 'sess-two',
      cwd: 'C:\\Users\\dev\\Repos\\gauges.app',
      status: 'waiting' as const,
      waitingFor: 'permission prompt'
    }
    procs.add(repoOne.pid)
    procs.add(repoTwo.pid)

    await dir.startSession(repoOne)
    const elapsed = await waitForSnapshot(h, (s) => expect(s.sessions.map((x) => x.repoName)).toEqual(['phoenix-core']))
    // Debounced (not instant), and delivered well within the watcher + debounce window.
    expect(elapsed).toBeLessThan(EMIT_TIMEOUT_MS)

    await dir.startSession(repoTwo)
    await waitForSnapshot(h, (s) => {
      expect(s.sessions.map((x) => x.sessionId).sort()).toEqual(['sess-one', 'sess-two'])
      const waiting = s.sessions.find((x) => x.sessionId === 'sess-two')!
      expect(waiting).toMatchObject({ repoName: 'gauges.app', status: 'waiting', waitingFor: 'permission prompt' })
      // No transcript yet → effort falls back to settings.json.
      expect(waiting).toMatchObject({ model: null, effort: 'medium', effortIsDefault: true })
    })
    expect(h.latest().availableSessions).toHaveLength(2)

    // Removing the registry file ends the session.
    await dir.stopSession(repoOne.pid)
    await waitForSnapshot(h, (s) => expect(s.sessions.map((x) => x.sessionId)).toEqual(['sess-two']))

    // A dead PID with a stale file left behind disappears on the next rescan.
    procs.kill(repoTwo.pid)
    await h.monitor.refreshNow()
    expect(h.latest().sessions).toEqual([])
    expect(h.errors).toEqual([])
  }, 20_000)

  it('appending assistant lines switches model/effort; sidechain lines are ignored', async () => {
    const api = new MockUsageApi().reply('tok-a', { status: 200, fiveHour: 5, weekly: 6 })
    const procs = new FakeProcesses()
    const dir = await makeDir('a', 'a@example.com', 'tok-a')
    const session = { pid: 42001, sessionId: 'sess-model', cwd: 'c:\\work\\repo-x', status: 'busy' as const }
    procs.add(session.pid)
    await dir.startSession(session)
    await dir.createTranscript(session, [{ model: 'claude-sonnet-5', effort: 'low', gitBranch: 'feature/one' }])

    const h = await startMonitor(dir, { id: 'acct-a', api, procs })
    expect(h.latest().sessions[0]).toMatchObject({
      model: 'claude-sonnet-5',
      effort: 'low',
      effortIsDefault: false,
      gitBranch: 'feature/one'
    })

    // Model + effort switch arrives through the transcript watcher.
    await dir.appendAssistant(session, { model: 'claude-opus-5-5', effort: 'max', gitBranch: 'feature/two' })
    await waitForSnapshot(h, (s) =>
      expect(s.sessions[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'max', gitBranch: 'feature/two' })
    )

    // Effort-only change.
    await dir.appendAssistant(session, { model: 'claude-opus-5-5', effort: 'high', gitBranch: 'feature/two' })
    await waitForSnapshot(h, (s) => expect(s.sessions[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'high' }))

    // A subagent (sidechain) line must not override the main session's model.
    const before = h.snapshots.length
    await dir.appendAssistant(session, { model: 'claude-haiku-5', effort: 'low', isSidechain: true })
    await new Promise((r) => setTimeout(r, DEFAULT_DEBOUNCE_MS + 700))
    await h.monitor.refreshNow()
    expect(h.latest().sessions[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'high' })
    // Fingerprinting suppresses no-op emits.
    expect(h.snapshots.length).toBe(before)
  }, 20_000)

  it('picks up a transcript created after the session started once the registry changes', async () => {
    const api = new MockUsageApi().reply('tok-a', { status: 200, fiveHour: 1, weekly: 2 })
    const procs = new FakeProcesses()
    const dir = await makeDir('a', 'a@example.com', 'tok-a')
    const h = await startMonitor(dir, { id: 'acct-a', api, procs })

    const session = { pid: 43001, sessionId: 'sess-late', cwd: 'C:\\r\\late-repo', status: 'idle' as const }
    procs.add(session.pid)
    await dir.startSession(session)
    await waitForSnapshot(h, (s) => expect(s.sessions[0]).toMatchObject({ sessionId: 'sess-late', model: null }))

    // First turn: transcript appears and the CLI flips status to busy.
    await dir.createTranscript(session, [{ model: 'claude-opus-5-5', effort: 'medium' }])
    await dir.startSession({ ...session, status: 'busy' })
    await waitForSnapshot(h, (s) =>
      expect(s.sessions[0]).toMatchObject({ status: 'busy', model: 'claude-opus-5-5', effort: 'medium', effortIsDefault: false })
    )

    // From now on the transcript itself is watched.
    await dir.appendAssistant(session, { model: 'claude-sonnet-5', effort: 'high' })
    await waitForSnapshot(h, (s) => expect(s.sessions[0]).toMatchObject({ model: 'claude-sonnet-5', effort: 'high' }))
  }, 20_000)
})

describe('monitor integration: two accounts', () => {
  it('produces independent snapshots and usage per config dir', async () => {
    const api = new MockUsageApi()
      .reply('tok-personal', { status: 200, fiveHour: 25, weekly: 40 })
      .reply('tok-work', { status: 200, fiveHour: 88, weekly: null })
    const procs = new FakeProcesses()
    const personal = await makeDir('personal', 'me@example.com', 'tok-personal')
    const work = await makeDir('work', 'me@corp.example', 'tok-work')

    const hp = await startMonitor(personal, { id: 'acct-personal', api, procs })
    const hw = await startMonitor(work, { id: 'acct-work', api, procs })

    expect(api.calls.every((c) => c.url === USAGE_API_URL && c.beta === USAGE_API_BETA)).toBe(true)
    expect(api.callsFor('tok-personal')).toBe(1)
    expect(api.callsFor('tok-work')).toBe(1)

    expect(hp.latest()).toMatchObject({ accountId: 'acct-personal', identity: { email: 'me@example.com' } })
    expect(hw.latest()).toMatchObject({ accountId: 'acct-work', identity: { email: 'me@corp.example' } })
    expect(hp.latest().usage).toMatchObject({ status: 'ok', fiveHour: { percent: 25 }, weekly: { percent: 40 } })
    expect(hw.latest().usage).toMatchObject({ status: 'ok', fiveHour: { percent: 88 }, weekly: { percent: null } })
    expect(hw.latest().usage.weeklyOpus).toBeNull()

    const s1 = { pid: 44001, sessionId: 'sess-personal', cwd: 'C:\\home\\side-project' }
    const s2 = { pid: 44002, sessionId: 'sess-work', cwd: 'C:\\corp\\monorepo' }
    procs.add(s1.pid)
    procs.add(s2.pid)
    await personal.startSession(s1)
    await personal.createTranscript(s1, [{ model: 'claude-sonnet-5', effort: 'low' }])
    await work.startSession(s2)
    await work.createTranscript(s2, [{ model: 'claude-opus-5-5', effort: 'max' }])

    await waitForSnapshot(hp, (s) =>
      expect(s.sessions.map((x) => [x.repoName, x.model])).toEqual([['side-project', 'claude-sonnet-5']])
    )
    await waitForSnapshot(hw, (s) =>
      expect(s.sessions.map((x) => [x.repoName, x.model])).toEqual([['monorepo', 'claude-opus-5-5']])
    )

    // Ending the work session leaves the personal account untouched.
    const personalEmits = hp.snapshots.length
    await work.stopSession(s2.pid)
    await waitForSnapshot(hw, (s) => expect(s.sessions).toEqual([]))
    await new Promise((r) => setTimeout(r, DEFAULT_DEBOUNCE_MS + 300))
    expect(hp.snapshots.length).toBe(personalEmits)
    expect(hp.latest().sessions.map((x) => x.sessionId)).toEqual(['sess-personal'])

    // A usage failure on one account does not bleed into the other.
    api.setReply('tok-work', { status: 401 })
    await hw.monitor.refreshUsage(true)
    expect(hw.latest().usage.status).toBe('expired')
    expect(hp.latest().usage.status).toBe('ok')
    expect(api.callsFor('tok-personal')).toBe(1)
  }, 25_000)
})

describe('monitor integration: usage API failure paths', () => {
  it('401 yields expired with the refresh hint; fresh credentials recover on the next poll', async () => {
    const api = new MockUsageApi().reply('tok-a', { status: 200, fiveHour: 50, weekly: 60 }, { status: 401 })
    const procs = new FakeProcesses()
    const dir = await makeDir('a', 'a@example.com', 'tok-a')
    const h = await startMonitor(dir, { id: 'acct-a', api, procs })
    expect(h.latest().usage.status).toBe('ok')

    await h.monitor.refreshUsage(true)
    expect(h.latest().usage).toMatchObject({ status: 'expired', message: EXPIRED_MESSAGE })
    expect(h.latest().usage.message).toContain('claude')

    // The CLI rewrites credentials with a new token; the poller re-reads them.
    api.reply('tok-a2', { status: 200, fiveHour: 51, weekly: 61 })
    await dir.writeCredentials({ accessToken: 'tok-a2' })
    await h.monitor.refreshUsage(true)
    expect(h.latest().usage).toMatchObject({ status: 'ok', fiveHour: { percent: 51 } })
  }, 15_000)

  it('an expired token on disk yields expired without calling the API', async () => {
    const api = new MockUsageApi().reply('tok-old', { status: 200, fiveHour: 1, weekly: 1 })
    const procs = new FakeProcesses()
    const dir = await makeDir('a', 'a@example.com', 'tok-old', Date.now() - 60_000)
    const h = await startMonitor(dir, { id: 'acct-a', api, procs })

    expect(api.calls).toHaveLength(0)
    expect(h.latest().usage).toMatchObject({ status: 'expired', message: EXPIRED_MESSAGE })
    expect(h.latest().identity?.tokenStatus).toBe('expired')
  }, 15_000)

  it('429 after a success is stale (keeps last data) and backs off; 429 first is error', async () => {
    const api = new MockUsageApi()
      .reply('tok-a', { status: 200, fiveHour: 70, weekly: 20 }, { status: 429 }, { status: 429, retryAfter: '900' })
      .reply('tok-b', { status: 429 })
    const procs = new FakeProcesses()
    const dirA = await makeDir('a', 'a@example.com', 'tok-a')
    const dirB = await makeDir('b', 'b@example.com', 'tok-b')
    const ha = await startMonitor(dirA, { id: 'acct-a', api, procs, usagePollSeconds: 60 })
    const hb = await startMonitor(dirB, { id: 'acct-b', api, procs, usagePollSeconds: 60 })

    expect(ha.monitor.nextUsageDelayMs()).toBe(60_000)

    await ha.monitor.refreshUsage(true)
    expect(ha.latest().usage).toMatchObject({ status: 'stale', fiveHour: { percent: 70 }, weekly: { percent: 20 } })
    expect(ha.latest().usage.lastSuccessAt).not.toBeNull()
    expect(ha.monitor.nextUsageDelayMs()).toBe(120_000)

    // Focus refreshes respect the backoff window.
    const callsBefore = api.callsFor('tok-a')
    await ha.monitor.refreshUsage()
    expect(api.callsFor('tok-a')).toBe(callsBefore)

    // Retry-After larger than the exponential backoff wins.
    await ha.monitor.refreshUsage(true)
    expect(ha.latest().usage.status).toBe('stale')
    expect(ha.monitor.nextUsageDelayMs()).toBe(900_000)

    // Never succeeded → nothing to show as stale.
    expect(hb.latest().usage).toMatchObject({ status: 'error', fiveHour: null, lastSuccessAt: null })
    expect(hb.monitor.nextUsageDelayMs()).toBe(120_000)
  }, 20_000)
})

describe('monitor integration: secrets stay out of snapshots', () => {
  it('never places tokens in emitted snapshots', async () => {
    const api = new MockUsageApi().reply('tok-secret-xyz', { status: 200, fiveHour: 3, weekly: 4 })
    const procs = new FakeProcesses()
    const dir = await makeDir('a', 'a@example.com', 'tok-secret-xyz')
    const session = { pid: 45001, sessionId: 'sess-sec', cwd: join('C:\\', 'repo') }
    procs.add(session.pid)
    await dir.startSession(session)
    const h = await startMonitor(dir, { id: 'acct-a', api, procs })

    const serialized = JSON.stringify(h.snapshots)
    expect(serialized).not.toContain('tok-secret-xyz')
    expect(serialized).not.toContain('fake-refresh-token')
    expect(serialized).not.toContain('not-json-secret')
  }, 15_000)
})
