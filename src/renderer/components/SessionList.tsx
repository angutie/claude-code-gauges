import type { SessionInfo, WidgetToggles } from '../../shared/types'
import { friendlyModelName } from '../utils/model-name'

export type SessionColumnToggles = Pick<WidgetToggles, 'sessions' | 'model' | 'effort' | 'branch' | 'status'>

export interface SessionListProps {
  sessions: SessionInfo[]
  widgets: SessionColumnToggles
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

/** Lists watched live sessions; each column honours the widget toggles from config. */
export function SessionList({ sessions, widgets }: SessionListProps): React.JSX.Element | null {
  if (!widgets.sessions) return null

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
