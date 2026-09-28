import type { SessionInfo, WatchedSessions } from '../../shared/types'

export interface SessionPickerProps {
  /** Every live session for the active account. */
  sessions: SessionInfo[]
  /** The persisted watched setting; undefined means 'all'. */
  watched: WatchedSessions | undefined
  onChange: (watched: WatchedSessions) => void
}

export function isWatched(watched: WatchedSessions | undefined, sessionId: string): boolean {
  return watched === undefined || watched === 'all' || watched.includes(sessionId)
}

/**
 * Returns the watched setting after toggling one session. Ids of sessions
 * that are no longer live are dropped so the persisted list cannot grow forever.
 */
export function toggleWatchedSession(
  watched: WatchedSessions | undefined,
  sessionId: string,
  liveIds: string[]
): WatchedSessions {
  const current = new Set(liveIds.filter((id) => isWatched(watched, id)))
  if (current.has(sessionId)) current.delete(sessionId)
  else current.add(sessionId)
  return liveIds.filter((id) => current.has(id))
}

/** "All sessions" on → 'all'; off → an explicit list of the currently live sessions. */
export function toggleAllSessions(watched: WatchedSessions | undefined, liveIds: string[]): WatchedSessions {
  return watched === undefined || watched === 'all' ? [...liveIds] : 'all'
}

function sessionLabel(session: SessionInfo): string {
  return session.title ? `${session.repoName} — ${session.title}` : session.repoName
}

function summary(watched: WatchedSessions | undefined, sessions: SessionInfo[]): string {
  if (watched === undefined || watched === 'all') return `All sessions (${sessions.length})`
  const count = sessions.filter((s) => watched.includes(s.sessionId)).length
  return `${count} of ${sessions.length} sessions`
}

/** Lets the user choose which live sessions of the active account the SessionList shows. */
export function SessionPicker({ sessions, watched, onChange }: SessionPickerProps): React.JSX.Element {
  const liveIds = sessions.map((s) => s.sessionId)
  const all = watched === undefined || watched === 'all'

  return (
    <details className="panel session-picker">
      <summary className="session-picker-summary">
        <span className="panel-title">Watching</span>
        <span className="muted">{summary(watched, sessions)}</span>
      </summary>
      <fieldset className="session-picker-options">
        <legend className="visually-hidden">Sessions to watch</legend>
        <label className="checkbox-row">
          <input type="checkbox" checked={all} onChange={() => onChange(toggleAllSessions(watched, liveIds))} />
          <span>All sessions</span>
        </label>
        {sessions.length === 0 && <p className="muted session-picker-empty">No live sessions to choose from.</p>}
        {sessions.map((session) => (
          <label key={session.sessionId} className="checkbox-row session-picker-item" title={session.cwd}>
            <input
              type="checkbox"
              checked={isWatched(watched, session.sessionId)}
              onChange={() => onChange(toggleWatchedSession(watched, session.sessionId, liveIds))}
            />
            <span>{sessionLabel(session)}</span>
          </label>
        ))}
      </fieldset>
    </details>
  )
}
