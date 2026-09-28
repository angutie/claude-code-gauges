import type { AccountSnapshot, AddAccountResult, AppConfig } from '../shared/types'

/**
 * The contract the preload script exposes on `window.gauges`.
 * The renderer only ever talks to the main process through this interface.
 */
export interface GaugesApi {
  getConfig(): Promise<AppConfig>
  setConfig(patch: Partial<AppConfig>): Promise<AppConfig>
  getSnapshots(): Promise<AccountSnapshot[]>
  addAccount(): Promise<AddAccountResult>
  removeAccount(accountId: string): Promise<AppConfig>
  setActiveAccount(accountId: string): Promise<AppConfig>
  refreshUsage(accountId?: string): Promise<void>
  /** Subscribes to snapshot pushes; returns an unsubscribe function. */
  onSnapshot(listener: (snapshot: AccountSnapshot) => void): () => void
  /** Subscribes to config pushes; returns an unsubscribe function. */
  onConfigChanged(listener: (config: AppConfig) => void): () => void
}

/** In-memory API used in tests and when the renderer runs outside Electron. */
export interface FallbackGaugesApi extends GaugesApi {
  emitSnapshot(snapshot: AccountSnapshot): void
  emitConfig(config: AppConfig): void
}

export function createEmptyConfig(): AppConfig {
  return {
    accounts: [],
    activeAccountId: null,
    watchedSessionIds: {},
    widgets: {
      sessions: true,
      model: true,
      effort: true,
      usage5h: true,
      usageWeekly: true,
      branch: true,
      status: true
    },
    usagePollSeconds: 90,
    alwaysOnTop: false,
    windowBounds: null
  }
}

export function createFallbackApi(
  initialConfig: AppConfig = createEmptyConfig(),
  initialSnapshots: AccountSnapshot[] = []
): FallbackGaugesApi {
  let config = initialConfig
  const snapshots = new Map(initialSnapshots.map((s) => [s.accountId, s]))
  const snapshotListeners = new Set<(snapshot: AccountSnapshot) => void>()
  const configListeners = new Set<(config: AppConfig) => void>()

  const updateConfig = (next: AppConfig): AppConfig => {
    config = next
    configListeners.forEach((listener) => listener(config))
    return config
  }

  return {
    getConfig: async () => config,
    setConfig: async (patch) => updateConfig({ ...config, ...patch }),
    getSnapshots: async () => [...snapshots.values()],
    addAccount: async () => ({
      ok: false,
      error: 'Adding accounts is not available outside the desktop app'
    }),
    removeAccount: async (accountId) =>
      updateConfig({
        ...config,
        accounts: config.accounts.filter((a) => a.id !== accountId),
        activeAccountId: config.activeAccountId === accountId ? null : config.activeAccountId
      }),
    setActiveAccount: async (accountId) => updateConfig({ ...config, activeAccountId: accountId }),
    refreshUsage: async () => undefined,
    onSnapshot: (listener) => {
      snapshotListeners.add(listener)
      return () => snapshotListeners.delete(listener)
    },
    onConfigChanged: (listener) => {
      configListeners.add(listener)
      return () => configListeners.delete(listener)
    },
    emitSnapshot: (snapshot) => {
      snapshots.set(snapshot.accountId, snapshot)
      snapshotListeners.forEach((listener) => listener(snapshot))
    },
    emitConfig: (next) => {
      updateConfig(next)
    }
  }
}

/** Returns the preload bridge when present, otherwise an in-memory fallback. */
export function getGaugesApi(): GaugesApi {
  const bridge = (globalThis as { gauges?: Partial<GaugesApi> }).gauges
  if (bridge && typeof bridge.onSnapshot === 'function' && typeof bridge.getConfig === 'function') {
    return bridge as GaugesApi
  }
  return createFallbackApi()
}
