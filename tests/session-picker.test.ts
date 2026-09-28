import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SessionInfo } from '../src/shared/types'
import {
  isWatched,
  SessionPicker,
  toggleAllSessions,
  toggleWatchedSession
} from '../src/renderer/components/SessionPicker'

function session(sessionId: string, repoName: string, title: string | null = null): SessionInfo {
  return {
    pid: 1,
    sessionId,
    cwd: `C:\Repos\${repoName}`,
    repoName,
    title,
    status: 'idle',
    waitingFor: null,
    entrypoint: 'cli',
    version: null,
    startedAt: null,
    updatedAt: null,
    model: null,
    effort: null,
    effortIsDefault: false,
    gitBranch: null,
    lastActivityAt: null
  }
}

const live = ['a', 'b', 'c']

describe('SessionPicker helpers', () => {
  it('treats undefined and "all" as watching everything', () => {
    expect(isWatched(undefined, 'x')).toBe(true)
    expect(isWatched('all', 'x')).toBe(true)
    expect(isWatched(['a'], 'b')).toBe(false)
  })

  it('unchecking a session while watching all yields the other live sessions', () => {
    expect(toggleWatchedSession('all', 'b', live)).toEqual(['a', 'c'])
    expect(toggleWatchedSession(undefined, 'a', live)).toEqual(['b', 'c'])
  })

  it('toggles a session in an explicit list and drops dead ids', () => {
    expect(toggleWatchedSession(['a', 'dead'], 'c', live)).toEqual(['a', 'c'])
    expect(toggleWatchedSession(['a', 'c'], 'a', live)).toEqual(['c'])
  })

  it('toggling "All sessions" switches between all and an explicit list', () => {
    expect(toggleAllSessions('all', live)).toEqual(live)
    expect(toggleAllSessions(['a'], live)).toBe('all')
  })
})

describe('SessionPicker', () => {
  const sessions = [session('a', 'phoenix-core', 'Tags'), session('b', 'gauges')]

  it('renders an all option plus one checkbox per live session', () => {
    const html = renderToStaticMarkup(createElement(SessionPicker, { sessions, watched: 'all', onChange: () => undefined }))
    expect(html.match(/type="checkbox"/g)).toHaveLength(3)
    expect(html).toContain('All sessions (2)')
    expect(html).toContain('phoenix-core — Tags')
    expect(html.match(/checked=""/g)).toHaveLength(3)
  })

  it('checks only watched sessions for an explicit list', () => {
    const html = renderToStaticMarkup(createElement(SessionPicker, { sessions, watched: ['b'], onChange: () => undefined }))
    expect(html).toContain('1 of 2 sessions')
    expect(html.match(/checked=""/g)).toHaveLength(1)
  })
})
