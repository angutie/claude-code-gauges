import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import App from '../../src/renderer/App'
import { createEmptyConfig, createFallbackApi } from '../../src/renderer/api'
import { HelpPanel, CompactHelpView } from '../../src/renderer/components/HelpPanel'
import {
  MAX_POLL_SECONDS,
  MIN_POLL_SECONDS,
  WIDGET_OPTIONS,
  WINDOW_MODE_OPTIONS
} from '../../src/renderer/components/SettingsPanel'
import {
  FEATURE_RELATED_SETTINGS,
  HELP_TOPICS,
  MINI_SCREEN_DESCRIPTIONS,
  MODES_TOPIC,
  SETTINGS_ENTRY_IDS,
  paragraphText,
  settingsEntryLabel,
  topicText
} from '../../src/renderer/help-content'
import { HELP_INDEX_STATE, helpCards, openTopic, stepCard, type HelpPagingState } from '../../src/renderer/help-paging'
import {
  MINI_SCREEN_IDS,
  MiniDragStrip,
  miniMainContent,
  miniScreens,
  screensForMode
} from '../../src/renderer/mini/MiniApp'
import { initialGaugesState, type GaugesState, type GaugesStore } from '../../src/renderer/store'
import { WIDGET_KEYS, type AppConfig, type WindowMode } from '../../src/shared/types'

/**
 * Cross-task integration for the Help feature:
 * help-content (tasks 1, 2, 4, 7) ↔ HelpPanel + paging (3, 5) ↔ App header (9) ↔
 * mini carousel screen (8) ↔ mini "?" button (10) ↔ CSS (6) ↔ README (11).
 */

const ROOT = resolve(__dirname, '../..')

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

function config(windowMode: WindowMode, withAccount: boolean): AppConfig {
  return {
    ...createEmptyConfig(),
    windowMode,
    accounts: withAccount ? [{ id: 'a', label: '', configDir: '/home/me/.claude' }] : [],
    activeAccountId: withAccount ? 'a' : null
  }
}

/** Every UI state, per window mode. Mini is reached through App, exactly as at runtime. */
function statesFor(mode: WindowMode): Array<[string, Partial<GaugesState>]> {
  return [
    ['loading', { status: 'loading', config: config(mode, true) }],
    ['error', { status: 'error', error: 'boom', config: config(mode, true) }],
    ['no accounts', { status: 'ready', config: config(mode, false) }],
    ['ready', { status: 'ready', config: config(mode, true) }]
  ]
}

const decode = (html: string): string =>
  html
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

/** Visible text of markup, tags removed and entities decoded. */
const textOf = (html: string): string => decode(html.replace(/<[^>]+>/g, ''))

function findButtons(node: ReactNode, match: (props: Record<string, unknown>) => boolean): ReactElement[] {
  const found: ReactElement[] = []
  const walk = (n: ReactNode): void => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (!isValidElement(n)) return
    const props = n.props as Record<string, unknown> & { children?: ReactNode }
    if (n.type === 'button' && match(props)) found.push(n)
    walk(props.children)
  }
  walk(node)
  return found
}

/** Renders every card of every topic through the real compact view by stepping with the real pager. */
function walkCompactHelp(): Map<string, string[]> {
  const byTopic = new Map<string, string[]>()
  for (const topic of HELP_TOPICS) {
    const pages: string[] = []
    let state: HelpPagingState = openTopic(topic.id)
    for (let guard = 0; guard < 200; guard++) {
      pages.push(
        renderToStaticMarkup(createElement(CompactHelpView, { state, topics: HELP_TOPICS, onNavigate: () => undefined }))
      )
      const next = stepCard(state, 1, HELP_TOPICS)
      if (next === state) break
      state = next
    }
    byTopic.set(topic.id, pages)
  }
  return byTopic
}

