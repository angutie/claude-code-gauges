import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { EpochMs } from '../../shared/types'

/**
 * Incremental reader for session transcripts:
 * `<configDir>/projects/<encoded-cwd>/<sessionId>.jsonl`.
 *
 * Transcripts are append-only and can grow to several MB, so each file keeps
 * a byte offset and only newly appended bytes are read. A trailing line with
 * no `\n` yet is buffered (as raw bytes, so multi-byte UTF-8 characters split
 * across reads stay intact) until the rest of it arrives.
 */

export const PROJECTS_DIR_NAME = 'projects'
export const SETTINGS_FILE_NAME = 'settings.json'

const NEWLINE = 0x0a

/** State accumulated from a transcript. Every field is null until seen. */
export interface TranscriptState {
  /** `message.model` of the latest non-sidechain assistant line. */
  model: string | null
  /** `perTurnEffort` (or `effort`) of the latest non-sidechain assistant line. */
  effort: string | null
  gitBranch: string | null
  /** Timestamp of the latest non-sidechain assistant line. */
  lastActivityAt: EpochMs | null
  /** From the latest `custom-title` line. */
  customTitle: string | null
  /** From the latest `agent-name` line. */
  agentName: string | null
}

/** What callers consume: transcript state merged with the settings.json effort fallback. */
export interface TranscriptInfo {
  model: string | null
  effort: string | null
  /** True when effort came from settings.json rather than the transcript. */
  effortIsDefault: boolean
  gitBranch: string | null
  lastActivityAt: EpochMs | null
  /** custom-title wins over agent-name. */
  title: string | null
  /** Resolved transcript path, or null when no transcript exists yet. */
  transcriptPath: string | null
}

export function emptyTranscriptState(): TranscriptState {
  return {
    model: null,
    effort: null,
    gitBranch: null,
    lastActivityAt: null,
    customTitle: null,
    agentName: null
  }
}

// ---------------------------------------------------------------------------
// Line parsing
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function parseTimestamp(value: unknown): EpochMs | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Folds one JSONL line into `state` (mutating it). Malformed or irrelevant
 * lines are ignored. Sidechain (subagent) assistant lines never override the
 * main session's model, effort, or branch.
 */
export function applyTranscriptLine(state: TranscriptState, line: string): void {
  const trimmed = line.trim()
  if (trimmed === '') return

  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch {
    return
  }
  if (!isRecord(raw)) return

  switch (raw.type) {
    case 'assistant':
      applyAssistantLine(state, raw)
      break
    case 'custom-title':
      state.customTitle = optionalString(raw.customTitle) ?? state.customTitle
      break
    case 'agent-name':
      state.agentName = optionalString(raw.agentName) ?? state.agentName
      break
  }
}

function applyAssistantLine(state: TranscriptState, raw: Record<string, unknown>): void {
  if (raw.isSidechain === true) return

  const message = isRecord(raw.message) ? raw.message : null
  const model = optionalString(message?.model)
  // Synthetic placeholder messages (e.g. API errors) are not a real model switch.
  if (model && model !== '<synthetic>') state.model = model

  state.effort = optionalString(raw.perTurnEffort) ?? optionalString(raw.effort) ?? state.effort
  state.gitBranch = optionalString(raw.gitBranch) ?? state.gitBranch

  const timestamp = parseTimestamp(raw.timestamp)
  if (timestamp !== null && (state.lastActivityAt === null || timestamp >= state.lastActivityAt)) {
    state.lastActivityAt = timestamp
  }
}

// ---------------------------------------------------------------------------
// Incremental file tail
// ---------------------------------------------------------------------------

/** Tails a single JSONL file, reading only bytes appended since the last call. */
export class TranscriptFileTail {
  readonly path: string
  private offset = 0
  private pending: Buffer = Buffer.alloc(0)
  private state: TranscriptState = emptyTranscriptState()

  constructor(path: string) {
    this.path = path
  }

  /** Bytes consumed so far (including any buffered partial line). */
  get bytesRead(): number {
    return this.offset
  }

  get current(): TranscriptState {
    return { ...this.state }
  }

  /**
   * Reads newly appended bytes and returns the updated state. A file that
   * shrank is treated as replaced and re-read from the start. A missing or
   * unreadable file leaves the state unchanged.
   */
  async update(): Promise<TranscriptState> {
    let handle: fs.FileHandle
    try {
      handle = await fs.open(this.path, 'r')
    } catch {
      return this.current
    }

    try {
      const { size } = await handle.stat()
      if (size < this.offset) this.reset()
      if (size === this.offset) return this.current

      const length = size - this.offset
      const chunk = Buffer.alloc(length)
      let filled = 0
      while (filled < length) {
        const { bytesRead } = await handle.read(chunk, filled, length - filled, this.offset + filled)
        if (bytesRead === 0) break
        filled += bytesRead
      }

      this.offset += filled
      this.consume(chunk.subarray(0, filled))
    } catch {
      // Transient read failure: keep what we have and retry on the next update.
    } finally {
      await handle.close().catch(() => undefined)
    }

    return this.current
  }

