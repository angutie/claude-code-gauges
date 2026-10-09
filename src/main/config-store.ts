import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  WIDGET_KEYS,
  WINDOW_MODES,
  type Account,
  type AppConfig,
  type WatchedSessions,
  type WidgetToggles,
  type WindowBounds,
  type WindowMode
} from '../shared/types'

/**
 * Persists AppConfig as JSON in a caller-provided directory
 * (app.getPath('userData') at runtime, a temp dir in tests).
 * Deliberately free of Electron imports so it can be unit tested.
 */

export const CONFIG_FILE_NAME = 'config.json'
export const DEFAULT_ACCOUNT_ID = 'default'
export const DEFAULT_USAGE_POLL_SECONDS = 90
export const MIN_USAGE_POLL_SECONDS = 60
export const MAX_USAGE_POLL_SECONDS = 600

export interface DefaultsOptions {
  env?: NodeJS.ProcessEnv
  homeDir?: string
}

export function resolveDefaultConfigDir(options: DefaultsOptions = {}): string {
  const env = options.env ?? process.env
  const fromEnv = env['CLAUDE_CONFIG_DIR']?.trim()
  if (fromEnv) return fromEnv
  return join(options.homeDir ?? homedir(), '.claude')
}

export function createDefaultConfig(options: DefaultsOptions = {}): AppConfig {
  const widgets = Object.fromEntries(WIDGET_KEYS.map((key) => [key, true])) as WidgetToggles
  return {
    accounts: [{ id: DEFAULT_ACCOUNT_ID, label: '', configDir: resolveDefaultConfigDir(options) }],
    activeAccountId: DEFAULT_ACCOUNT_ID,
    watchedSessionIds: {},
    widgets,
    usagePollSeconds: DEFAULT_USAGE_POLL_SECONDS,
    alwaysOnTop: false,
    windowBounds: null,
    windowMode: 'max',
    miniWindowBounds: null
  }
}

