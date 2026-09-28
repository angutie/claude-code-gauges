import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AccountAggregator,
  buildAccountSnapshot,
  createDefaultSources,
  filterWatched,
  mergeTranscript,
  type AggregatorSources
} from '../src/main/aggregator'
import type { TranscriptInfo } from '../src/main/sources/transcript-tail'
import type { AccountIdentity, SessionInfo, UsageSnapshot } from '../src/shared/types'

function session(overrides: Partial<SessionInfo> & { sessionId: string }): SessionInfo {
  return {
    pid: 1000,
    cwd: `C:\\Repos\\${overrides.sessionId}`,
    repoName: overrides.sessionId,
    title: null,
    status: 'idle',
    waitingFor: null,
    entrypoint: 'cli',
    version: '2.1.281',
    startedAt: 1,
    updatedAt: 2,
    model: null,
    effort: null,
    effortIsDefault: false,
    gitBranch: null,
    lastActivityAt: null,
    ...overrides
  }
}

function transcript(overrides: Partial<TranscriptInfo> = {}): TranscriptInfo {
  return {
    model: 'claude-opus-5-5',
    effort: 'max',
    effortIsDefault: false,
    gitBranch: 'main',
    lastActivityAt: 500,
    title: 'Transcript title',
    transcriptPath: '/fake/path.jsonl',
    ...overrides
  }
}

const IDENTITY: AccountIdentity = {
  email: 'dev@example.com',
  displayName: 'Dev',
  organizationName: 'Org',
  subscriptionType: 'max',
  tokenStatus: 'valid',
  tokenExpiresAt: 9_999
}

const USAGE: UsageSnapshot = {
  status: 'ok',
  fiveHour: { percent: 42, resetsAt: 1_000 },
  weekly: { percent: 10, resetsAt: 2_000 },
  weeklyOpus: null,
  weeklySonnet: null,
  lastSuccessAt: 100,
  lastAttemptAt: 100,
  nextPollAt: 200,
  message: null
}

const ALPHA = session({
  sessionId: 'alpha',
  pid: 11,
  status: 'waiting',
  waitingFor: 'permission prompt',
  title: 'Registry title'
})
const BETA = session({ sessionId: 'beta', pid: 22, status: 'busy' })

function stubSources(overrides: Partial<AggregatorSources> = {}): AggregatorSources {
  return {
    readIdentity: vi.fn(async () => IDENTITY),
    scanSessions: vi.fn(async () => [ALPHA, BETA]),
    readTranscripts: vi.fn(
      async (ids: readonly string[]) =>
        new Map(ids.map((id) => [id, transcript({ title: `${id} title`, gitBranch: `feat/${id}` })]))
    ),
    pruneTranscripts: vi.fn(),
    ...overrides
  }
}

describe('filterWatched', () => {
  it("keeps every session for 'all' or a missing entry", () => {
    expect(filterWatched([ALPHA, BETA], 'all')).toEqual([ALPHA, BETA])
    expect(filterWatched([ALPHA, BETA], undefined)).toEqual([ALPHA, BETA])
  })

  it('keeps only listed ids and ignores unknown ids', () => {
    expect(filterWatched([ALPHA, BETA], ['beta', 'gone'])).toEqual([BETA])
    expect(filterWatched([ALPHA, BETA], [])).toEqual([])
  })
})

describe('mergeTranscript', () => {
  it('overlays transcript fields and keeps registry fields', () => {
    const merged = mergeTranscript(ALPHA, transcript())
    expect(merged).toMatchObject({
      repoName: 'alpha',
      status: 'waiting',
      waitingFor: 'permission prompt',
      title: 'Transcript title',
      model: 'claude-opus-5-5',
      effort: 'max',
      gitBranch: 'main',
      lastActivityAt: 500
    })
  })

  it('falls back to the registry title when the transcript has none', () => {
    expect(mergeTranscript(ALPHA, transcript({ title: null })).title).toBe('Registry title')
  })

  it('carries the default-effort flag', () => {
    const merged = mergeTranscript(BETA, transcript({ effort: 'medium', effortIsDefault: true }))
    expect(merged.effort).toBe('medium')
    expect(merged.effortIsDefault).toBe(true)
  })

  it('returns the session unchanged without a transcript', () => {
    expect(mergeTranscript(BETA, undefined)).toBe(BETA)
  })
})

