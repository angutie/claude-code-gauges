import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../src/shared/types'
import App, { AppHeader, toggleHeaderPanel, type HeaderPanel } from '../src/renderer/App'
import { createEmptyConfig, createFallbackApi } from '../src/renderer/api'
import { initialGaugesState, type GaugesState, type GaugesStore } from '../src/renderer/store'

/** A store frozen in one state; init/dispose are no-ops so each status can be rendered directly. */
function stubStore(patch: Partial<GaugesState>): GaugesStore {
  const config = patch.config ?? createEmptyConfig()
  const state: GaugesState = { ...initialGaugesState, ...patch }
  return {
    getState: () => state,
    subscribe: () => () => undefined,
    init: async () => undefined,
    dispose: () => undefined,
    setActiveAccount: async () => undefined,
    setConfig: async () => undefined,
    api: createFallbackApi(config, [])
  }
}

function readyConfig(patch: Partial<AppConfig> = {}): AppConfig {
  return {
    ...createEmptyConfig(),
    accounts: [{ id: 'a', label: '', configDir: '/home/me/.claude' }],
    activeAccountId: 'a',
    windowMode: 'max',
    ...patch
  }
}

const STATES: Array<[string, Partial<GaugesState>]> = [
  ['loading', { status: 'loading' }],
  ['error', { status: 'error', error: 'boom' }],
  ['no accounts', { status: 'ready', config: { ...createEmptyConfig(), windowMode: 'max' } }],
  ['ready', { status: 'ready', config: readyConfig() }]
]

function helpButton(markup: string): string | undefined {
  return markup.match(/<button[^>]*>Help<\/button>/)?.[0]
}

function findButton(node: ReactNode, label: string): ReactElement<{ onClick: () => void }> {
  const found: ReactElement[] = []
  const walk = (n: ReactNode): void => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (!isValidElement(n)) return
    const props = n.props as { children?: ReactNode }
    if (n.type === 'button' && props.children === label) found.push(n)
    walk(props.children)
  }
  walk(node)
  expect(found).toHaveLength(1)
  return found[0] as ReactElement<{ onClick: () => void }>
}

describe('App header Help button', () => {
  it.each(STATES)('renders a collapsed Help button in the %s state', (_name, state) => {
    const markup = renderToStaticMarkup(createElement(App, { store: stubStore(state) }))
    const button = helpButton(markup)
    expect(button).toBeDefined()
    expect(button).toContain('aria-expanded="false"')
    expect(button).toContain('class="button"')
    expect(markup).not.toContain('aria-label="Help"')
  })

  it('shows Settings only once the app is ready with a config', () => {
    for (const [name, state] of STATES) {
      const markup = renderToStaticMarkup(createElement(App, { store: stubStore(state) }))
      expect(markup.includes('>Settings</button>'), name).toBe(name === 'ready' || name === 'no accounts')
    }
  })

  it('reflects the open panel in aria-expanded', () => {
    const render = (openPanel: HeaderPanel): string =>
      renderToStaticMarkup(createElement(AppHeader, { openPanel, showSettings: true, onToggle: () => undefined }))

    const help = render('help')
    expect(helpButton(help)).toContain('aria-expanded="true"')
    expect(help).toMatch(/aria-expanded="false"[^>]*>Settings</)

    const settings = render('settings')
    expect(helpButton(settings)).toContain('aria-expanded="false"')
    expect(settings).toMatch(/aria-expanded="true"[^>]*>Settings</)
  })

  it('wires the header buttons to onToggle', () => {
    const onToggle = vi.fn()
    const tree = AppHeader({ openPanel: null, showSettings: true, onToggle })
    findButton(tree, 'Help').props.onClick()
    findButton(tree, 'Settings').props.onClick()
    expect(onToggle.mock.calls).toEqual([['help'], ['settings']])
  })
})

describe('toggleHeaderPanel', () => {
  it('opens and closes a panel', () => {
    expect(toggleHeaderPanel(null, 'help')).toBe('help')
    expect(toggleHeaderPanel('help', 'help')).toBeNull()
    expect(toggleHeaderPanel(null, 'settings')).toBe('settings')
    expect(toggleHeaderPanel('settings', 'settings')).toBeNull()
  })

  it('keeps Help and Settings mutually exclusive', () => {
    expect(toggleHeaderPanel('settings', 'help')).toBe('help')
    expect(toggleHeaderPanel('help', 'settings')).toBe('settings')
  })
})
