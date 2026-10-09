import type { EpochMs, TokenStatus, UsageSnapshot, UsageWindow, WidgetToggles } from '../../shared/types'
import { gaugeColorVar } from '../theme'
import { useNow } from '../utils/clock'
import {
  clampPercent,
  formatLastUpdated,
  formatPercent,
  formatResetCountdown,
  gaugeLevel
} from '../utils/format'

export type UsageGaugeVariant = 'primary' | 'secondary'

export interface UsageGaugeProps {
  label: string
  window: UsageWindow | null
  now: EpochMs
  variant?: UsageGaugeVariant
  /** Dims the gauge when the data shown is not fresh. */
  stale?: boolean
}

const BAR_HEIGHT: Record<UsageGaugeVariant, number> = { primary: 10, secondary: 6 }

/** A single horizontal SVG meter with percentage, threshold color and reset countdown. */
export function UsageGauge({
  label,
  window,
  now,
  variant = 'primary',
  stale = false
}: UsageGaugeProps): React.JSX.Element {
  const percent = window?.percent ?? null
  const level = gaugeLevel(percent)
  const fill = clampPercent(percent)
  const countdown = formatResetCountdown(window?.resetsAt, now)
  const height = BAR_HEIGHT[variant]
  const radius = height / 2
  const className = [
    'usage-gauge',
    `usage-gauge--${variant}`,
    `usage-gauge--${level}`,
    stale ? 'usage-gauge--stale' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className} data-level={level}>
      <div className="usage-gauge-head">
        <span className="usage-gauge-label">{label}</span>
        <span className={`usage-gauge-value level-${level}`}>{formatPercent(percent)}</span>
      </div>
      <svg
        className="usage-gauge-bar"
        width="100%"
        height={height}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={percent == null ? 'unknown' : formatPercent(percent)}
      >
        <rect x="0" y="0" width="100%" height={height} rx={radius} fill="var(--gauge-track)" />
        {fill > 0 && (
          <rect x="0" y="0" width={`${fill}%`} height={height} rx={radius} fill={gaugeColorVar(level)} />
        )}
      </svg>
      {variant === 'primary' && (
        <div className="usage-gauge-foot muted">{countdown ?? 'reset time unknown'}</div>
      )}
      {variant === 'secondary' && countdown && <div className="usage-gauge-foot muted">{countdown}</div>}
    </div>
  )
}

export interface UsagePanelProps {
  usage: UsageSnapshot
  widgets: Pick<WidgetToggles, 'usage5h' | 'usageWeekly'>
  /** From the account identity; an expired token shows the refresh hint even before the next poll. */
  tokenStatus?: TokenStatus | null
  /** Fixed time for tests; when omitted the panel ticks every second. */
  now?: EpochMs
  /**
   * Condensed layout for the square mini window: no panel heading, single-line notices and
   * Opus/Sonnet bars without countdowns.
   */
  compact?: boolean
  /** Compact only: lets the host drop the Opus/Sonnet bars when space is tight. Defaults to true. */
  showSecondary?: boolean
}

function RefreshHint(): React.JSX.Element {
  return (
    <p className="usage-notice usage-notice--expired" role="alert">
      Token expired — run <code>claude</code> to refresh
    </p>
  )
}

function StatusNotice({ usage }: { usage: UsageSnapshot }): React.JSX.Element | null {
  switch (usage.status) {
    case 'loading':
      return <p className="usage-notice muted">Loading usage…</p>
    case 'stale':
      return (
        <p className="usage-notice usage-notice--stale">
          Stale data{usage.message ? ` — ${usage.message}` : ' — last refresh failed'}
        </p>
      )
    case 'error':
      return <p className="usage-notice usage-notice--error">{usage.message ?? 'Usage unavailable'}</p>
    case 'unavailable':
      return (
        <p className="usage-notice muted">{usage.message ?? 'No credentials found for this account'}</p>
      )
    default:
      return null
  }
}

export type CompactNoticeTone = 'expired' | 'stale' | 'error' | 'muted'

export interface CompactNotice {
  /** Short single-line text shown in the mini window. */
  text: string
  /** Full detail for the tooltip. */
  title: string
  tone: CompactNoticeTone
}

