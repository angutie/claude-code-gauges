import { describe, expect, it } from 'vitest'
import type { AccountSnapshot, AppConfig } from '../src/shared/types'
import { createEmptyConfig, createFallbackApi, type GaugesApi } from '../src/renderer/api'
import {
  accountLabel,
  createGaugesStore,
  selectActiveAccount,
  selectActiveSnapshot
} from '../src/renderer/store'
import { gaugeLevel } from '../src/renderer/theme'

function makeConfig(): AppConfig {
  return {
    ...createEmptyConfig(),
    accounts: [
      { id: 'a', label: '', configDir: '/home/me/.claude' },
      { id: 'b', label: 'Work', configDir: '/home/me/.claude-work' }
    ],
    activeAccountId: 'a'
  }
}

function makeSnapshot(accountId: string, updatedAt: number, email = 'me@example.com'): AccountSnapshot {
  return {
    accountId,
    identity: {
      email,
      displayName: null,
      organizationName: null,
      subscriptionType: 'max',
      tokenStatus: 'valid',
      tokenExpiresAt: null
    },
    sessions: [],
    availableSessions: [],
    usage: {
      status: 'loading',
      fiveHour: null,
      weekly: null,
      weeklyOpus: null,
      weeklySonnet: null,
      lastSuccessAt: null,
      lastAttemptAt: null,
      nextPollAt: null,
      message: null
    },
    updatedAt
  }
}

describe('renderer gauges store', () => {
  it('starts in the loading state with no data', () => {
    const store = createGaugesStore(createFallbackApi())
    const state = store.getState()
    expect(state.status).toBe('loading')
    expect(state.config).toBeNull()
    expect(selectActiveAccount(state)).toBeNull()
    expect(selectActiveSnapshot(state)).toBeNull()
  })

  it('loads config and initial snapshots on init', async () => {
    const store = createGaugesStore(createFallbackApi(makeConfig(), [makeSnapshot('a', 1)]))
    await store.init()
    const state = store.getState()
    expect(state.status).toBe('ready')
    expect(selectActiveAccount(state)?.id).toBe('a')
    expect(selectActiveSnapshot(state)?.updatedAt).toBe(1)
  })

  it('updates and notifies subscribers when a snapshot event fires', async () => {
    const api = createFallbackApi(makeConfig())
    const store = createGaugesStore(api)
    await store.init()

    let notifications = 0
    store.subscribe(() => notifications++)
    api.emitSnapshot(makeSnapshot('a', 10))

    expect(notifications).toBeGreaterThan(0)
    expect(store.getState().snapshots['a']?.updatedAt).toBe(10)
    expect(selectActiveSnapshot(store.getState())?.updatedAt).toBe(10)
  })

  it('ignores out-of-order older snapshots', async () => {
    const api = createFallbackApi(makeConfig())
    const store = createGaugesStore(api)
    await store.init()
    api.emitSnapshot(makeSnapshot('a', 10))
    api.emitSnapshot(makeSnapshot('a', 5))
    expect(store.getState().snapshots['a']?.updatedAt).toBe(10)
  })

  it('mirrors config changes and active account switches', async () => {
    const api = createFallbackApi(makeConfig())
    const store = createGaugesStore(api)
    await store.init()

    await store.setActiveAccount('b')
    expect(selectActiveAccount(store.getState())?.id).toBe('b')

    api.emitConfig({ ...makeConfig(), alwaysOnTop: true })
    expect(store.getState().config?.alwaysOnTop).toBe(true)
  })

  it('stops receiving events after dispose', async () => {
    const api = createFallbackApi(makeConfig())
    const store = createGaugesStore(api)
    await store.init()
    store.dispose()
    api.emitSnapshot(makeSnapshot('a', 99))
    expect(store.getState().snapshots['a']).toBeUndefined()
  })

  it('enters the error state when the API fails', async () => {
    const failing: GaugesApi = {
      ...createFallbackApi(),
      getConfig: () => Promise.reject(new Error('boom'))
    }
    const store = createGaugesStore(failing)
    await store.init()
    expect(store.getState().status).toBe('error')
    expect(store.getState().error).toBe('boom')
  })

  it('labels accounts by custom label, then email, then config dir', () => {
    const [a, b] = makeConfig().accounts
    expect(accountLabel(b!, null)).toBe('Work')
    expect(accountLabel(a!, makeSnapshot('a', 1, 'x@example.com'))).toBe('x@example.com')
    expect(accountLabel(a!, null)).toBe('/home/me/.claude')
  })
})

describe('gauge threshold levels', () => {
  it('maps percentages to normal, warning, critical, and unknown', () => {
    expect(gaugeLevel(null)).toBe('unknown')
    expect(gaugeLevel(0)).toBe('normal')
    expect(gaugeLevel(69.9)).toBe('normal')
    expect(gaugeLevel(70)).toBe('warning')
    expect(gaugeLevel(90)).toBe('warning')
    expect(gaugeLevel(90.1)).toBe('critical')
  })
})
