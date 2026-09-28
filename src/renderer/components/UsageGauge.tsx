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

/** The "Session (5h)" and "Weekly" gauges plus optional Opus/Sonnet weekly bars. */
export function UsagePanel({ usage, widgets, tokenStatus, now: fixedNow }: UsagePanelProps): React.JSX.Element | null {
  const tickingNow = useNow()
  const now = fixedNow ?? tickingNow

  if (!widgets.usage5h && !widgets.usageWeekly) return null

  const expired = usage.status === 'expired' || tokenStatus === 'expired'
  const stale = usage.status === 'stale' || expired
  const secondary = [
    { label: 'Opus', window: usage.weeklyOpus },
    { label: 'Sonnet', window: usage.weeklySonnet }
  ].filter((entry) => entry.window?.percent != null)

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
