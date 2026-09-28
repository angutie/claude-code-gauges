import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SessionInfo } from '../src/shared/types'
import {
  SessionList,
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