describe('buildAccountSnapshot', () => {
  it('includes repo, model, effort, branch, status, and title for each watched session', async () => {
    const snapshot = await buildAccountSnapshot(stubSources(), {
      accountId: 'acc-1',
      watched: 'all',
      usage: USAGE,
      now: 12_345
    })

    expect(snapshot.accountId).toBe('acc-1')
    expect(snapshot.updatedAt).toBe(12_345)
    expect(snapshot.identity).toEqual(IDENTITY)
    expect(snapshot.usage).toEqual(USAGE)
    expect(snapshot.sessions).toHaveLength(2)
    expect(snapshot.sessions[0]).toMatchObject({
      sessionId: 'alpha',
      repoName: 'alpha',
      model: 'claude-opus-5-5',
      effort: 'max',
      gitBranch: 'feat/alpha',
      status: 'waiting',
      waitingFor: 'permission prompt',
      title: 'alpha title'
    })
    expect(snapshot.sessions[1]).toMatchObject({ sessionId: 'beta', status: 'busy', gitBranch: 'feat/beta' })
  })

  it('filters watched sessions while availableSessions lists every live session', async () => {
    const sources = stubSources()
    const snapshot = await buildAccountSnapshot(sources, { accountId: 'a', watched: ['beta'], usage: USAGE })

    expect(snapshot.sessions.map((s) => s.sessionId)).toEqual(['beta'])
    expect(snapshot.availableSessions.map((s) => s.sessionId)).toEqual(['alpha', 'beta'])
    expect(sources.readTranscripts).toHaveBeenCalledWith(['beta'])
    expect(sources.pruneTranscripts).toHaveBeenCalledWith(['alpha', 'beta'])
    // The unwatched session keeps its registry-only data; the watched one is enriched.
    expect(snapshot.availableSessions[0]).toEqual(ALPHA)
    expect(snapshot.availableSessions[1]!.model).toBe('claude-opus-5-5')
  })

  it('does not mutate the source session records', async () => {
    await buildAccountSnapshot(stubSources(), { accountId: 'a', watched: 'all', usage: USAGE })
    expect(ALPHA.model).toBeNull()
  })

  it('degrades every failing source without throwing', async () => {
    const sources = stubSources({
      readIdentity: vi.fn(async () => {
        throw new Error('boom')
      }),
      scanSessions: vi.fn(async () => {
        throw new Error('boom')
      }),
      pruneTranscripts: vi.fn(() => {
        throw new Error('boom')
      })
    })
    const snapshot = await buildAccountSnapshot(sources, { accountId: 'a', watched: 'all', usage: null })

    expect(snapshot.identity).toBeNull()
    expect(snapshot.sessions).toEqual([])
    expect(snapshot.availableSessions).toEqual([])
    expect(snapshot.usage.fiveHour).toBeNull()
    expect(snapshot.usage.weekly).toBeNull()
    expect(snapshot.usage.status).toBe('loading')
  })

  it('keeps registry data with unknown model/effort when transcripts fail', async () => {
    const sources = stubSources({
      readTranscripts: vi.fn(async () => {
        throw new Error('EACCES')
      })
    })
    const snapshot = await buildAccountSnapshot(sources, { accountId: 'a', watched: 'all', usage: USAGE })

    expect(snapshot.sessions).toEqual([ALPHA, BETA])
    expect(snapshot.sessions[0]!.model).toBeNull()
    expect(snapshot.sessions[0]!.effort).toBeNull()
  })

  it('handles sessions missing from the transcript result', async () => {
    const sources = stubSources({ readTranscripts: vi.fn(async () => new Map()) })
    const snapshot = await buildAccountSnapshot(sources, { accountId: 'a', watched: 'all', usage: USAGE })
    expect(snapshot.sessions).toEqual([ALPHA, BETA])
  })

  it('treats a missing watched entry as all sessions', async () => {
    const snapshot = await buildAccountSnapshot(stubSources(), { accountId: 'a', watched: undefined, usage: USAGE })
    expect(snapshot.sessions).toHaveLength(2)
  })
})

describe('AccountAggregator', () => {
  it('builds snapshots using the account id', async () => {
    const aggregator = new AccountAggregator({ id: 'acc-9', label: '', configDir: '/nope' }, stubSources())
    const snapshot = await aggregator.build(['alpha'], USAGE, 1)
    expect(snapshot.accountId).toBe('acc-9')
    expect(snapshot.sessions.map((s) => s.sessionId)).toEqual(['alpha'])
  })
})

describe('createDefaultSources', () => {
  it('reads a real config dir end to end', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gauges-agg-'))
    try {
      await mkdir(join(dir, 'sessions'))
      await mkdir(join(dir, 'projects', 'C--Repos-demo'), { recursive: true })
      await writeFile(
        join(dir, 'sessions', '4242.json'),
        JSON.stringify({ pid: 4242, sessionId: 'sess-1', cwd: 'C:\\Repos\\demo', status: 'busy', name: 'Demo' })
      )
      await writeFile(join(dir, 'sessions', '4242.abc.key'), 'secret')
      await writeFile(
        join(dir, 'projects', 'C--Repos-demo', 'sess-1.jsonl'),
        JSON.stringify({
          type: 'assistant',
          effort: 'high',
          gitBranch: 'develop',
          timestamp: '2026-09-25T00:00:00.000Z',
          message: { model: 'claude-opus-5-5' }
        }) + '\n'
      )

      const sources = createDefaultSources(dir, { isAlive: () => true, homeDir: dir })
      const snapshot = await buildAccountSnapshot(sources, { accountId: 'a', watched: 'all', usage: USAGE })

      expect(snapshot.sessions).toHaveLength(1)
      expect(snapshot.sessions[0]).toMatchObject({
        repoName: 'demo',
        status: 'busy',
        title: 'Demo',
        model: 'claude-opus-5-5',
        effort: 'high',
        gitBranch: 'develop'
      })
      expect(snapshot.identity).not.toBeNull()
      expect(snapshot.identity!.tokenStatus).toBe('missing')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('degrades to empty data for a missing config dir', async () => {
    const sources = createDefaultSources(join(tmpdir(), 'gauges-does-not-exist-xyz'), { isAlive: () => true })
    const snapshot = await buildAccountSnapshot(sources, { accountId: 'a', watched: 'all', usage: undefined })
    expect(snapshot.sessions).toEqual([])
    expect(snapshot.availableSessions).toEqual([])
    expect(snapshot.identity?.email ?? null).toBeNull()
  })
})
