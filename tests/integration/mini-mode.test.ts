import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore, loadConfig } from '../../src/main/config-store'
import { GaugesController, type MonitorFactory, type MonitorLike } from '../../src/main/ipc'
import { boundsKeyForMode, MINI_DEFAULT_SIZE, windowGeometryForMode } from '../../src/main/window-mode'
import { createEmptyConfig, createFallbackApi } from '../../src/renderer/api'
import { carouselSlots } from '../../src/renderer/mini/Carousel'
import { nextIndex } from '../../src/renderer/mini/carousel-logic'
import { MINI_SCREEN_IDS, MiniApp, miniScreens, screensForMode } from '../../src/renderer/mini/MiniApp'
import { Playground } from '../../src/renderer/mini/Playground'
import { folderSpawnIntervalMs } from '../../src/renderer/mini/spawn-rate'
import { createGaugesStore } from '../../src/renderer/store'
import {
  IPC_CHANNELS,
  type AccountSnapshot,
  type AppConfig,
  type SessionInfo,
  type WatchedSessions
} from '../../src/shared/types'

/**
 * Cross-task integration for mini mode: config (task 1) ↔ controller (task 12) ↔ window geometry
 * (task 8), and MiniApp (task 13) ↔ compact panels (6, 7, 9) ↔ carousel (2, 10) ↔ spawn rate (3, 11).
 */

class NullMonitor implements MonitorLike {
  snapshot: AccountSnapshot | null = null
  async start(): Promise<void> {}
  async dispose(): Promise<void> {}
  async refreshUsage(): Promise<void> {}
  setWatched(_watched: WatchedSessions | undefined): void {}
  setUsagePollSeconds(_seconds: number): void {}
}

const nullMonitorFactory: MonitorFactory = () => new NullMonitor()
const DEFAULTS = { env: {}, homeDir: '/home/test' }

describe('mini mode config round-trip through GaugesController', () => {
  let dir: string
  let store: ConfigStore
  let sent: Array<{ channel: string; payload: unknown }>
  let applied: AppConfig[]

  const createController = (): GaugesController =>
    new GaugesController({
      store,
      send: (channel, payload) => sent.push({ channel, payload }),
      pickDirectory: async () => null,
      createMonitor: nullMonitorFactory,
      onConfigApplied: (config) => applied.push(config)
    })

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gauges-mini-int-'))
    store = await ConfigStore.open(dir, DEFAULTS)
    sent = []
    applied = []
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('persists windowMode, broadcasts configChanged, and hands mini geometry to the window hook', async () => {
    const controller = createController()
    await controller.start()
    expect(controller.getConfig().windowMode).toBe('max')

    const result = await controller.setConfig({ windowMode: 'mini' })
    expect(result.windowMode).toBe('mini')

    const broadcasts = sent.filter((m) => m.channel === IPC_CHANNELS.configChanged)
    expect(broadcasts).toHaveLength(1)
    expect((broadcasts[0]!.payload as AppConfig).windowMode).toBe('mini')

    const persisted = await loadConfig(dir, DEFAULTS)
    expect(persisted.windowMode).toBe('mini')

    // The config handed to onConfigApplied (index.ts applyWindowConfig) yields the mini geometry.
    const geometry = windowGeometryForMode(applied.at(-1)!.windowMode, applied.at(-1)!)
    expect(geometry.aspectRatio).toBe(1)
    expect(geometry.bounds).toBeNull()
    expect(geometry.defaultContentSize).toEqual({ width: MINI_DEFAULT_SIZE, height: MINI_DEFAULT_SIZE })
  })

  it('rejects an invalid windowMode from the renderer, falling back to the default', async () => {
    const controller = createController()
    await controller.start()
    const result = await controller.setConfig({ windowMode: 'huge' })
    expect(result.windowMode).toBe('max')
    expect((await loadConfig(dir, DEFAULTS)).windowMode).toBe('max')
  })

  it('stores mini and max bounds independently and restores each per mode', async () => {
    const controller = createController()
    await controller.start()
    const maxBounds = { x: 10, y: 20, width: 500, height: 700 }
    const miniBounds = { x: 30, y: 40, width: 320, height: 320 }

    // Simulates index.ts saveBounds, which writes to boundsKeyForMode(current mode).
    await controller.saveWindowState({ [boundsKeyForMode('max')]: maxBounds })
    await controller.setConfig({ windowMode: 'mini' })
    await controller.saveWindowState({ [boundsKeyForMode('mini')]: miniBounds })
    const sentBeforeToggle = sent.length

    const back = await controller.setConfig({ windowMode: 'max' })
    expect(sent.length).toBe(sentBeforeToggle + 1)
    expect(back.windowBounds).toEqual(maxBounds)
    expect(back.miniWindowBounds).toEqual(miniBounds)

    const persisted = await loadConfig(dir, DEFAULTS)
    expect(persisted.windowBounds).toEqual(maxBounds)
    expect(persisted.miniWindowBounds).toEqual(miniBounds)

    expect(windowGeometryForMode('max', persisted)).toMatchObject({ aspectRatio: 0, bounds: maxBounds })
    expect(windowGeometryForMode('mini', persisted)).toMatchObject({ aspectRatio: 1, bounds: miniBounds })
  })
})

// ---------------------------------------------------------------------------
// Renderer: MiniApp with fallback API data
// ---------------------------------------------------------------------------

