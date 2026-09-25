import type {
  Account,
  AccountIdentity,
  AccountSnapshot,
  EpochMs,
  SessionInfo,
  UsageSnapshot,
  WatchedSessions
} from '../shared/types'
import { readAccountIdentity, type ReadIdentityOptions } from './sources/account-reader'
import { scanSessions, type ScanOptions } from './sources/sessions-registry'
import { TranscriptReader, type TranscriptInfo } from './sources/transcript-tail'
import { emptyUsageSnapshot } from './sources/usage-api'

/**
 * The data sources an aggregator pulls from. Each may reject or return partial
 * data; the aggregator degrades those cases to null/'unknown' values.
 */
export interface AggregatorSources {
  readIdentity(): Promise<AccountIdentity | null>
  scanSessions(): Promise<SessionInfo[]>
  readTranscripts(sessionIds: readonly string[]): Promise<Map<string, TranscriptInfo>>
  /** Optional hook to drop cached per-session state for sessions that ended. */
  pruneTranscripts?(liveSessionIds: readonly string[]): void
}

export interface BuildSnapshotInput {
  accountId: string
  watched: WatchedSessions | undefined
  /** Latest usage result for the account; null/undefined means no poll has completed yet. */
  usage: UsageSnapshot | null | undefined
  now?: EpochMs
}

export interface DefaultSourcesOptions extends ReadIdentityOptions, ScanOptions {}

/** Wires the real file-based sources for one account's config dir. */
export function createDefaultSources(
  configDir: string,
  options: DefaultSourcesOptions = {}
): AggregatorSources {
  const transcripts = new TranscriptReader(configDir)
  return {
    readIdentity: () => readAccountIdentity(configDir, options),
    scanSessions: () => scanSessions(configDir, options),
    readTranscripts: (ids) => transcripts.readMany(ids),
    pruneTranscripts: (ids) => transcripts.prune(ids)
  }
}

/** Applies the watched filter; a missing entry or 'all' keeps every session. */
export function filterWatched(
  sessions: readonly SessionInfo[],
  watched: WatchedSessions | undefined
): SessionInfo[] {
  if (watched === undefined || watched === 'all' || !Array.isArray(watched)) return [...sessions]
  const ids = new Set(watched)
  return sessions.filter((session) => ids.has(session.sessionId))
}

/** Overlays transcript-derived fields onto a registry record. */
export function mergeTranscript(session: SessionInfo, transcript: TranscriptInfo | undefined): SessionInfo {
  if (!transcript) return session
  return {
    ...session,
    title: transcript.title ?? session.title,
    model: transcript.model ?? session.model,
    effort: transcript.effort ?? session.effort,
    effortIsDefault: transcript.effort !== null ? transcript.effortIsDefault : session.effortIsDefault,
    gitBranch: transcript.gitBranch ?? session.gitBranch,
    lastActivityAt: transcript.lastActivityAt ?? session.lastActivityAt
  }
}

/** No poll result yet: every window is null, which the UI shows as unknown. */
function unknownUsage(): UsageSnapshot {
  return emptyUsageSnapshot()
}

async function settle<T>(promise: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise()
  } catch {
    return fallback
  }
}

/**
 * Builds an AccountSnapshot from the given sources. Never throws: a failing
 * source contributes null identity, no sessions, or registry-only session data.
 * Transcripts are read only for watched sessions; availableSessions reuses that
 * enriched data where present so the picker shows consistent values.
 */
export async function buildAccountSnapshot(
  sources: AggregatorSources,
  input: BuildSnapshotInput
): Promise<AccountSnapshot> {
  const [identity, live] = await Promise.all([
    settle(() => sources.readIdentity(), null),
    settle(() => sources.scanSessions(), [] as SessionInfo[])
  ])
  const liveSessions = Array.isArray(live) ? live : []

  try {
    sources.pruneTranscripts?.(liveSessions.map((s) => s.sessionId))
  } catch {
    // Pruning is a cache optimisation only.
  }

  const watched = filterWatched(liveSessions, input.watched)
  const transcripts = await settle(
    () => sources.readTranscripts(watched.map((s) => s.sessionId)),
    new Map<string, TranscriptInfo>()
  )
  const safeTranscripts = transcripts instanceof Map ? transcripts : new Map<string, TranscriptInfo>()

  const enriched = new Map<string, SessionInfo>()
  for (const session of watched) {
    enriched.set(session.sessionId, mergeTranscript(session, safeTranscripts.get(session.sessionId)))
  }

  return {
    accountId: input.accountId,
    identity: identity ?? null,
    sessions: watched.map((s) => enriched.get(s.sessionId) ?? s),
    availableSessions: liveSessions.map((s) => enriched.get(s.sessionId) ?? s),
    usage: input.usage ? { ...input.usage } : unknownUsage(),
    updatedAt: input.now ?? Date.now()
  }
}

/**
 * Per-account aggregator that keeps its sources (and their transcript tail
 * caches) alive between snapshots.
 */
export class AccountAggregator {
  readonly account: Account
  private readonly sources: AggregatorSources

  constructor(account: Account, sources: AggregatorSources = createDefaultSources(account.configDir)) {
    this.account = account
    this.sources = sources
  }

  build(
    watched: WatchedSessions | undefined,
    usage: UsageSnapshot | null | undefined,
    now?: EpochMs
  ): Promise<AccountSnapshot> {
    return buildAccountSnapshot(this.sources, { accountId: this.account.id, watched, usage, now })
  }
}
