import { useSyncExternalStore } from 'react'
import type { Account, AccountSnapshot, AppConfig } from '../shared/types'
import { getGaugesApi, type GaugesApi } from './api'

export type LoadStatus = 'loading' | 'ready' | 'error'

export interface GaugesState {
  status: LoadStatus
  error: string | null
  config: AppConfig | null
  /** Latest snapshot per account id. */
  snapshots: Record<string, AccountSnapshot>
}

export interface GaugesStore {
  getState(): GaugesState
  subscribe(listener: () => void): () => void
  /** Loads config and snapshots and starts listening for pushes. Safe to call repeatedly. */
  init(): Promise<void>
  /** Stops listening for pushes. */
  dispose(): void
  setActiveAccount(accountId: string): Promise<void>
  setConfig(patch: Partial<AppConfig>): Promise<void>
  readonly api: GaugesApi
}

export const initialGaugesState: GaugesState = {
  status: 'loading',
  error: null,
  config: null,
  snapshots: {}
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createGaugesStore(api: GaugesApi = getGaugesApi()): GaugesStore {
  let state: GaugesState = initialGaugesState
  const listeners = new Set<() => void>()
  let unsubscribers: Array<() => void> = []
  let initPromise: Promise<void> | null = null

  const setState = (patch: Partial<GaugesState>): void => {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  const applySnapshot = (snapshot: AccountSnapshot): void => {
    const current = state.snapshots[snapshot.accountId]
    if (current && current.updatedAt > snapshot.updatedAt) return
    setState({ snapshots: { ...state.snapshots, [snapshot.accountId]: snapshot } })
  }

  const applyConfig = (config: AppConfig): void => {
    setState({ config })
  }

  const runConfigCommand = async (command: () => Promise<AppConfig>): Promise<void> => {
    try {
      applyConfig(await command())
    } catch (error) {
      setState({ error: errorMessage(error) })
    }
  }

  const load = async (): Promise<void> => {
    // Subscribe first so pushes arriving during the initial fetch are not lost.
    unsubscribers = [api.onSnapshot(applySnapshot), api.onConfigChanged(applyConfig)]
    try {
      const [config, snapshots] = await Promise.all([api.getConfig(), api.getSnapshots()])
      snapshots.forEach(applySnapshot)
      setState({ config, status: 'ready', error: null })
    } catch (error) {
      setState({ status: 'error', error: errorMessage(error) })
    }
  }

  return {
    api,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    init() {
      initPromise ??= load()
      return initPromise
    },
    dispose() {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      unsubscribers = []
      initPromise = null
    },
    setActiveAccount: (accountId) => runConfigCommand(() => api.setActiveAccount(accountId)),
    setConfig: (patch) => runConfigCommand(() => api.setConfig(patch))
  }
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function selectActiveAccount(state: GaugesState): Account | null {
  const config = state.config
  if (!config || config.accounts.length === 0) return null
  return config.accounts.find((a) => a.id === config.activeAccountId) ?? config.accounts[0] ?? null
}

export function selectActiveSnapshot(state: GaugesState): AccountSnapshot | null {
  const account = selectActiveAccount(state)
  return account ? (state.snapshots[account.id] ?? null) : null
}

/** Tab label: the custom label, else the email from the latest snapshot, else the config dir. */
export function accountLabel(account: Account, snapshot: AccountSnapshot | null | undefined): string {
  return account.label.trim() || snapshot?.identity?.email || account.configDir
}

// ---------------------------------------------------------------------------
// React bindings
// ---------------------------------------------------------------------------

let defaultStore: GaugesStore | null = null

export function getGaugesStore(): GaugesStore {
  defaultStore ??= createGaugesStore()
  return defaultStore
}

/** Replaces the app-wide store (useful in tests). */
export function setGaugesStore(store: GaugesStore | null): void {
  defaultStore = store
}

/** Subscribes a component to a slice of the store. Selectors must return stable references. */
export function useGauges<T>(selector: (state: GaugesState) => T, store: GaugesStore = getGaugesStore()): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState())
  )
}
