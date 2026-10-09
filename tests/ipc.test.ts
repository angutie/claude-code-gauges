import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigStore, loadConfig } from '../src/main/config-store'
import { GaugesController, registerIpcHandlers, type MonitorFactory, type MonitorLike } from '../src/main/ipc'
import type { ValidateConfigDirResult } from '../src/main/sources/account-reader'
import { IPC_CHANNELS, type AccountSnapshot, type WatchedSessions } from '../src/shared/types'

class FakeMonitor implements MonitorLike {
  snapshot: AccountSnapshot | null = null
  started = false
  disposed = false
  refreshCalls: Array<boolean | undefined> = []
  watchedCalls: Array<WatchedSessions | undefined> = []
  pollCalls: number[] = []

  constructor(readonly options: Parameters<MonitorFactory>[0]) {}

  async start(): Promise<void> {
    this.started = true
  }
  async dispose(): Promise<void> {
    this.disposed = true
  }
  async refreshUsage(force?: boolean): Promise<void> {
    this.refreshCalls.push(force)
  }
  setWatched(watched: WatchedSessions | undefined): void {
    this.watchedCalls.push(watched)
  }
  setUsagePollSeconds(seconds: number): void {
    this.pollCalls.push(seconds)
  }
  emit(snapshot: AccountSnapshot): void {
    this.snapshot = snapshot
    this.options.onSnapshot(snapshot)
  }
}

function fakeSnapshot(accountId: string): AccountSnapshot {
  return {
    accountId,
    identity: null,
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
    updatedAt: 1
  }
}

const identity = {
  email: 'second@example.com',
  displayName: null,
  organizationName: null,
  subscriptionType: 'max',
  tokenStatus: 'valid' as const,
  tokenExpiresAt: null
}

const DEFAULTS = { env: {}, homeDir: '/home/test' }

