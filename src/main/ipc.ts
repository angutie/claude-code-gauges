import { randomUUID } from 'node:crypto'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  IPC_CHANNELS,
  type Account,
  type AccountSnapshot,
  type AddAccountResult,
  type AppConfig,
  type WatchedSessions
} from '../shared/types'
import { AccountMonitor, type AccountMonitorOptions } from './account-monitor'
import type { ConfigStore } from './config-store'
import { validateConfigDir as defaultValidateConfigDir, type ValidateConfigDirResult } from './sources/account-reader'

/**
 * Owns the per-account monitors and implements every renderer → main command.
 * Kept free of runtime Electron imports so it can be unit tested; index.ts
 * supplies the window-bound pieces (send, directory picker) and ipcMain.
 */

/** The subset of AccountMonitor the controller drives. */
export interface MonitorLike {
  readonly snapshot: AccountSnapshot | null
  start(): Promise<void>
  dispose(): Promise<void>
  refreshUsage(force?: boolean): Promise<void>
  setWatched(watched: WatchedSessions | undefined): void
  setUsagePollSeconds(seconds: number): void
}

export type MonitorFactory = (
  options: Pick<AccountMonitorOptions, 'account' | 'watched' | 'usagePollSeconds' | 'onSnapshot' | 'onError'>
) => MonitorLike

/** Where the config-store lives in the controller (ConfigStore satisfies this). */
export type ConfigStoreLike = Pick<ConfigStore, 'get' | 'set' | 'update'>

export interface GaugesControllerOptions {
  store: ConfigStoreLike
  /** Pushes a message to the renderer (no-op when there is no window). */
  send: (channel: string, payload: unknown) => void
  /** Opens a directory picker; resolves to null when the user cancels. */
  pickDirectory: () => Promise<string | null>
  createMonitor?: MonitorFactory
  validateConfigDir?: (configDir: string) => Promise<ValidateConfigDirResult>
  /** Called after every config change (e.g. to apply alwaysOnTop to the window). */
  onConfigApplied?: (config: AppConfig) => void
  onError?: (error: unknown) => void
}