function session(patch: Partial<SessionInfo>): SessionInfo {
  return {
    pid: 1,
    sessionId: 's1',
    cwd: '/repo/gauges',
    repoName: 'gauges',
    title: 'Work',
    status: 'busy',
    waitingFor: null,
    entrypoint: null,
    version: null,
    startedAt: null,
    updatedAt: null,
    model: 'claude-opus-4-1',
    effort: 'high',
    effortIsDefault: false,
    gitBranch: 'main',
    lastActivityAt: null,
    ...patch
  }
}

const SESSIONS: SessionInfo[] = [
  session({ pid: 1, sessionId: 's1', repoName: 'alpha-repo', status: 'busy', effort: 'high' }),
  session({ pid: 2, sessionId: 's2', repoName: 'beta-repo', status: 'busy', effort: 'max' }),
  session({ pid: 3, sessionId: 's3', repoName: 'gamma-repo', status: 'idle', effort: 'max' })
]

function makeSnapshot(sessions: SessionInfo[] = SESSIONS): AccountSnapshot {
  const now = Date.now()
  return {
    accountId: 'a',
    identity: {
      email: 'me@example.com',
      displayName: null,
      organizationName: null,
      subscriptionType: 'max',
      tokenStatus: 'valid',
      tokenExpiresAt: null
    },
    sessions,
    availableSessions: sessions,
    usage: {
      status: 'ok',
      fiveHour: { percent: 42, resetsAt: now + 3_600_000 },
      weekly: { percent: 17, resetsAt: now + 86_400_000 },
      weeklyOpus: null,
      weeklySonnet: null,
      lastSuccessAt: now,
      lastAttemptAt: now,
      nextPollAt: now + 90_000,
      message: null
    },
    updatedAt: now
  }
}

function makeConfig(patch: Partial<AppConfig> = {}): AppConfig {
  return {
    ...createEmptyConfig(),
    accounts: [{ id: 'a', label: 'Work', configDir: '/home/me/.claude' }],
    activeAccountId: 'a',
    windowMode: 'mini',
    ...patch
  }
}

const render = (node: React.ReactNode): string => renderToStaticMarkup(createElement('div', null, node))

describe('MiniApp with fallback API data', () => {
  it('renders the carousel in mini mode starting on the Gauges screen', async () => {
    const store = createGaugesStore(createFallbackApi(makeConfig(), [makeSnapshot()]))
    await store.init()
    const html = renderToStaticMarkup(createElement(MiniApp, { store }))
    expect(html).toContain('aria-roledescription="carousel"')
    expect(html).toContain('Session (5h)')
    expect(html).toContain('Weekly')
    // Only the current screen is mounted: no duplicate playground simulation off-screen.
    expect(html).not.toContain('playground-canvas')
  })

  it("renders all four screens' content in order from fixture data", () => {
    const config = makeConfig()
    const screens = screensForMode(
      miniScreens({ config, snapshot: makeSnapshot(), onConfigChange: () => undefined }),
      'mini'
    )
    expect(screens.map((s) => s.id)).toEqual([...MINI_SCREEN_IDS])

    const [gauges, sessions, settings, playground] = screens.map((s) => render(s.render()))
    expect(gauges).toContain('Session (5h)')
    expect(gauges).toContain('42')
    expect(sessions).toContain('alpha-repo')
    expect(sessions).toContain('beta-repo')
    expect(settings).toContain('min')
    expect(settings).toContain('max')
    expect(settings).toMatch(/aria-pressed="true"/)
    expect(playground).toContain('playground-canvas')
    expect(playground).not.toContain('no busy sessions')

    // Max mode never exposes the playground.
    expect(screensForMode(screens, 'max').map((s) => s.id)).not.toContain('playground')
  })

  it('wraps from Playground forward to Gauges', () => {
    const screens = screensForMode(
      miniScreens({ config: makeConfig(), snapshot: makeSnapshot(), onConfigChange: () => undefined }),
      'mini'
    )
    const last = screens.length - 1
    expect(screens[last]!.id).toBe('playground')
    expect(screens[nextIndex(last, 1, screens.length)]!.id).toBe('gauges')
    expect(screens[nextIndex(0, -1, screens.length)]!.id).toBe('playground')

    const slots = carouselSlots(last, screens)
    expect(slots.find((s) => s.role === 'current')!.screen.id).toBe('playground')
    expect(slots.find((s) => s.role === 'next')!.screen.id).toBe('gauges')
    expect(slots.find((s) => s.role === 'prev')!.screen.id).toBe('settings')
  })

  it('switching to max from the mini settings flows through the store and fallback API', async () => {
    const api = createFallbackApi(makeConfig(), [makeSnapshot()])
    const store = createGaugesStore(api)
    await store.init()
    await store.setConfig({ windowMode: 'max' })
    expect((await api.getConfig()).windowMode).toBe('max')
    expect(store.getState().config?.windowMode).toBe('max')
  })
})

describe('spawn-rate wiring to session data', () => {
  it('derives the playground spawn interval from busy sessions of the active snapshot', () => {
    // busy high (3) + busy max (4); the idle max session is ignored.
    expect(folderSpawnIntervalMs(SESSIONS)).toBe(Math.round(12_000 / 7))

    const idleOnly = SESSIONS.map((s) => ({ ...s, status: 'idle' as const }))
    expect(folderSpawnIntervalMs(idleOnly)).toBeNull()
    expect(render(createElement(Playground, { sessions: idleOnly }))).toContain('no busy sessions')

    const idleScreens = miniScreens({
      config: makeConfig(),
      snapshot: makeSnapshot(idleOnly),
      onConfigChange: () => undefined
    })
    expect(render(idleScreens[3]!.render())).toContain('no busy sessions')
  })
})
