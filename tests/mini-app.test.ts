import { createElement, isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AccountSnapshot, AppConfig, SessionInfo } from '../src/shared/types'
import App from '../src/renderer/App'
import { createEmptyConfig, createFallbackApi } from '../src/renderer/api'
import type { SettingsPanelProps } from '../src/renderer/components/SettingsPanel'
import { MINI_SCREEN_IDS, MiniApp, miniScreens, screensForMode } from '../src/renderer/mini/MiniApp'
import { createGaugesStore, type GaugesStore } from '../src/renderer/store'

function makeConfig(patch: Partial<AppConfig> = {}): AppConfig {
  return {
    ...createEmptyConfig(),
    accounts: [{ id: 'a', label: '', configDir: '/home/me/.claude' }],
    activeAccountId: 'a',
    windowMode: 'mini',
    ...patch
  }
}

const BUSY_SESSION: SessionInfo = {
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
  lastActivityAt: null
}

function makeSnapshot(): AccountSnapshot {
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
    sessions: [BUSY_SESSION],
    availableSessions: [BUSY_SESSION],
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

async function readyStore(
  config: AppConfig,
  snapshots: AccountSnapshot[] = [makeSnapshot()]
): Promise<GaugesStore> {
  const store = createGaugesStore(createFallbackApi(config, snapshots))
  await store.init()
  return store
}

function renderScreen(node: React.ReactNode): string {
  return renderToStaticMarkup(createElement('div', null, node))
}

const noop = (): void => {}

describe('miniScreens', () => {
  it('orders screens Gauges → Sessions → Settings → Playground', () => {
    const screens = miniScreens({ config: makeConfig(), snapshot: makeSnapshot(), onConfigChange: noop })
    expect(screens.map((s) => s.id)).toEqual([...MINI_SCREEN_IDS])
    expect(screens.map((s) => s.label)).toEqual(['Gauges', 'Sessions', 'Settings', 'Playground'])
    expect(screens.filter((s) => s.miniOnly).map((s) => s.id)).toEqual(['playground'])
  })

  it('drops the playground outside mini mode', () => {
    const screens = miniScreens({ config: makeConfig(), snapshot: makeSnapshot(), onConfigChange: noop })
    expect(screensForMode(screens, 'mini').map((s) => s.id)).toContain('playground')
    expect(screensForMode(screens, 'max').map((s) => s.id)).not.toContain('playground')
  })

  it('renders compact content for each screen', () => {
    const screens = miniScreens({ config: makeConfig(), snapshot: makeSnapshot(), onConfigChange: noop })
    const [gauges, sessions, settings, playground] = screens.map((s) => renderScreen(s.render()))
    expect(gauges).toContain('usage-panel--compact')
    expect(sessions).toContain('session-list--compact')
    expect(sessions).toContain('gauges')
    expect(settings).toContain('settings-panel--compact')
    expect(settings).not.toContain('Done')
    expect(playground).toContain('playground-canvas')
  })

  it('shows loading states while the snapshot is missing', () => {
    const screens = miniScreens({ config: makeConfig(), snapshot: null, onConfigChange: noop })
    expect(renderScreen(screens[0].render())).toContain('Loading account data')
    expect(renderScreen(screens[1].render())).toContain('Loading account data')
  })

  it('explains a hidden session list', () => {
    const config = makeConfig()
    const screens = miniScreens({
      config: { ...config, widgets: { ...config.widgets, sessions: false } },
      snapshot: makeSnapshot(),
      onConfigChange: noop
    })
    expect(renderScreen(screens[1].render())).toContain('turned off in Settings')
  })

  it('switches back to max from the settings screen via store.setConfig', async () => {
    const store = await readyStore(makeConfig())
    const config = store.getState().config
    if (!config) throw new Error('config not loaded')
    const screens = miniScreens({
      config,
      snapshot: makeSnapshot(),
      onConfigChange: (patch) => void store.setConfig(patch)
    })
    const settings = screens[2].render()
    expect(isValidElement(settings)).toBe(true)
    const props = (settings as ReactElement<SettingsPanelProps>).props
    expect(props.compact).toBe(true)
    expect(props.onClose).toBeUndefined()
    props.onChange({ windowMode: 'max' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.getState().config?.windowMode).toBe('max')
    expect(renderToStaticMarkup(createElement(App, { store }))).toContain('app-header')
  })
})

describe('MiniApp', () => {
  it('renders the drag strip, account label and carousel with four screens in order', async () => {
    const store = await readyStore(makeConfig())
    const html = renderToStaticMarkup(createElement(MiniApp, { store }))
    expect(html).toContain('mini-drag-strip')
    expect(html).toContain('mini-account-label')
    expect(html).toContain('me@example.com')
    expect(html).toContain('aria-roledescription="carousel"')
    const order = ['Gauges', 'Sessions', 'Settings', 'Playground'].map((label) =>
      html.indexOf(`aria-label="Show ${label}"`)
    )
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).toContain('Gauges (1 of 4)')
  })

  it('shows a loading message before init', () => {
    const store = createGaugesStore(createFallbackApi(makeConfig()))
    const html = renderToStaticMarkup(createElement(MiniApp, { store }))
    expect(html).toContain('Loading…')
    expect(html).not.toContain('carousel')
  })

  it('shows a no-account message with a way back to max', async () => {
    const store = await readyStore(makeConfig({ accounts: [], activeAccountId: null }), [])
    const html = renderToStaticMarkup(createElement(MiniApp, { store }))
    expect(html).toContain('No accounts linked yet')
    expect(html).toContain('aria-label="Window size"')
    expect(html).not.toContain('aria-roledescription="carousel"')
  })

  it('shows an error message with a way back to max', async () => {
    const api = createFallbackApi(makeConfig())
    api.getConfig = async () => {
      throw new Error('boom')
    }
    const store = createGaugesStore(api)
    await store.init()
    const html = renderToStaticMarkup(createElement(MiniApp, { store }))
    expect(html).toContain('Could not load data: boom')
    expect(html).toContain('state-message--error')
  })
})

describe('App window-mode branch', () => {
  it('renders MiniApp in mini mode', async () => {
    const store = await readyStore(makeConfig({ windowMode: 'mini' }))
    const html = renderToStaticMarkup(createElement(App, { store }))
    expect(html).toContain('app mini')
    expect(html).toContain('aria-roledescription="carousel"')
    expect(html).not.toContain('app-header')
  })

  it('keeps the max layout without a playground in max mode', async () => {
    const store = await readyStore(makeConfig({ windowMode: 'max' }))
    const html = renderToStaticMarkup(createElement(App, { store }))
    expect(html).toContain('app-header')
    expect(html).not.toContain('carousel')
    expect(html).not.toContain('Playground')
    expect(html).not.toContain('playground-canvas')
  })
})