const defaultMonitorFactory: MonitorFactory = (options) => new AccountMonitor(options)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Windows paths are case-insensitive and may use either separator. */
function normalizeDir(dir: string): string {
  const trimmed = dir.trim().replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? trimmed.replace(/\//g, '\\').toLowerCase() : trimmed
}

function watchedKey(watched: WatchedSessions | undefined): string {
  return JSON.stringify(watched ?? 'all')
}

interface MonitorEntry {
  account: Account
  monitor: MonitorLike
}

export class GaugesController {
  private readonly monitors = new Map<string, MonitorEntry>()
  private readonly createMonitor: MonitorFactory
  private readonly validateDir: (configDir: string) => Promise<ValidateConfigDirResult>
  private config: AppConfig
  private disposed = false

  constructor(private readonly options: GaugesControllerOptions) {
    this.createMonitor = options.createMonitor ?? defaultMonitorFactory
    this.validateDir = options.validateConfigDir ?? ((dir) => defaultValidateConfigDir(dir))
    this.config = options.store.get()
  }

  /** Starts monitors for every configured account. */
  async start(): Promise<void> {
    this.options.onConfigApplied?.(this.config)
    await this.reconcile(null, this.config)
  }

  getConfig(): AppConfig {
    return structuredClone(this.config)
  }

  getSnapshots(): AccountSnapshot[] {
    const snapshots: AccountSnapshot[] = []
    for (const { monitor } of this.monitors.values()) {
      if (monitor.snapshot) snapshots.push(monitor.snapshot)
    }
    return snapshots
  }

  /** Applies an untrusted partial config from the renderer. */
  async setConfig(patch: unknown): Promise<AppConfig> {
    if (!isRecord(patch)) throw new Error('Invalid config update.')
    return this.applyConfig({ ...this.config, ...patch })
  }

  async addAccount(): Promise<AddAccountResult> {
    let picked: string | null
    try {
      picked = await this.options.pickDirectory()
    } catch (error) {
      return { ok: false, error: `Could not open the folder picker: ${errorMessage(error)}` }
    }
    if (!picked) return { ok: false, cancelled: true, error: 'No folder was selected.' }
    return this.addAccountFromDir(picked)
  }

  /** Validates a config dir and links it as a new, active account. */
  async addAccountFromDir(dir: string): Promise<AddAccountResult> {
    let validation: ValidateConfigDirResult
    try {
      validation = await this.validateDir(dir)
    } catch (error) {
      return { ok: false, error: `Could not read ${dir}: ${errorMessage(error)}` }
    }
    if (!validation.ok) return { ok: false, error: validation.error }

    const configDir = validation.configDir
    const existing = this.config.accounts.find((a) => normalizeDir(a.configDir) === normalizeDir(configDir))
    if (existing) {
      const label = existing.label || validation.identity.email || existing.configDir
      return { ok: false, error: `${configDir} is already linked (${label}).` }
    }

    const account: Account = { id: randomUUID(), label: '', configDir }
    try {
      const config = await this.applyConfig({
        ...this.config,
        accounts: [...this.config.accounts, account],
        activeAccountId: account.id
      })
      return { ok: true, account, config }
    } catch (error) {
      return { ok: false, error: `Could not save the account: ${errorMessage(error)}` }
    }
  }

  async removeAccount(accountId: unknown): Promise<AppConfig> {
    if (typeof accountId !== 'string') throw new Error('Invalid account id.')
    if (!this.config.accounts.some((a) => a.id === accountId)) return this.getConfig()

    const accounts = this.config.accounts.filter((a) => a.id !== accountId)
    const { [accountId]: _removed, ...watchedSessionIds } = this.config.watchedSessionIds
    const activeAccountId =
      this.config.activeAccountId === accountId ? (accounts[0]?.id ?? null) : this.config.activeAccountId
    return this.applyConfig({ ...this.config, accounts, watchedSessionIds, activeAccountId })
  }

  async setActiveAccount(accountId: unknown): Promise<AppConfig> {
    if (typeof accountId !== 'string' || !this.config.accounts.some((a) => a.id === accountId)) {
      throw new Error('Unknown account.')
    }
    const config =
      this.config.activeAccountId === accountId
        ? this.getConfig()
        : await this.applyConfig({ ...this.config, activeAccountId: accountId })
    void this.monitors.get(accountId)?.monitor.refreshUsage().catch((error) => this.reportError(error))
    return config
  }

  /** Forces a usage refresh for one account, or the active one when omitted. */
  async refreshUsage(accountId?: unknown): Promise<void> {
    const id = typeof accountId === 'string' ? accountId : this.config.activeAccountId
    if (!id) return
    await this.monitors.get(id)?.monitor.refreshUsage(true)
  }

  /** Window focus: refresh usage everywhere; monitors throttle and respect backoff themselves. */
  handleFocus(): void {
    for (const { monitor } of this.monitors.values()) {
      void monitor.refreshUsage().catch((error) => this.reportError(error))
    }
  }

  /** Persists window bounds without broadcasting (the renderer does not care). */
  async saveWindowState(
    patch: Pick<Partial<AppConfig>, 'windowBounds' | 'miniWindowBounds' | 'alwaysOnTop'>
  ): Promise<void> {
    this.config = await this.options.store.update(patch)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const entries = [...this.monitors.values()]
    this.monitors.clear()
    await Promise.all(entries.map(({ monitor }) => monitor.dispose().catch((error) => this.reportError(error))))
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async applyConfig(next: AppConfig): Promise<AppConfig> {
    const previous = this.config
    this.config = await this.options.store.set(next)
    await this.reconcile(previous, this.config)
    this.options.onConfigApplied?.(this.config)
    this.options.send(IPC_CHANNELS.configChanged, this.getConfig())
    return this.getConfig()
  }

  /** Starts, restarts, reconfigures, or disposes monitors so they match `next`. */
  private async reconcile(previous: AppConfig | null, next: AppConfig): Promise<void> {
    if (this.disposed) return
    const stale: MonitorEntry[] = []

    for (const [id, entry] of this.monitors) {
      const account = next.accounts.find((a) => a.id === id)
      if (!account || normalizeDir(account.configDir) !== normalizeDir(entry.account.configDir)) {
        stale.push(entry)
        this.monitors.delete(id)
      } else {
        entry.account = account
      }
    }
    await Promise.all(stale.map(({ monitor }) => monitor.dispose().catch((error) => this.reportError(error))))

    const pollChanged = previous !== null && previous.usagePollSeconds !== next.usagePollSeconds
    const starts: Promise<void>[] = []

    for (const account of next.accounts) {
      const watched = next.watchedSessionIds[account.id]
      const existing = this.monitors.get(account.id)
      if (existing) {
        if (previous && watchedKey(previous.watchedSessionIds[account.id]) !== watchedKey(watched)) {
          existing.monitor.setWatched(watched)
        }
        if (pollChanged) existing.monitor.setUsagePollSeconds(next.usagePollSeconds)
        continue
      }
      const monitor = this.createMonitor({
        account,
        watched,
        usagePollSeconds: next.usagePollSeconds,
        onSnapshot: (snapshot) => this.pushSnapshot(account.id, monitor, snapshot),
        onError: (error) => this.reportError(error)
      })
      this.monitors.set(account.id, { account, monitor })
      starts.push(monitor.start().catch((error) => this.reportError(error)))
    }

    // Don't hold up the IPC reply on the first usage poll; snapshots arrive via push.
    void Promise.all(starts)
  }

  private pushSnapshot(accountId: string, monitor: MonitorLike, snapshot: AccountSnapshot): void {
    // Drop late emits from monitors that were replaced or removed.
    if (this.disposed || this.monitors.get(accountId)?.monitor !== monitor) return
    this.options.send(IPC_CHANNELS.snapshot, snapshot)
  }

  private reportError(error: unknown): void {
    try {
      this.options.onError?.(error)
    } catch {
      // Never let error reporting break the controller.
    }
  }
}

/** Registers every invoke handler; returns a function that removes them. */
export function registerIpcHandlers(ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>, controller: GaugesController): () => void {
  const handlers: Record<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown> = {
    [IPC_CHANNELS.getConfig]: () => controller.getConfig(),
    [IPC_CHANNELS.setConfig]: (_event, patch) => controller.setConfig(patch),
    [IPC_CHANNELS.getSnapshots]: () => controller.getSnapshots(),
    [IPC_CHANNELS.addAccount]: () => controller.addAccount(),
    [IPC_CHANNELS.removeAccount]: (_event, accountId) => controller.removeAccount(accountId),
    [IPC_CHANNELS.setActiveAccount]: (_event, accountId) => controller.setActiveAccount(accountId),
    [IPC_CHANNELS.refreshUsage]: (_event, accountId) => controller.refreshUsage(accountId)
  }
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, handler)
  }
  return () => {
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel)
  }
}
