/** Usage percentages at which a gauge changes color (mirrored by CSS tokens in styles.css). */
export const USAGE_THRESHOLDS = {
  warning: 70,
  critical: 90
} as const

export type GaugeLevel = 'normal' | 'warning' | 'critical' | 'unknown'

export function gaugeLevel(percent: number | null | undefined): GaugeLevel {
  if (percent == null || !Number.isFinite(percent)) return 'unknown'
  if (percent > USAGE_THRESHOLDS.critical) return 'critical'
  if (percent >= USAGE_THRESHOLDS.warning) return 'warning'
  return 'normal'
}

/** CSS custom property holding the color for a gauge level. */
export function gaugeColorVar(level: GaugeLevel): string {
  return `var(--gauge-${level})`
}
