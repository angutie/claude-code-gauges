import { describe, expect, it } from 'vitest'
import { friendlyModelName } from '../src/renderer/utils/model-name'

describe('friendlyModelName', () => {
  it.each([
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-sonnet-4-5-20250929', 'Sonnet 4.5'],
    ['claude-haiku-4-5', 'Haiku 4.5'],
    ['claude-opus-4-1-20250805', 'Opus 4.1'],
    ['claude-opus-4', 'Opus 4'],
    ['claude-sonnet-4-20250514', 'Sonnet 4'],
    ['claude-fable-5', 'Fable 5']
  ])('maps new-style id %s to %s', (id, expected) => {
    expect(friendlyModelName(id)).toBe(expected)
  })

  it.each([
    ['claude-3-5-sonnet-20241022', 'Sonnet 3.5'],
    ['claude-3-7-sonnet-latest', 'Sonnet 3.7'],
    ['claude-3-haiku-20240307', 'Haiku 3'],
    ['claude-3-opus-20240229', 'Opus 3']
  ])('maps legacy id %s to %s', (id, expected) => {
    expect(friendlyModelName(id)).toBe(expected)
  })

  it('marks 1M context variants', () => {
    expect(friendlyModelName('claude-opus-5-5[1m]')).toBe('Opus 5.5 (1M)')
  })

  it('handles provider-prefixed ids', () => {
    expect(friendlyModelName('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('Sonnet 4.5')
    expect(friendlyModelName('anthropic.claude-3-5-sonnet-20241022-v2:0')).toBe('Sonnet 3.5')
    expect(friendlyModelName('claude-opus-4-1@20250805')).toBe('Opus 4.1')
  })

  it('is case-insensitive and trims whitespace', () => {
    expect(friendlyModelName('  Claude-Opus-5-5 ')).toBe('Opus 5.5')
  })

  it('maps legacy named models', () => {
    expect(friendlyModelName('claude-2.1')).toBe('Claude 2.1')
    expect(friendlyModelName('claude-instant-1.2')).toBe('Claude Instant 1.2')
  })

  it('falls back to the raw id for unrecognized models', () => {
    expect(friendlyModelName('gpt-4o')).toBe('gpt-4o')
    expect(friendlyModelName('claude-something-new-model')).toBe('claude-something-new-model')
    expect(friendlyModelName('<synthetic>')).toBe('<synthetic>')
  })

  it('returns null for empty input', () => {
    expect(friendlyModelName(null)).toBeNull()
    expect(friendlyModelName(undefined)).toBeNull()
    expect(friendlyModelName('   ')).toBeNull()
  })
})