export function clampPollSeconds(value: number): number {
  return Math.min(MAX_USAGE_POLL_SECONDS, Math.max(MIN_USAGE_POLL_SECONDS, Math.round(value)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseAccounts(raw: unknown): Account[] | null {
  if (!Array.isArray(raw)) return null
  const seen = new Set<string>()
  const accounts: Account[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const { id, label, configDir } = item
    if (typeof id !== 'string' || !id || seen.has(id)) continue
    if (typeof configDir !== 'string' || !configDir.trim()) continue
    seen.add(id)
    accounts.push({ id, label: typeof label === 'string' ? label : '', configDir })
  }
  return accounts.length > 0 ? accounts : null
}

function parseWatched(raw: unknown, accountIds: Set<string>): Record<string, WatchedSessions> {
  const result: Record<string, WatchedSessions> = {}
  if (!isRecord(raw)) return result
  for (const [accountId, value] of Object.entries(raw)) {
    if (!accountIds.has(accountId)) continue
    if (value === 'all') {
      result[accountId] = 'all'
    } else if (Array.isArray(value)) {
      result[accountId] = [...new Set(value.filter((id): id is string => typeof id === 'string'))]
    }
  }
  return result
}

function parseWidgets(raw: unknown, defaults: WidgetToggles): WidgetToggles {
  const widgets = { ...defaults }
  if (!isRecord(raw)) return widgets
  for (const key of WIDGET_KEYS) {
    const value = raw[key]
    if (typeof value === 'boolean') widgets[key] = value
  }
  return widgets
}

function parseWindowBounds(raw: unknown): WindowBounds | null {
  if (!isRecord(raw)) return null
  const { x, y, width, height } = raw
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) return null
  const bounds: WindowBounds = { width, height }
  if (isFiniteNumber(x)) bounds.x = x
  if (isFiniteNumber(y)) bounds.y = y
  return bounds
}

function isWindowMode(value: unknown): value is WindowMode {
  return typeof value === 'string' && (WINDOW_MODES as readonly string[]).includes(value)
}

/** Merges an untrusted (possibly partial) config object over the defaults. */
export function mergeWithDefaults(raw: unknown, defaults: AppConfig = createDefaultConfig()): AppConfig {
  if (!isRecord(raw)) return structuredClone(defaults)

  const accounts = parseAccounts(raw['accounts']) ?? structuredClone(defaults.accounts)
  const accountIds = new Set(accounts.map((account) => account.id))
  const rawActive = raw['activeAccountId']
  const activeAccountId =
    typeof rawActive === 'string' && accountIds.has(rawActive) ? rawActive : (accounts[0]?.id ?? null)

  const rawPoll = raw['usagePollSeconds']
  const rawAlwaysOnTop = raw['alwaysOnTop']
  const rawWindowMode = raw['windowMode']

  return {
    accounts,
    activeAccountId,
    watchedSessionIds: parseWatched(raw['watchedSessionIds'], accountIds),
    widgets: parseWidgets(raw['widgets'], defaults.widgets),
    usagePollSeconds: isFiniteNumber(rawPoll) ? clampPollSeconds(rawPoll) : defaults.usagePollSeconds,
    alwaysOnTop: typeof rawAlwaysOnTop === 'boolean' ? rawAlwaysOnTop : defaults.alwaysOnTop,
    windowBounds:
      'windowBounds' in raw ? parseWindowBounds(raw['windowBounds']) : structuredClone(defaults.windowBounds),
    windowMode: isWindowMode(rawWindowMode) ? rawWindowMode : defaults.windowMode,
    miniWindowBounds:
      'miniWindowBounds' in raw
        ? parseWindowBounds(raw['miniWindowBounds'])
        : structuredClone(defaults.miniWindowBounds)
  }
}

export function configFilePath(dir: string): string {
  return join(dir, CONFIG_FILE_NAME)
}

/** Loads the config; a missing, unreadable, or corrupt file yields the defaults. */
export async function loadConfig(dir: string, options: DefaultsOptions = {}): Promise<AppConfig> {
  const defaults = createDefaultConfig(options)
  let text: string
  try {
    text = await fs.readFile(configFilePath(dir), 'utf8')
  } catch {
    return defaults
  }
  try {
    return mergeWithDefaults(JSON.parse(text) as unknown, defaults)
  } catch {
    return defaults
  }
}

const RENAME_RETRIES = 5
const RENAME_RETRY_DELAY_MS = 20

/** Renames with a few retries: Windows can briefly lock the target (AV scanners, indexers). */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const retryable = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
      if (!retryable || attempt >= RENAME_RETRIES) throw error
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS * (attempt + 1)))
    }
  }
}

/** Atomically writes the config: write a sibling temp file, then rename over the target. */
export async function saveConfig(dir: string, config: AppConfig): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  const target = configFilePath(dir)
  const temp = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await fs.writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    await renameWithRetry(temp, target)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

/** In-memory config holder that serializes writes so saves never interleave. */
export class ConfigStore {
  private config: AppConfig
  private writeChain: Promise<void> = Promise.resolve()

  private constructor(
    private readonly dir: string,
    initial: AppConfig,
    private readonly defaults: AppConfig
  ) {
    this.config = initial
  }

  static async open(dir: string, options: DefaultsOptions = {}): Promise<ConfigStore> {
    const defaults = createDefaultConfig(options)
    const initial = await loadConfig(dir, options)
    return new ConfigStore(dir, initial, defaults)
  }

  get(): AppConfig {
    return structuredClone(this.config)
  }

  /** Merges a partial update, validates it against the defaults, and persists it. */
  async update(patch: Partial<AppConfig>): Promise<AppConfig> {
    return this.set({ ...this.config, ...patch })
  }

  async set(next: unknown): Promise<AppConfig> {
    this.config = mergeWithDefaults(next, this.defaults)
    const snapshot = structuredClone(this.config)
    const write = this.writeChain.then(() => saveConfig(this.dir, snapshot))
    this.writeChain = write.catch(() => undefined)
    await write
    return structuredClone(snapshot)
  }
}
