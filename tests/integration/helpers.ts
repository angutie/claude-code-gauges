import { appendFile, mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FetchLike } from '../../src/main/sources/usage-api'

/**
 * Builds a throwaway Claude Code config dir on disk (sessions registry,
 * projects/*.jsonl transcripts, .claude.json, .credentials.json, settings.json)
 * so the real sources, aggregator, and monitor can run against it.
 * All tokens are fake.
 */

export interface FakeAccountOptions {
  email: string
  accessToken: string
  /** ms epoch; defaults to one hour from now. */
  expiresAt?: number
  subscriptionType?: string
  organizationName?: string
  defaultEffort?: string
}

export interface FakeSession {
  pid: number
  sessionId: string
  cwd: string
  status?: 'busy' | 'idle' | 'waiting'
  waitingFor?: string
  name?: string
}

export interface AssistantLine {
  model: string
  effort?: string
  gitBranch?: string
  isSidechain?: boolean
  timestamp?: string
}

/** Same encoding Claude Code uses for project folders: `:`, `\`, `/`, `.` → `-`. */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/[:\\/.]/g, '-')
}

export class FakeConfigDir {
  private constructor(readonly root: string) {}

  static async create(prefix: string, account: FakeAccountOptions): Promise<FakeConfigDir> {
    const root = await mkdtemp(join(tmpdir(), `gauges-int-${prefix}-`))
    const dir = new FakeConfigDir(root)
    await mkdir(join(root, 'sessions'), { recursive: true })
    await mkdir(join(root, 'projects'), { recursive: true })
    await writeFile(
      join(root, '.claude.json'),
      JSON.stringify({
        numStartups: 3,
        oauthAccount: {
          accountUuid: `uuid-${prefix}`,
          emailAddress: account.email,
          displayName: prefix,
          organizationUuid: `org-${prefix}`,
          organizationName: account.organizationName ?? `${prefix} org`
        }
      })
    )
    await dir.writeCredentials(account)
    await writeFile(join(root, 'settings.json'), JSON.stringify({ effortLevel: account.defaultEffort ?? 'medium' }))
    return dir
  }

  async writeCredentials(account: Pick<FakeAccountOptions, 'accessToken' | 'expiresAt' | 'subscriptionType'>): Promise<void> {
    await writeFile(
      join(this.root, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: account.accessToken,
          refreshToken: 'fake-refresh-token',
          expiresAt: account.expiresAt ?? Date.now() + 60 * 60_000,
          scopes: ['user:inference'],
          subscriptionType: account.subscriptionType ?? 'max'
        }
      })
    )
  }

  sessionFile(pid: number): string {
    return join(this.root, 'sessions', `${pid}.json`)
  }

  transcriptFile(session: Pick<FakeSession, 'cwd' | 'sessionId'>): string {
    return join(this.root, 'projects', encodeCwd(session.cwd), `${session.sessionId}.jsonl`)
  }

  async startSession(session: FakeSession): Promise<void> {
    const now = Date.now()
    await writeFile(
      this.sessionFile(session.pid),
      JSON.stringify({
        pid: session.pid,
        sessionId: session.sessionId,
        cwd: session.cwd,
        startedAt: now,
        updatedAt: now,
        version: '2.1.282',
        kind: 'interactive',
        entrypoint: 'cli',
        status: session.status ?? 'idle',
        waitingFor: session.waitingFor,
        name: session.name
      })
    )
    // A secret IPC key file sits alongside; it must be ignored.
    await writeFile(join(this.root, 'sessions', `${session.pid}.abc123.key`), 'not-json-secret')
  }

  async stopSession(pid: number): Promise<void> {
    await unlink(this.sessionFile(pid))
    await rm(join(this.root, 'sessions', `${pid}.abc123.key`), { force: true })
  }

  async createTranscript(session: Pick<FakeSession, 'cwd' | 'sessionId'>, lines: AssistantLine[] = []): Promise<void> {
    const file = this.transcriptFile(session)
    await mkdir(join(file, '..'), { recursive: true })
    const header = JSON.stringify({ type: 'user', sessionId: session.sessionId, message: { role: 'user', content: 'hi' } })
    await writeFile(file, [header, ...lines.map((l) => assistantJson(session.sessionId, l))].join('\n') + '\n')
  }

  async appendAssistant(session: Pick<FakeSession, 'cwd' | 'sessionId'>, line: AssistantLine): Promise<void> {
    await appendFile(this.transcriptFile(session), assistantJson(session.sessionId, line) + '\n')
  }

  async dispose(): Promise<void> {
    await rm(this.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

function assistantJson(sessionId: string, line: AssistantLine): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId,
    isSidechain: line.isSidechain ?? false,
    gitBranch: line.gitBranch ?? 'main',
    effort: line.effort,
    timestamp: line.timestamp ?? new Date().toISOString(),
    message: {
      model: line.model,
      role: 'assistant',
      usage: { input_tokens: 10, output_tokens: 5 }
    }
  })
}

// ---------------------------------------------------------------------------
// Usage API mock
// ---------------------------------------------------------------------------

export type UsageReply =
  | { status: 200; fiveHour: number | null; weekly: number | null }
  | { status: 401 }
  | { status: 429; retryAfter?: string }
  | { status: 500 }

/**
 * A fetch stand-in keyed by bearer token so each account can get its own
 * replies. Each token has a queue; the last reply repeats once exhausted.
 */
export class MockUsageApi {
  readonly calls: { url: string; token: string | null; beta: string | undefined }[] = []
  private readonly queues = new Map<string, UsageReply[]>()

  reply(token: string, ...replies: UsageReply[]): this {
    this.queues.set(token, [...(this.queues.get(token) ?? []), ...replies])
    return this
  }

  /** Replaces any queued replies for the token. */
  setReply(token: string, ...replies: UsageReply[]): this {
    this.queues.set(token, [...replies])
    return this
  }

  callsFor(token: string): number {
    return this.calls.filter((c) => c.token === token).length
  }

  readonly fetch: FetchLike = async (url, init) => {
    const auth = init.headers['Authorization'] ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null
    this.calls.push({ url, token, beta: init.headers['anthropic-beta'] })
    const queue = token ? this.queues.get(token) : undefined
    const reply: UsageReply = queue && queue.length > 0 ? (queue.length > 1 ? queue.shift()! : queue[0]!) : { status: 500 }

    const headers = {
      get: (name: string) =>
        reply.status === 429 && name.toLowerCase() === 'retry-after' ? (reply.retryAfter ?? null) : null
    }
    return {
      status: reply.status,
      ok: reply.status === 200,
      headers,
      json: async () =>
        reply.status === 200
          ? {
              five_hour: { utilization: reply.fiveHour, resets_at: '2026-09-25T20:00:00Z' },
              seven_day: { utilization: reply.weekly, resets_at: '2026-09-30T00:00:00Z' },
              seven_day_opus: null,
              seven_day_sonnet: { utilization: null, resets_at: null }
            }
          : { error: 'nope' }
    }
  }
}

/** Simulated process table for the registry's PID liveness check. */
export class FakeProcesses {
  private readonly alive = new Set<number>()
  add(pid: number): void {
    this.alive.add(pid)
  }
  kill(pid: number): void {
    this.alive.delete(pid)
  }
  readonly isAlive = (pid: number): boolean => this.alive.has(pid)
}
