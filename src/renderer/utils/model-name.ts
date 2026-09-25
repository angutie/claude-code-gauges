/** Explicit display names for ids that the generic parser can't derive. */
const KNOWN_MODEL_NAMES: Record<string, string> = {
  'claude-instant-1': 'Claude Instant 1',
  'claude-instant-1.2': 'Claude Instant 1.2',
  'claude-2': 'Claude 2',
  'claude-2.0': 'Claude 2',
  'claude-2.1': 'Claude 2.1'
}

const FAMILY_PATTERN = /^[a-z]+$/
const VERSION_PART_PATTERN = /^\d{1,2}$/

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * Strips provider prefixes/suffixes and context-window markers so only the
 * core id remains, e.g. "us.anthropic.claude-sonnet-4-5-20250929-v1:0" →
 * "claude-sonnet-4-5".
 */
function normalizeModelId(id: string): { core: string; longContext: boolean } {
  let core = id.trim().toLowerCase()
  const longContext = /\[1m\]$/.test(core)
  core = core.replace(/\[[^\]]*\]$/, '')
  core = core.replace(/^(?:[a-z]{2}\.)?anthropic\./, '') // Bedrock
  core = core.replace(/^[^/]+\//, '') // provider/model form
  core = core.replace(/-v\d+(?::\d+)?$/, '') // Bedrock version suffix
  core = core.replace(/@\d{8}$/, '') // Vertex date suffix
  core = core.replace(/-\d{8}$/, '') // Anthropic date suffix
  core = core.replace(/-latest$/, '')
  return { core, longContext }
}

/**
 * Maps a Claude model id to a friendly display name, e.g.
 * "claude-opus-5-5" → "Opus 5.5", "claude-3-5-sonnet-20241022" → "Sonnet 3.5".
 * Returns the original id when it can't be recognized, and null for empty input.
 */
export function friendlyModelName(id: string | null | undefined): string | null {
  if (id == null) return null
  const raw = id.trim()
  if (raw === '') return null

  const { core, longContext } = normalizeModelId(raw)
  const suffix = longContext ? ' (1M)' : ''

  const known = KNOWN_MODEL_NAMES[core]
  if (known) return known + suffix

  if (!core.startsWith('claude-')) return raw

  const parts = core.slice('claude-'.length).split('-')
  const families = parts.filter((p) => FAMILY_PATTERN.test(p))
  const versions = parts.filter((p) => VERSION_PART_PATTERN.test(p))
  if (families.length !== 1 || versions.length === 0) return raw
  if (families.length + versions.length !== parts.length) return raw

  return `${capitalize(families[0])} ${versions.join('.')}${suffix}`
}