  private consume(chunk: Buffer): void {
    const data = this.pending.length > 0 ? Buffer.concat([this.pending, chunk]) : chunk
    let start = 0
    let newline = data.indexOf(NEWLINE, start)
    while (newline !== -1) {
      applyTranscriptLine(this.state, data.toString('utf8', start, newline))
      start = newline + 1
      newline = data.indexOf(NEWLINE, start)
    }
    // Copy so the retained partial line doesn't pin the whole chunk in memory.
    this.pending = Buffer.from(data.subarray(start))
  }

  private reset(): void {
    this.offset = 0
    this.pending = Buffer.alloc(0)
    this.state = emptyTranscriptState()
  }
}

// ---------------------------------------------------------------------------
// Locating transcripts and settings
// ---------------------------------------------------------------------------

export function projectsDirFor(configDir: string): string {
  return join(configDir, PROJECTS_DIR_NAME)
}

/**
 * Finds `<configDir>/projects/* /<sessionId>.jsonl`, matching names
 * case-insensitively (encoded project dirs may differ in drive-letter case).
 * When several match, the most recently modified wins. Returns null when absent.
 */
export async function findTranscriptPath(
  configDir: string,
  sessionId: string
): Promise<string | null> {
  const projectsDir = projectsDirFor(configDir)
  const wanted = `${sessionId}.jsonl`.toLowerCase()

  let projects: string[]
  try {
    projects = await fs.readdir(projectsDir)
  } catch {
    return null
  }

  const candidates = await Promise.all(
    projects.map(async (project) => {
      const dir = join(projectsDir, project)
      try {
        const files = await fs.readdir(dir)
        const match = files.find((name) => name.toLowerCase() === wanted)
        if (!match) return null
        const path = join(dir, match)
        const stat = await fs.stat(path)
        return stat.isFile() ? { path, mtimeMs: stat.mtimeMs } : null
      } catch {
        return null
      }
    })
  )

  let best: { path: string; mtimeMs: number } | null = null
  for (const candidate of candidates) {
    if (candidate && (!best || candidate.mtimeMs > best.mtimeMs)) best = candidate
  }
  return best?.path ?? null
}

/** Reads `effortLevel` from `<configDir>/settings.json`; null when missing or malformed. */
export async function readDefaultEffort(configDir: string): Promise<string | null> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(join(configDir, SETTINGS_FILE_NAME), 'utf8'))
    return isRecord(raw) ? optionalString(raw.effortLevel) : null
  } catch {
    return null
  }
}

export function toTranscriptInfo(
  state: TranscriptState,
  defaultEffort: string | null,
  transcriptPath: string | null
): TranscriptInfo {
  return {
    model: state.model,
    effort: state.effort ?? defaultEffort,
    effortIsDefault: state.effort === null && defaultEffort !== null,
    gitBranch: state.gitBranch,
    lastActivityAt: state.lastActivityAt,
    title: state.customTitle ?? state.agentName,
    transcriptPath
  }
}

// ---------------------------------------------------------------------------
// Per-account reader
// ---------------------------------------------------------------------------

/**
 * Keeps one tail per session for a config dir. Sessions whose transcript
 * doesn't exist yet are re-located on each read until it appears.
 */
export class TranscriptReader {
  readonly configDir: string
  private readonly tails = new Map<string, TranscriptFileTail>()

  constructor(configDir: string) {
    this.configDir = configDir
  }

  /** Transcript path for a session, if one has been located. */
  pathFor(sessionId: string): string | null {
    return this.tails.get(sessionId)?.path ?? null
  }

  async read(sessionId: string): Promise<TranscriptInfo> {
    const [state, defaultEffort] = await Promise.all([
      this.readState(sessionId),
      readDefaultEffort(this.configDir)
    ])
    return toTranscriptInfo(state, defaultEffort, this.pathFor(sessionId))
  }

  /** Reads several sessions, sharing a single settings.json read. */
  async readMany(sessionIds: readonly string[]): Promise<Map<string, TranscriptInfo>> {
    const defaultEffort = await readDefaultEffort(this.configDir)
    const entries = await Promise.all(
      sessionIds.map(async (id) => {
        const state = await this.readState(id)
        return [id, toTranscriptInfo(state, defaultEffort, this.pathFor(id))] as const
      })
    )
    return new Map(entries)
  }

  /** Drops tails for sessions not in `keep` (e.g. sessions that ended). */
  prune(keep: Iterable<string>): void {
    const keepSet = new Set(keep)
    for (const id of this.tails.keys()) {
      if (!keepSet.has(id)) this.tails.delete(id)
    }
  }

  private async readState(sessionId: string): Promise<TranscriptState> {
    let tail = this.tails.get(sessionId)
    if (!tail) {
      const path = await findTranscriptPath(this.configDir, sessionId)
      if (!path) return emptyTranscriptState()
      tail = new TranscriptFileTail(path)
      this.tails.set(sessionId, tail)
    }
    return tail.update()
  }
}
