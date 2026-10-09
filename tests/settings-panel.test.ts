import { createElement, isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WIDGET_KEYS, type WidgetToggles, type WindowMode } from '../src/shared/types'
import {
  clampPollSeconds,
  SettingsPanel,
  WIDGET_OPTIONS,
  WindowModeToggle
} from '../src/renderer/components/SettingsPanel'

describe('clampPollSeconds', () => {
  it('clamps to 60–600 and rounds', () => {
    expect(clampPollSeconds(10)).toBe(60)
    expect(clampPollSeconds('9999')).toBe(600)
    expect(clampPollSeconds('120.4')).toBe(120)
  })

  it('rejects non-numeric input', () => {
    expect(clampPollSeconds('')).toBeNull()
    expect(clampPollSeconds('abc')).toBeNull()
  })
})

describe('SettingsPanel', () => {
  it('offers a toggle for every widget key', () => {
    expect(WIDGET_OPTIONS.map((o) => o.key).sort()).toEqual([...WIDGET_KEYS].sort())
  })

  it('renders widget toggles, poll interval, and always-on-top', () => {
    const widgets = Object.fromEntries(WIDGET_KEYS.map((k) => [k, k !== 'branch'])) as WidgetToggles
    const html = renderToStaticMarkup(
      createElement(SettingsPanel, {
        config: { widgets, usagePollSeconds: 90, alwaysOnTop: true, windowMode: 'max' },
        onChange: () => undefined
      })
    )
    expect(html.match(/type="checkbox"/g)).toHaveLength(WIDGET_KEYS.length + 1)
    expect(html.match(/checked=""/g)).toHaveLength(WIDGET_KEYS.length)
    expect(html).toContain('value="90"')
    expect(html).toContain('Always on top')
  })
})

const allWidgets = Object.fromEntries(WIDGET_KEYS.map((k) => [k, true])) as WidgetToggles

function renderPanel(windowMode: WindowMode, extra: { compact?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(SettingsPanel, {
      config: { widgets: allWidgets, usagePollSeconds: 90, alwaysOnTop: false, windowMode },
      onChange: () => undefined,
      onClose: () => undefined,
      ...extra
    })
  )
}

type ButtonProps = { 'aria-pressed': boolean; onClick: () => void; children: unknown }

/** Calls the hook-free toggle directly and returns its two button elements. */
function toggleButtons(mode: WindowMode, onChange: (m: WindowMode) => void): ButtonProps[] {
  const root = WindowModeToggle({ mode, onChange }) as ReactElement<{ children: ReactElement<ButtonProps>[] }>
  return root.props.children.map((child) => child.props)
}

describe('WindowModeToggle', () => {
  it('shows min and max with the current mode pressed', () => {
    const html = renderPanel('mini')
    expect(html).toMatch(/aria-pressed="true"[^>]*>(?:(?!<\/button>).)*min<\/button>/)
    expect(html).toMatch(/aria-pressed="false"[^>]*>(?:(?!<\/button>).)*max<\/button>/)
    expect(html).toContain('▢')
    expect(html).toContain('▣')
    expect(html).not.toMatch(/minimi[sz]e|maximi[sz]e/i)

    const maxHtml = renderPanel('max')
    expect(maxHtml).toMatch(/aria-pressed="true"[^>]*>(?:(?!<\/button>).)*max<\/button>/)
    expect(maxHtml).toMatch(/aria-pressed="false"[^>]*>(?:(?!<\/button>).)*min<\/button>/)
  })

  it('emits the chosen mode on click and ignores the already-pressed one', () => {
    const emitted: WindowMode[] = []
    const [minButton, maxButton] = toggleButtons('max', (m) => emitted.push(m))
    minButton.onClick()
    maxButton.onClick()
    expect(emitted).toEqual(['mini'])
  })

  it('wires the toggle to onChange({ windowMode }) on the panel', () => {
    const patches: unknown[] = []
    let tree: unknown = null
    // Calling the panel inside a rendered component gives it a live hook dispatcher.
    const Probe = (): ReactElement => {
      const element = SettingsPanel({
        config: { widgets: allWidgets, usagePollSeconds: 90, alwaysOnTop: false, windowMode: 'max' },
        onChange: (patch) => patches.push(patch)
      })
      tree = element
      return element
    }
    renderToStaticMarkup(createElement(Probe))

    const toggle = findElement(tree, WindowModeToggle)
    expect(toggle).not.toBeNull()
    ;(toggle!.props as { onChange: (m: WindowMode) => void }).onChange('mini')
    expect(patches).toEqual([{ windowMode: 'mini' }])
  })
})

function findElement(node: unknown, type: unknown): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type)
      if (found) return found
    }
    return null
  }
  if (!isValidElement(node)) return null
  if (node.type === type) return node
  return findElement((node.props as { children?: unknown }).children, type)
}

describe('SettingsPanel compact', () => {
  it('omits the Done button and uses a 2-column widget grid', () => {
    const html = renderPanel('mini', { compact: true })
    expect(html).not.toContain('Done')
    expect(html).toContain('settings-widget-grid')
    expect(html).toContain('settings-panel--compact')
    expect(html.match(/type="checkbox"/g)).toHaveLength(WIDGET_KEYS.length + 1)
  })

  it('keeps the Done button and single-column list when not compact', () => {
    const html = renderPanel('max')
    expect(html).toContain('Done')
    expect(html).not.toContain('settings-widget-grid')
  })
})
