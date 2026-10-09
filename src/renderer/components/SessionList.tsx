import type { SessionInfo, WidgetToggles } from '../../shared/types'
import { friendlyModelName } from '../utils/model-name'

export type SessionColumnToggles = Pick<WidgetToggles, 'sessions' | 'model' | 'effort' | 'branch' | 'status'>

export interface SessionListProps {
  sessions: SessionInfo[]
  widgets: SessionColumnToggles
  /** One-line rows capped at `maxRows` with a "+N more" footer, so the list never scrolls (mini mode). */
  compact?: boolean
  /** Maximum rows shown in compact mode; defaults to {@link DEFAULT_COMPACT_ROWS}. */
  maxRows?: number
}

/** Default number of rows the compact list shows before collapsing the rest into "+N more". */
export const DEFAULT_COMPACT_ROWS = 5

/** Result of {@link condenseSessions}: the rows to render and how many were left out. */
export interface CondensedSessions {
  visible: SessionInfo[]
  hiddenCount: number
}

/** Caps the list at `max` rows (floored, never below 0; non-finite means no cap) and counts the rest. */
export function condenseSessions(sessions: readonly SessionInfo[], max: number): CondensedSessions {
  const limit = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : sessions.length
  const visible = sessions.slice(0, limit)
  return { visible, hiddenCount: sessions.length - visible.length }
}

const KNOWN_EFFORT_LEVELS = ['low', 'medium', 'high', 'max'] as const

/** Human-readable status, e.g. "waiting: permission prompt". */
export function sessionStatusLabel(session: Pick<SessionInfo, 'status' | 'waitingFor'>): string {
  if (session.status === 'waiting' && session.waitingFor) return `waiting: ${session.waitingFor}`
  return session.status
}

function effortClassName(effort: string): string {
  const level = (KNOWN_EFFORT_LEVELS as readonly string[]).includes(effort) ? effort : 'other'
  return `effort-badge effort-badge--${level}`
}

function SessionRow({
  session,
  widgets
}: {
  session: SessionInfo
  widgets: SessionColumnToggles
}): React.JSX.Element {
  const modelName = friendlyModelName(session.model)
  return (
    <li className="session-row" data-session-id={session.sessionId}>
      <div className="session-row-head">
        <span className="session-repo" title={session.cwd}>
          {session.repoName}
        </span>
        {widgets.status && (
          <span className={`session-status session-status--${session.status}`} data-widget="status">
            {sessionStatusLabel(session)}
          </span>
        )}
      </div>
      {session.title && <div className="session-title">{session.title}</div>}
      <div className="session-meta">
        {widgets.model && (
          <span className="session-model" data-widget="model" title={session.model ?? undefined}>
            {modelName ?? 'unknown model'}
          </span>
        )}
        {widgets.effort &&
          (session.effort ? (
            <span
              className={effortClassName(session.effort)}
              data-widget="effort"
              title={session.effortIsDefault ? 'Default effort from settings.json' : 'Effort level'}
            >
              {session.effort}
              {session.effortIsDefault && ' (default)'}
            </span>
          ) : (
            <span className="effort-badge effort-badge--other" data-widget="effort">
              unknown effort
            </span>
          ))}
        {widgets.branch && session.gitBranch && (
          <span className="session-branch" data-widget="branch" title="Git branch">
            ⎇ {session.gitBranch}
          </span>
        )}
      </div>
    </li>
  )
}

/** Single-line row for compact mode: repo · status dot · model · effort. */
function CompactSessionRow({
  session,
  widgets
}: {
  session: SessionInfo
  widgets: SessionColumnToggles
}): React.JSX.Element {
  const modelName = friendlyModelName(session.model)
  const statusLabel = sessionStatusLabel(session)
  return (
    <li className="session-row session-row--compact" data-session-id={session.sessionId}>
      <span className="session-repo" title={session.title ? `${session.cwd}\n${session.title}` : session.cwd}>
        {session.repoName}
      </span>
      {widgets.status && (
        <span
          className={`session-status-dot session-status-dot--${session.status}`}
          data-widget="status"
          role="img"
          aria-label={statusLabel}
          title={statusLabel}
        />
      )}
      {widgets.model && (
        <span className="session-model" data-widget="model" title={session.model ?? undefined}>
          {modelName ?? '?'}
        </span>
      )}
      {widgets.effort && (
        <span
          className={session.effort ? effortClassName(session.effort) : 'effort-badge effort-badge--other'}
          data-widget="effort"
          title={session.effortIsDefault ? 'Default effort from settings.json' : 'Effort level'}
        >
          {session.effort ?? '?'}
        </span>
      )}
    </li>
  )
}

function CompactSessionList({
  sessions,
  widgets,
  maxRows
}: {
  sessions: SessionInfo[]
  widgets: SessionColumnToggles
  maxRows: number
}): React.JSX.Element {
  const { visible, hiddenCount } = condenseSessions(sessions, maxRows)
  return (
    <section className="panel session-panel--compact" aria-label="Sessions">
      {sessions.length === 0 ? (
        <p className="muted session-empty">No running sessions.</p>
      ) : (
        <>
          <ul className="session-list session-list--compact">
            {visible.map((session) => (
              <CompactSessionRow key={session.sessionId} session={session} widgets={widgets} />
            ))}
          </ul>
          {hiddenCount > 0 && <p className="session-more muted">+{hiddenCount} more</p>}
        </>
      )}
    </section>
  )
}

/** Lists watched live sessions; each column honours the widget toggles from config. */
export function SessionList({
  sessions,
  widgets,
  compact = false,
  maxRows = DEFAULT_COMPACT_ROWS
}: SessionListProps): React.JSX.Element | null {
  if (!widgets.sessions) return null
  if (compact) return <CompactSessionList sessions={sessions} widgets={widgets} maxRows={maxRows} />

  return (
    <section className="panel" aria-label="Sessions">
      <h2 className="panel-title">Sessions</h2>
      {sessions.length === 0 ? (
        <p className="muted session-empty">No running Claude Code sessions.</p>
      ) : (
        <ul className="session-list">
          {sessions.map((session) => (
            <SessionRow key={session.sessionId} session={session} widgets={widgets} />
          ))}
        </ul>
      )}
    </section>
  )
}

export default SessionList
