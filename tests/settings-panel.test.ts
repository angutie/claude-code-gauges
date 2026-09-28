import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WIDGET_KEYS, type WidgetToggles } from '../src/shared/types'
import { clampPollSeconds, SettingsPanel, WIDGET_OPTIONS } from '../src/renderer/components/SettingsPanel'

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
        config: { widgets, usagePollSeconds: 90, alwaysOnTop: true },
        onChange: () => undefined
      })
    )
    expect(html.match(/type="checkbox"/g)).toHaveLength(WIDGET_KEYS.length + 1)
    expect(html.match(/checked=""/g)).toHaveLength(WIDGET_KEYS.length)
    expect(html).toContain('value="90"')
    expect(html).toContain('Always on top')
  })
})