describe('Help is reachable in max mode (App header → HelpPanel)', () => {
  it.each(statesFor('max'))('max %s: header shows a collapsed Help button and no mini shell', (_name, state) => {
    const markup = renderToStaticMarkup(createElement(App, { store: stubStore(state) }))
    expect(markup).not.toContain('class="app mini"')
    const button = markup.match(/<button[^>]*>Help<\/button>/)?.[0]
    expect(button).toBeDefined()
    expect(button).toContain('aria-expanded="false"')
    // Closed by default: the panel itself is not rendered.
    expect(markup).not.toContain('help-panel')
  })

  it('max HelpPanel (as App renders it) shows every topic and a Done button wired to onClose', () => {
    const onClose = vi.fn()
    const element = HelpPanel({ onClose })
    const markup = renderToStaticMarkup(element)
    expect(markup).toContain('aria-label="Help"')
    expect(markup).not.toContain('help-panel--compact')
    for (const topic of HELP_TOPICS) expect(textOf(markup)).toContain(topic.title)

    const done = findButtons(element, (p) => p.children === 'Done')
    expect(done).toHaveLength(1)
    ;(done[0].props as { onClick: () => void }).onClick()
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('Help is reachable in mini mode (App → MiniApp → "?" button / Help screen)', () => {
  it.each(statesFor('mini'))('mini %s: App renders the mini shell with a collapsed "?" Help button', (_name, state) => {
    const markup = renderToStaticMarkup(createElement(App, { store: stubStore(state) }))
    expect(markup).toContain('class="app mini"')
    const strip = markup.match(/<div class="mini-drag-strip">[\s\S]*?<\/div>/)?.[0] ?? ''
    const button = strip.match(/<button[^>]*aria-label="Help"[^>]*>\?<\/button>/)?.[0]
    expect(button, 'the "?" button must live inside the drag strip').toBeDefined()
    expect(button).toContain('aria-expanded="false"')
    // The max header (and its text Help button) never appears in mini.
    expect(markup).not.toContain('app-header')
  })

  it.each([
    ['error', 'Could not load data: boom'],
    ['no accounts', 'No accounts linked yet.']
  ])('mini %s: opening Help swaps the state message for the compact panel; Done restores it', (_name, message) => {
    const stateMessage = createElement('div', { className: 'state-message' }, message)
    const onCloseHelp = vi.fn()

    const strip = MiniDragStrip({ accountLabel: null, helpOpen: false, onToggleHelp: vi.fn() })
    const [toggle] = findButtons(strip, (p) => p['aria-label'] === 'Help')
    expect(toggle).toBeDefined()

    const closed = renderToStaticMarkup(createElement('main', null, miniMainContent(false, onCloseHelp, stateMessage)))
    expect(closed).toContain(message)
    expect(closed).not.toContain('help-panel')

    const openNode = miniMainContent(true, onCloseHelp, stateMessage)
    const open = renderToStaticMarkup(createElement('main', null, openNode))
    expect(open).not.toContain(message)
    expect(open).toContain('help-panel help-panel--compact')
    expect(open).toContain('aria-label="Help topics"')
    for (const topic of HELP_TOPICS) expect(textOf(open)).toContain(topic.title)

    // The panel from miniMainContent has a Done button bound to the close callback.
    const panel = (openNode as ReactElement<{ onClose?: () => void; compact?: boolean }>).props
    expect(panel.compact).toBe(true)
    panel.onClose?.()
    expect(onCloseHelp).toHaveBeenCalledOnce()

    const opened = renderToStaticMarkup(MiniDragStrip({ accountLabel: null, helpOpen: true, onToggleHelp: vi.fn() }))
    expect(opened).toContain('aria-expanded="true"')
  })

  it('mini carousel Help screen renders the compact topic index (no Done, since the carousel cannot close it)', () => {
    const screens = screensForMode(
      miniScreens({ config: config('mini', true), snapshot: null, onConfigChange: () => undefined }),
      'mini'
    )
    expect(screens.map((s) => s.id)).toEqual([...MINI_SCREEN_IDS])
    const help = screens.find((s) => s.id === 'help')
    expect(help?.miniOnly).toBeFalsy()
    const markup = renderToStaticMarkup(createElement('div', null, help!.render()))
    expect(markup).toContain('help-panel--compact')
    expect(markup).not.toContain('>Done</button>')
    const indexButtons = markup.match(/class="button help-index-item"/g) ?? []
    expect(indexButtons).toHaveLength(HELP_TOPICS.length)
  })

  it('compact Help uses buttons only — no key handlers that could steal the carousel ←/→ keys', () => {
    const element = HelpPanel({ compact: true })
    const index = renderToStaticMarkup(element)
    const card = renderToStaticMarkup(
      createElement(CompactHelpView, { state: openTopic(HELP_TOPICS[0].id), topics: HELP_TOPICS, onNavigate: () => undefined })
    )
    for (const markup of [index, card]) {
      expect(markup).not.toMatch(/tabindex/i)
      expect(markup).not.toMatch(/overflow/i)
    }
    const walk = (n: ReactNode): void => {
      if (Array.isArray(n)) return n.forEach(walk)
      if (!isValidElement(n)) return
      const props = n.props as Record<string, unknown> & { children?: ReactNode }
      expect(props.onKeyDown).toBeUndefined()
      expect(props.onKeyUp).toBeUndefined()
      walk(props.children)
    }
    walk(element)
    walk(CompactHelpView({ state: openTopic(HELP_TOPICS[0].id), topics: HELP_TOPICS, onNavigate: () => undefined }))
  })
})

describe('Help content is complete against source constants and identical in both modes', () => {
  it('every widget toggle, poll limit and window mode is documented with the UI label', () => {
    expect([...SETTINGS_ENTRY_IDS]).toEqual(
      expect.arrayContaining([...WIDGET_KEYS, 'usagePollSeconds', 'alwaysOnTop', 'windowMode'])
    )
    for (const { key, label } of WIDGET_OPTIONS) expect(settingsEntryLabel(key)).toBe(label)

    const all = HELP_TOPICS.map(topicText).join('\n')
    expect(all).toContain(String(MIN_POLL_SECONDS))
    expect(all).toContain(String(MAX_POLL_SECONDS))
    expect(all).toContain(String(createEmptyConfig().usagePollSeconds))
    for (const { label, glyph } of WINDOW_MODE_OPTIONS) {
      expect(all).toContain(label)
      expect(all).toContain(glyph)
    }
  })

  it('every mini screen is documented under the label the carousel actually uses, in carousel order', () => {
    const screens = miniScreens({ config: config('mini', true), snapshot: null, onConfigChange: () => undefined })
    const modes = topicText(MODES_TOPIC)
    for (const screen of screens) {
      expect(MINI_SCREEN_DESCRIPTIONS[screen.id as keyof typeof MINI_SCREEN_DESCRIPTIONS].label).toBe(screen.label)
      expect(modes).toContain(screen.label)
    }
    expect(modes).toContain(screens.map((s) => s.label).join(' → '))
  })

  it('feature related-settings resolve to real settings entries', () => {
    for (const ids of Object.values(FEATURE_RELATED_SETTINGS)) {
      for (const id of ids) expect(settingsEntryLabel(id), id).toBeDefined()
    }
  })

  it('max and mini show the same content: all text in the max panel is reachable by paging the compact view', () => {
    const max = textOf(renderToStaticMarkup(createElement(HelpPanel, {})))
    const compact = walkCompactHelp()

    for (const topic of HELP_TOPICS) {
      const pages = compact.get(topic.id) ?? []
      expect(pages).toHaveLength(helpCards(topic).length)
      const mini = pages.map(textOf).join('\n')
      for (const section of topic.sections) {
        for (const paragraph of section.paragraphs) {
          const text = paragraphText(paragraph)
          expect(max).toContain(text)
          expect(mini).toContain(text)
        }
        for (const entry of section.entries ?? []) {
          expect(max).toContain(entry.term)
          expect(mini).toContain(entry.term)
          for (const paragraph of entry.body) {
            const text = paragraphText(paragraph)
            expect(max).toContain(text)
            expect(mini).toContain(text)
          }
        }
      }
    }
    // Back always returns to the index the "?" button and Help screen start on.
    expect(stepCard(HELP_INDEX_STATE, 1, HELP_TOPICS)).toBe(HELP_INDEX_STATE)
  })

  it('README documents the same mini carousel order and help topics', () => {
    const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8')
    const labels = MINI_SCREEN_IDS.map((id) => MINI_SCREEN_DESCRIPTIONS[id].label)
    expect(readme).toContain(`**${labels.join(' → ')}**`)
    const tableRows = [...readme.matchAll(/^\| (\w+)\s+\|/gm)].map((m) => m[1]).filter((l) => labels.includes(l))
    expect(tableRows).toEqual(labels)
    for (const topic of HELP_TOPICS) {
      // Topic titles may carry glyph suffixes (e.g. "Mini vs max (min / max)"); match the leading words.
      expect(readme).toContain(`**${topic.title.replace(/\s*\(.*\)$/, '')}**`)
    }
  })
})

describe('Help styles live above the mini banner; mini CSS untouched', () => {
  const css = readFileSync(resolve(ROOT, 'src/renderer/styles.css'), 'utf8')
  const banner = css.indexOf('Mini window (1:1)')
  const above = css.slice(0, banner)
  const mini = css.slice(banner)

  it('help classes rendered in both modes are styled above the banner and never in the mini section', () => {
    expect(banner).toBeGreaterThan(0)
    const markup = [
      renderToStaticMarkup(createElement(HelpPanel, { onClose: () => undefined })),
      renderToStaticMarkup(createElement(HelpPanel, { compact: true })),
      ...[...walkCompactHelp().values()].flat()
    ].join('\n')
    const rendered = new Set(
      [...markup.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c.startsWith('help-'))
    )
    for (const required of ['help-panel', 'help-panel--compact', 'help-topic', 'help-entry', 'help-index', 'help-pager']) {
      expect(rendered, required).toContain(required)
      expect(above, required).toMatch(new RegExp(`\\.${required}(?![\\w-])`))
    }
    // No dead help CSS: every .help-* class in the stylesheet is emitted by the component.
    const styled = new Set([...above.matchAll(/\.(help-[\w-]+)/g)].map((m) => m[1]))
    for (const cls of styled) expect(rendered, cls).toContain(cls)
    expect(mini).not.toMatch(/\.help-/)
  })

  it('mini section of styles.css is byte-for-byte identical to the base branch', () => {
    let baseCss: string
    try {
      const base = execFileSync('git', ['merge-base', 'HEAD', 'main'], { cwd: ROOT, encoding: 'utf8' }).trim()
      baseCss = execFileSync('git', ['show', `${base}:src/renderer/styles.css`], { cwd: ROOT, encoding: 'utf8' })
    } catch {
      return // no git history / no main branch available (e.g. packaged source)
    }
    const norm = (s: string): string => s.replace(/\r\n/g, '\n')
    const baseMini = norm(baseCss.slice(baseCss.indexOf('Mini window (1:1)')))
    expect(norm(mini)).toBe(baseMini)
  })
})
