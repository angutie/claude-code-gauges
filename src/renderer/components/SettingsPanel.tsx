import { useEffect, useState } from 'react'
import type { AppConfig, WidgetKey, WidgetToggles, WindowMode } from '../../shared/types'

// Mirrors the limits enforced by the main-process config store.
export const MIN_POLL_SECONDS = 60
export const MAX_POLL_SECONDS = 600

export const WIDGET_OPTIONS: ReadonlyArray<{ key: WidgetKey; label: string }> = [
  { key: 'usage5h', label: 'Session (5h) gauge' },
  { key: 'usageWeekly', label: 'Weekly gauge' },
  { key: 'sessions', label: 'Session list' },
  { key: 'model', label: 'Model' },
  { key: 'effort', label: 'Effort' },
  { key: 'branch', label: 'Git branch' },
  { key: 'status', label: 'Status' }
]

/** Parses and clamps a poll interval; returns null for non-numeric input. */
export function clampPollSeconds(value: string | number): number | null {
  const parsed = typeof value === 'number' ? value : Number(value.trim())
  if (typeof value === 'string' && value.trim() === '') return null
  if (!Number.isFinite(parsed)) return null
  return Math.min(MAX_POLL_SECONDS, Math.max(MIN_POLL_SECONDS, Math.round(parsed)))
}

/** Segmented window-mode options; labels deliberately avoid "minimize/maximize". */
export const WINDOW_MODE_OPTIONS: ReadonlyArray<{ mode: WindowMode; label: string; glyph: string }> = [
  { mode: 'mini', label: 'min', glyph: '▢' },
  { mode: 'max', label: 'max', glyph: '▣' }
]

export interface WindowModeToggleProps {
  mode: WindowMode
  onChange: (mode: WindowMode) => void
}

/** Two-button segmented control switching between the mini and max window. */
export function WindowModeToggle({ mode, onChange }: WindowModeToggleProps): React.JSX.Element {
  return (
    <div className="segmented" role="group" aria-label="Window size">
      {WINDOW_MODE_OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          className="segmented-option"
          aria-pressed={option.mode === mode}
          onClick={() => {
            if (option.mode !== mode) onChange(option.mode)
          }}
        >
          <span className="segmented-glyph" aria-hidden="true">
            {option.glyph}
          </span>
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Reads an input's value without relying on DOM lib typings: tests pull this
 * file into the Node tsconfig, which has no DOM lib.
 */
function inputValue(target: unknown): string {
  return String((target as { value?: unknown }).value ?? '')
}

type SettingsConfig = Pick<AppConfig, 'widgets' | 'usagePollSeconds' | 'alwaysOnTop' | 'windowMode'>

export interface SettingsPanelProps {
  config: SettingsConfig
  onChange: (patch: Partial<SettingsConfig>) => void
  onClose?: () => void
  /** Condensed layout for the mini window: 2-column widget grid, no Done button. */
  compact?: boolean
}

export function SettingsPanel({
  config,
  onChange,
  onClose,
  compact = false
}: SettingsPanelProps): React.JSX.Element {
  const [pollDraft, setPollDraft] = useState(String(config.usagePollSeconds))

  useEffect(() => {
    setPollDraft(String(config.usagePollSeconds))
  }, [config.usagePollSeconds])

  const commitPoll = (): void => {
    const seconds = clampPollSeconds(pollDraft)
    if (seconds === null) {
      setPollDraft(String(config.usagePollSeconds))
      return
    }
    setPollDraft(String(seconds))
    if (seconds !== config.usagePollSeconds) onChange({ usagePollSeconds: seconds })
  }

  const toggleWidget = (key: WidgetKey): void => {
    const widgets: WidgetToggles = { ...config.widgets, [key]: !config.widgets[key] }
    onChange({ widgets })
  }

  return (
    <section
      className={`panel settings-panel${compact ? ' settings-panel--compact' : ''}`}
      aria-label="Settings"
    >
      <div className="settings-panel-head">
        <h2 className="panel-title">Settings</h2>
        {onClose && !compact && (
          <button type="button" className="button" onClick={onClose}>
            Done
          </button>
        )}
      </div>

      <fieldset className="settings-group">
        <legend className="settings-legend">Widgets</legend>
        <div className={compact ? 'settings-widget-grid' : undefined}>
          {WIDGET_OPTIONS.map(({ key, label }) => (
            <label key={key} className="checkbox-row">
              <input type="checkbox" checked={config.widgets[key]} onChange={() => toggleWidget(key)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="settings-group">
        <legend className="settings-legend">Usage</legend>
        <label className="settings-field">
          <span>Poll interval (seconds)</span>
          <input
            type="number"
            className="settings-input"
            min={MIN_POLL_SECONDS}
            max={MAX_POLL_SECONDS}
            step={10}
            value={pollDraft}
            onChange={(e) => setPollDraft(inputValue(e.currentTarget))}
            onBlur={commitPoll}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitPoll()
            }}
          />
        </label>
        {!compact && (
          <p className="muted settings-hint">
            Between {MIN_POLL_SECONDS} and {MAX_POLL_SECONDS} seconds.
          </p>
        )}
      </fieldset>

      <fieldset className="settings-group">
        <legend className="settings-legend">Window</legend>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={config.alwaysOnTop}
            onChange={() => onChange({ alwaysOnTop: !config.alwaysOnTop })}
          />
          <span>Always on top</span>
        </label>
        <WindowModeToggle mode={config.windowMode} onChange={(windowMode) => onChange({ windowMode })} />
      </fieldset>
    </section>
  )
}