describe('GaugesController', () => {
  let dir: string
  let store: ConfigStore
  let monitors: FakeMonitor[]
  let sent: Array<{ channel: string; payload: unknown }>
  let picked: string | null
  let validate: (dir: string) => Promise<ValidateConfigDirResult>
  let applied: boolean[]

  const createController = (): GaugesController =>
    new GaugesController({
      store,
      send: (channel, payload) => sent.push({ channel, payload }),
      pickDirectory: async () => picked,
      validateConfigDir: (d) => validate(d),
      createMonitor: (options) => {
        const monitor = new FakeMonitor(options)
        monitors.push(monitor)
        return monitor
      },
      onConfigApplied: (config) => applied.push(config.alwaysOnTop)
    })

  const liveMonitor = (accountId: string): FakeMonitor | undefined =>
    monitors.find((m) => m.options.account.id === accountId && !m.disposed)

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gauges-ipc-'))
    store = await ConfigStore.open(dir, DEFAULTS)
    monitors = []
    sent = []
    picked = null
    applied = []
    validate = async (d) => ({ ok: true, configDir: d, identity })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('starts a monitor per account and pushes its snapshots', async () => {
    const controller = createController()
    await controller.start()
    expect(monitors).toHaveLength(1)
    expect(monitors[0]!.started).toBe(true)

    monitors[0]!.emit(fakeSnapshot('default'))
    expect(sent).toEqual([{ channel: IPC_CHANNELS.snapshot, payload: fakeSnapshot('default') }])
    expect(controller.getSnapshots()).toHaveLength(1)
  })

  it('persists config changes and reconfigures monitors', async () => {
    const controller = createController()
    await controller.start()
    const monitor = monitors[0]!

    await controller.setConfig({ usagePollSeconds: 120, watchedSessionIds: { default: ['s1'] }, alwaysOnTop: true })
    expect(monitor.pollCalls).toEqual([120])
    expect(monitor.watchedCalls).toEqual([['s1']])
    expect(applied.at(-1)).toBe(true)
    expect(sent.some((m) => m.channel === IPC_CHANNELS.configChanged)).toBe(true)

    const persisted = await loadConfig(dir, DEFAULTS)
    expect(persisted.usagePollSeconds).toBe(120)
    expect(persisted.alwaysOnTop).toBe(true)
  })

  it('rejects non-object config updates', async () => {
    const controller = createController()
    await controller.start()
    await expect(controller.setConfig('nope')).rejects.toThrow('Invalid config update')
  })

  it('restarts a monitor when its config dir changes', async () => {
    const controller = createController()
    await controller.start()
    const config = controller.getConfig()
    await controller.setConfig({ accounts: [{ ...config.accounts[0]!, configDir: '/other/.claude' }] })
    expect(monitors[0]!.disposed).toBe(true)
    expect(liveMonitor('default')?.options.account.configDir).toBe('/other/.claude')
  })

  it('ignores snapshots from replaced monitors', async () => {
    const controller = createController()
    await controller.start()
    const old = monitors[0]!
    const config = controller.getConfig()
    await controller.setConfig({ accounts: [{ ...config.accounts[0]!, configDir: '/other/.claude' }] })
    sent = []
    old.emit(fakeSnapshot('default'))
    expect(sent).toEqual([])
  })

  it('adds a valid account, activates it, and starts its monitor', async () => {
    const controller = createController()
    await controller.start()
    picked = '/home/test/.claude-work'
    const result = await controller.addAccount()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.accounts).toHaveLength(2)
    expect(result.config.activeAccountId).toBe(result.account.id)
    expect(liveMonitor(result.account.id)?.started).toBe(true)
    const persisted = await loadConfig(dir, DEFAULTS)
    expect(persisted.accounts.map((a) => a.configDir)).toContain('/home/test/.claude-work')
  })

  it('returns a readable error for an invalid config dir', async () => {
    const controller = createController()
    await controller.start()
    picked = '/nowhere'
    validate = async () => ({ ok: false, error: 'No usable .credentials.json found in /nowhere.' })
    const result = await controller.addAccount()
    expect(result).toEqual({ ok: false, error: 'No usable .credentials.json found in /nowhere.' })
    expect(controller.getConfig().accounts).toHaveLength(1)
  })

  it('reports cancellation and duplicate dirs', async () => {
    const controller = createController()
    await controller.start()
    expect(await controller.addAccount()).toMatchObject({ ok: false, cancelled: true })

    picked = controller.getConfig().accounts[0]!.configDir
    const duplicate = await controller.addAccount()
    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok) expect(duplicate.error).toMatch(/already linked/)
  })

  it('removes an account, disposes its monitor, and moves the active tab', async () => {
    const controller = createController()
    await controller.start()
    picked = '/home/test/.claude-work'
    const added = await controller.addAccount()
    if (!added.ok) throw new Error('expected ok')
    const config = await controller.removeAccount(added.account.id)
    expect(config.accounts.map((a) => a.id)).toEqual(['default'])
    expect(config.activeAccountId).toBe('default')
    expect(monitors.find((m) => m.options.account.id === added.account.id)?.disposed).toBe(true)
  })

  it('switches the active account and rejects unknown ids', async () => {
    const controller = createController()
    await controller.start()
    picked = '/home/test/.claude-work'
    await controller.addAccount()
    const config = await controller.setActiveAccount('default')
    expect(config.activeAccountId).toBe('default')
    expect(liveMonitor('default')?.refreshCalls).toEqual([undefined])
    await expect(controller.setActiveAccount('missing')).rejects.toThrow('Unknown account')
  })

  it('refreshes usage on focus and on demand', async () => {
    const controller = createController()
    await controller.start()
    controller.handleFocus()
    await controller.refreshUsage()
    expect(monitors[0]!.refreshCalls).toEqual([undefined, true])
  })

  it('persists window bounds and alwaysOnTop across a reload', async () => {
    const controller = createController()
    await controller.start()
    await controller.setConfig({ alwaysOnTop: true })
    await controller.saveWindowState({ windowBounds: { x: 10, y: 20, width: 400, height: 600 } })
    const reopened = await ConfigStore.open(dir, DEFAULTS)
    expect(reopened.get().windowBounds).toEqual({ x: 10, y: 20, width: 400, height: 600 })
    expect(reopened.get().alwaysOnTop).toBe(true)
  })

  it('persists mini and max window bounds independently without broadcasting', async () => {
    const controller = createController()
    await controller.start()
    sent = []
    await controller.saveWindowState({ windowBounds: { x: 10, y: 20, width: 420, height: 640 } })
    await controller.saveWindowState({ miniWindowBounds: { x: 30, y: 40, width: 416, height: 439 } })
    expect(controller.getConfig().windowBounds).toEqual({ x: 10, y: 20, width: 420, height: 640 })
    expect(controller.getConfig().miniWindowBounds).toEqual({ x: 30, y: 40, width: 416, height: 439 })
    expect(sent.some((m) => m.channel === IPC_CHANNELS.configChanged)).toBe(false)
    const reopened = await ConfigStore.open(dir, DEFAULTS)
    expect(reopened.get().windowBounds).toEqual({ x: 10, y: 20, width: 420, height: 640 })
    expect(reopened.get().miniWindowBounds).toEqual({ x: 30, y: 40, width: 416, height: 439 })
  })

  it('disposes all monitors', async () => {
    const controller = createController()
    await controller.start()
    await controller.dispose()
    expect(monitors.every((m) => m.disposed)).toBe(true)
  })
})

describe('registerIpcHandlers', () => {
  it('registers and removes every invoke channel', () => {
    const handle = vi.fn()
    const removeHandler = vi.fn()
    const controller = { getConfig: vi.fn(() => 'cfg') } as unknown as GaugesController
    const unregister = registerIpcHandlers({ handle, removeHandler }, controller)
    const channels = handle.mock.calls.map(([channel]) => channel as string)
    expect(channels).toEqual(
      expect.arrayContaining([
        IPC_CHANNELS.getConfig,
        IPC_CHANNELS.setConfig,
        IPC_CHANNELS.getSnapshots,
        IPC_CHANNELS.addAccount,
        IPC_CHANNELS.removeAccount,
        IPC_CHANNELS.setActiveAccount,
        IPC_CHANNELS.refreshUsage
      ])
    )
    const getConfig = handle.mock.calls.find(([c]) => c === IPC_CHANNELS.getConfig)![1] as (e: unknown) => unknown
    expect(getConfig({})).toBe('cfg')
    unregister()
    expect(removeHandler).toHaveBeenCalledTimes(channels.length)
  })
})
