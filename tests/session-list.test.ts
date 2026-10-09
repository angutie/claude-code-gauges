import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SessionInfo } from '../src/shared/types'
import {
  SessionList,
  condenseSessions,
  DEFAULT_COMPACT_ROWS,
  sessionStatusLabel,
  type SessionColumnToggles
} from '../src/renderer/components/SessionList'

const ALL_ON: SessionColumnToggles = { sessions: true, model: true, effort: true, branch: true, status: true }

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    pid: 1234,
    sessionId: 'session-1',
    cwd: 'C:\\Repos\\phoenix-core',
    repoName: 'phoenix-core',
    title: 'Entity Tags backend state',
    status: 'waiting',
    waitingFor: 'permission prompt',
    entrypoint: 'cli',
    version: '2.1.281',
    startedAt: 1,
    updatedAt: 2,
    model: 'claude-opus-5-5',
    effort: 'max',
    effortIsDefault: false,
    gitBranch: 'feature/tags',
    lastActivityAt: 3,
    ...overrides
  }
}

function render(sessions: SessionInfo[], widgets: SessionColumnToggles = ALL_ON): string {
  return renderToStaticMarkup(createElement(SessionList, { sessions, widgets }))
}

describe('SessionList', () => {
  it('shows repo, title, model, effort, branch and status for each session', () => {
    const html = render([makeSession(), makeSession({ sessionId: 's2', repoName: 'other-repo', effort: 'low' })])
    expect(html).toContain('phoenix-core')
    expect(html).toContain('other-repo')
    expect(html).toContain('Entity Tags backend state')
    expect(html).toContain('Opus 5.5')
    expect(html).toContain('effort-badge--max')
    expect(html).toContain('effort-badge--low')
    expect(html).toContain('feature/tags')
    expect(html).toContain('waiting: permission prompt')
  })

  it('does not render hidden widgets', () => {
    const html = render([makeSession()], { ...ALL_ON, branch: false, status: false })
    expect(html).toContain('phoenix-core')
    expect(html).toContain('Opus 5.5')
    expect(html).not.toContain('data-widget="branch"')
    expect(html).not.toContain('feature/tags')
    expect(html).not.toContain('data-widget="status"')
    expect(html).not.toContain('permission prompt')
  })

  it('hides model and effort when toggled off', () => {
    const html = render([makeSession()], { ...ALL_ON, model: false, effort: false })
    expect(html).not.toContain('data-widget="model"')
    expect(html).not.toContain('data-widget="effort"')
  })

  it('renders nothing when the sessions widget is off', () => {
    expect(render([makeSession()], { ...ALL_ON, sessions: false })).toBe('')
  })

  it('shows an empty state when there are no sessions', () => {
    const html = render([])
    expect(html).toContain('No running Claude Code sessions.')
    expect(html).not.toContain('session-row')
  })

  it('degrades gracefully when model/effort are unknown and marks default effort', () => {
    const html = render([
      makeSession({ model: null, effort: null, gitBranch: null }),
      makeSession({ sessionId: 's2', effort: 'medium', effortIsDefault: true })
    ])
    expect(html).toContain('unknown model')
    expect(html).toContain('unknown effort')
    expect(html).toContain('medium (default)')
  })
})

describe('sessionStatusLabel', () => {
  it('includes the waiting reason', () => {
    expect(sessionStatusLabel({ status: 'waiting', waitingFor: 'permission prompt' })).toBe(
      'waiting: permission prompt'
    )
  })

  it('falls back to the bare status', () => {
    expect(sessionStatusLabel({ status: 'waiting', waitingFor: null })).toBe('waiting')
    expect(sessionStatusLabel({ status: 'busy', waitingFor: null })).toBe('busy')
  })
})

describe('condenseSessions', () => {
  const sessions = [1, 2, 3, 4, 5, 6, 7].map((n) => makeSession({ sessionId: `s${n}` }))

  it('caps visible rows and reports the hidden count', () => {
    const { visible, hiddenCount } = condenseSessions(sessions, 5)
    expect(visible.map((s) => s.sessionId)).toEqual(['s1', 's2', 's3', 's4', 's5'])
    expect(hiddenCount).toBe(2)
  })

  it('hides nothing when the list fits', () => {
    expect(condenseSessions(sessions.slice(0, 3), 5)).toEqual({ visible: sessions.slice(0, 3), hiddenCount: 0 })
    expect(condenseSessions([], 5)).toEqual({ visible: [], hiddenCount: 0 })
  })

  it('clamps negative/fractional caps and treats non-finite as no cap', () => {
    expect(condenseSessions(sessions, -1)).toEqual({ visible: [], hiddenCount: 7 })
    expect(condenseSessions(sessions, 2.9).visible).toHaveLength(2)
    expect(condenseSessions(sessions, Number.POSITIVE_INFINITY).hiddenCount).toBe(0)
  })
})

describe('SessionList compact', () => {
  function renderCompact(sessions: SessionInfo[], maxRows?: number, widgets = ALL_ON): string {
    return renderToStaticMarkup(createElement(SessionList, { sessions, widgets, compact: true, maxRows }))
  }

  it('renders one line per session with repo, status dot, model and effort', () => {
    const html = renderCompact([makeSession(), makeSession({ sessionId: 's2', repoName: 'other-repo', status: 'busy' })])
    expect(html.match(/session-row--compact/g)).toHaveLength(2)
    expect(html).toContain('phoenix-core')
    expect(html).toContain('session-status-dot--waiting')
    expect(html).toContain('aria-label="waiting: permission prompt"')
    expect(html).toContain('session-status-dot--busy')
    expect(html).toContain('Opus 5.5')
    expect(html).toContain('effort-badge--max')
    expect(html).not.toContain('session-title')
    expect(html).not.toContain('session-meta')
    expect(html).not.toContain('feature/tags')
    expect(html).not.toContain('more</p>')
  })

  it('caps rows and shows a "+N more" footer', () => {
    const sessions = [1, 2, 3, 4, 5, 6, 7].map((n) => makeSession({ sessionId: `s${n}` }))
    const html = renderCompact(sessions, 4)
    expect(html.match(/<li /g)).toHaveLength(4)
    expect(html).toContain('+3 more')
    expect(renderCompact(sessions).match(/<li /g)).toHaveLength(DEFAULT_COMPACT_ROWS)
  })

  it('honours widget toggles and the empty state', () => {
    const html = renderCompact([makeSession()], undefined, { ...ALL_ON, status: false, model: false, effort: false })
    expect(html).not.toContain('data-widget')
    expect(renderCompact([])).toContain('No running sessions.')
    expect(renderCompact([makeSession()], undefined, { ...ALL_ON, sessions: false })).toBe('')
  })

  it('falls back to ? for unknown model/effort', () => {
    const html = renderCompact([makeSession({ model: null, effort: null })])
    expect(html).toContain('effort-badge--other')
    expect(html).not.toContain('unknown')
  })
})