/** Condensed one-line notice for the compact panel, or null when usage is fresh. */
export function compactNotice(
  usage: UsageSnapshot,
  tokenStatus?: TokenStatus | null
): CompactNotice | null {
  if (usage.status === 'expired' || tokenStatus === 'expired') {
    return {
      text: 'Token expired — run claude',
      title: 'Token expired — run claude to refresh',
      tone: 'expired'
    }
  }
  switch (usage.status) {
    case 'loading':
      return { text: 'Loading usage…', title: 'Loading usage…', tone: 'muted' }
    case 'stale':
      return {
        text: 'Stale data',
        title: `Stale data — ${usage.message ?? 'last refresh failed'}`,
        tone: 'stale'
      }
    case 'error':
      return { text: 'Usage error', title: usage.message ?? 'Usage unavailable', tone: 'error' }
    case 'unavailable':
      return {
        text: 'No credentials',
        title: usage.message ?? 'No credentials found for this account',
        tone: 'muted'
      }
    default:
      return null
  }
}

function CompactNoticeLine({ notice }: { notice: CompactNotice }): React.JSX.Element {
  const toneClass = notice.tone === 'muted' ? 'muted' : `usage-notice--${notice.tone}`
  return (
    <p
      className={`usage-notice usage-notice--compact ${toneClass}`}
      title={notice.title}
      role={notice.tone === 'expired' ? 'alert' : undefined}
    >
      {notice.text}
    </p>
  )
}

/** The "Session (5h)" and "Weekly" gauges plus optional Opus/Sonnet weekly bars. */
export function UsagePanel({
  usage,
  widgets,
  tokenStatus,
  now: fixedNow,
  compact = false,
  showSecondary = true
}: UsagePanelProps): React.JSX.Element | null {
  const tickingNow = useNow()
  const now = fixedNow ?? tickingNow

  if (!widgets.usage5h && !widgets.usageWeekly) return null

  const expired = usage.status === 'expired' || tokenStatus === 'expired'
  const stale = usage.status === 'stale' || expired
  const secondary = [
    { label: 'Opus', window: usage.weeklyOpus },
    { label: 'Sonnet', window: usage.weeklySonnet }
  ].filter((entry) => entry.window?.percent != null)

  if (compact) {
    const notice = compactNotice(usage, tokenStatus)
    const compactSecondary = widgets.usageWeekly && showSecondary ? secondary : []
    return (
      <section className="usage-panel usage-panel--compact" aria-label="Usage">
        {notice && <CompactNoticeLine notice={notice} />}
        <div className="usage-gauges usage-gauges--compact">
          {widgets.usage5h && (
            <UsageGauge label="Session (5h)" window={usage.fiveHour} now={now} stale={stale} />
          )}
          {widgets.usageWeekly && (
            <UsageGauge label="Weekly" window={usage.weekly} now={now} stale={stale} />
          )}
          {compactSecondary.length > 0 && (
            <div className="usage-secondary usage-secondary--compact">
              {compactSecondary.map((entry) => (
                <UsageGauge
                  key={entry.label}
                  label={entry.label}
                  window={{ percent: entry.window?.percent ?? null, resetsAt: null }}
                  now={now}
                  variant="secondary"
                  stale={stale}
                />
              ))}
            </div>
          )}
        </div>
        <span
          className="usage-updated usage-updated--compact muted"
          title="Time since the last successful usage fetch"
        >
          {formatLastUpdated(usage.lastSuccessAt, now)}
        </span>
      </section>
    )
  }

  return (
    <section className="panel usage-panel" aria-label="Usage">
      <div className="usage-panel-head">
        <h2 className="panel-title">Usage</h2>
        <span className="usage-updated muted" title="Time since the last successful usage fetch">
          {formatLastUpdated(usage.lastSuccessAt, now)}
        </span>
      </div>
      {expired ? <RefreshHint /> : <StatusNotice usage={usage} />}
      <div className="usage-gauges">
        {widgets.usage5h && <UsageGauge label="Session (5h)" window={usage.fiveHour} now={now} stale={stale} />}
        {widgets.usageWeekly && (
          <div className="usage-weekly">
            <UsageGauge label="Weekly" window={usage.weekly} now={now} stale={stale} />
            {secondary.length > 0 && (
              <div className="usage-secondary">
                {secondary.map((entry) => (
                  <UsageGauge
                    key={entry.label}
                    label={entry.label}
                    window={entry.window}
                    now={now}
                    variant="secondary"
                    stale={stale}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

export default UsageGauge
