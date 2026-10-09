import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { UsageSnapshot } from '../src/shared/types'
import {
  UsageGauge,
  UsagePanel,
  compactNotice,
  type UsagePanelProps
} from '../src/renderer/components/UsageGauge'

const NOW = 1_790_000_000_000
const ALL_ON = { usage5h: true, usageWeekly: true }

function makeUsage(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    status: 'ok',
    fiveHour: { percent: 42, resetsAt: NOW + 2 * 3_600_000 + 5 * 60_000 },
    weekly: { percent: 75, resetsAt: NOW + 3 * 86_400_000 },
    weeklyOpus: null,
    weeklySonnet: null,
    lastSuccessAt: NOW - 12_000,
    lastAttemptAt: NOW - 12_000,
    nextPollAt: NOW + 60_000,
    message: null,
    ...overrides
  }
}

function render(props: Partial<UsagePanelProps> = {}): string {
  return renderToStaticMarkup(
    createElement(UsagePanel, { usage: makeUsage(), widgets: ALL_ON, now: NOW, ...props })
  )
}

describe('UsageGauge', () => {
  it.each([
    [50, 'normal'],
    [80, 'warning'],
    [95, 'critical']
  ] as const)('colors %s percent as %s', (percent, level) => {
    const html = renderToStaticMarkup(
      createElement(UsageGauge, { label: 'Weekly', window: { percent, resetsAt: null }, now: NOW })
    )
    expect(html).toContain(`data-level="${level}"`)
    expect(html).toContain(`var(--gauge-${level})`)
    expect(html).toContain(`${percent}%`)
  })

  it('shows unknown for a null percentage', () => {
    const html = renderToStaticMarkup(
      createElement(UsageGauge, { label: 'Weekly', window: { percent: null, resetsAt: null }, now: NOW })
    )
    expect(html).toContain('unknown')
    expect(html).toContain('data-level="unknown"')
    expect(html).toContain('reset time unknown')
  })
})

describe('UsagePanel', () => {
  it('renders the Session (5h) and Weekly gauges with countdowns and last-updated', () => {
    const html = render()
    expect(html).toContain('Session (5h)')
    expect(html).toContain('Weekly')
    expect(html).toContain('42%')
    expect(html).toContain('75%')
    expect(html).toContain('data-level="normal"')
    expect(html).toContain('data-level="warning"')
    expect(html).toContain('resets in 2h 05m')
    expect(html).toContain('resets in 3d 00h')
    expect(html).toContain('last updated 12 s ago')
  })

  it('renders secondary Opus/Sonnet bars only when present', () => {
    expect(render()).not.toContain('Opus')
    const html = render({
      usage: makeUsage({
        weeklyOpus: { percent: 92, resetsAt: null },
        weeklySonnet: { percent: null, resetsAt: null }
      })
    })
    expect(html).toContain('Opus')
    expect(html).toContain('usage-gauge--secondary usage-gauge--critical')
    expect(html).not.toContain('Sonnet')
  })

  it('shows the refresh hint when the token is expired', () => {
    const hint = 'run <code>claude</code> to refresh'
    expect(render({ usage: makeUsage({ status: 'expired' }) })).toContain(hint)
    expect(render({ tokenStatus: 'expired' })).toContain(hint)
    expect(render()).not.toContain('to refresh')
  })

  it('shows stale, error, unavailable and loading notices', () => {
    const stale = render({ usage: makeUsage({ status: 'stale', message: 'Rate limited' }) })
    expect(stale).toContain('Stale data — Rate limited')
    expect(stale).toContain('usage-gauge--stale')
    expect(render({ usage: makeUsage({ status: 'error', message: 'Boom' }) })).toContain('Boom')
    expect(render({ usage: makeUsage({ status: 'unavailable' }) })).toContain('No credentials found')
    const loading = render({
      usage: makeUsage({ status: 'loading', fiveHour: null, weekly: null, lastSuccessAt: null })
    })
    expect(loading).toContain('Loading usage')
    expect(loading).toContain('never updated')
    expect(loading).toContain('unknown')
  })

  it('respects widget toggles', () => {
    const html = render({ widgets: { usage5h: false, usageWeekly: true } })
    expect(html).not.toContain('Session (5h)')
    expect(html).toContain('Weekly')
    expect(render({ widgets: { usage5h: false, usageWeekly: false } })).toBe('')
  })
})

describe('UsagePanel compact', () => {
  const compact = (props: Partial<UsagePanelProps> = {}): string => render({ compact: true, ...props })

  it('renders both 5h and weekly gauges with reset times and no panel heading', () => {
    const html = compact()
    expect(html).toContain('usage-panel--compact')
    expect(html).toContain('Session (5h)')
    expect(html).toContain('Weekly')
    expect(html).toContain('resets in 2h 05m')
    expect(html).toContain('resets in 3d 00h')
    expect(html).toContain('last updated 12 s ago')
    expect(html).not.toContain('panel-title')
    expect(html).not.toContain('usage-notice')
  })

  it.each([
    [{ usage: makeUsage({ status: 'expired' }) }, 'Token expired — run claude', 'usage-notice--expired'],
    [{ tokenStatus: 'expired' as const }, 'Token expired — run claude', 'usage-notice--expired'],
    [{ usage: makeUsage({ status: 'stale', message: 'Rate limited' }) }, 'Stale data', 'usage-notice--stale'],
    [{ usage: makeUsage({ status: 'error', message: 'Boom' }) }, 'Usage error', 'usage-notice--error']
  ])('renders a single short notice line', (props, text, tone) => {
    const html = compact(props)
    expect(html.match(/<p /g)).toHaveLength(1)
    expect(html).toContain('usage-notice--compact')
    expect(html).toContain(tone)
    expect(html).toContain(`>${text}</p>`)
    expect(html).not.toContain('<code>')
  })

  it('keeps full notice detail in the tooltip', () => {
    expect(compactNotice(makeUsage({ status: 'stale', message: 'Rate limited' }))).toEqual({
      text: 'Stale data',
      title: 'Stale data — Rate limited',
      tone: 'stale'
    })
    expect(compactNotice(makeUsage({ status: 'error', message: 'Boom' }))?.title).toBe('Boom')
    expect(compactNotice(makeUsage())).toBeNull()
  })

  it('shows Opus/Sonnet bars without countdowns only when enabled and allowed', () => {
    const usage = makeUsage({
      weeklyOpus: { percent: 92, resetsAt: NOW + 86_400_000 },
      weeklySonnet: { percent: 30, resetsAt: NOW + 86_400_000 }
    })
    const html = compact({ usage })
    expect(html).toContain('Opus')
    expect(html).toContain('Sonnet')
    expect(html).toContain('usage-secondary--compact')
    expect(html.match(/resets in/g)).toHaveLength(2)
    expect(compact({ usage, showSecondary: false })).not.toContain('Opus')
    expect(compact({ usage, widgets: { usage5h: true, usageWeekly: false } })).not.toContain('Opus')
  })

  it('respects widget toggles', () => {
    expect(compact({ widgets: { usage5h: true, usageWeekly: false } })).not.toContain('Weekly')
    expect(compact({ widgets: { usage5h: false, usageWeekly: false } })).toBe('')
  })
})
