import { describe, expect, it } from 'vitest'
import { WIDGET_KEYS } from '../src/shared/types'
import { createEmptyConfig } from '../src/renderer/api'
import {
  MAX_POLL_SECONDS,
  MIN_POLL_SECONDS,
  WIDGET_OPTIONS,
  WINDOW_MODE_OPTIONS
} from '../src/renderer/components/SettingsPanel'
import {
  findHelpTopic,
  getHelpTopics,
  HELP_TOPICS,
  isHelpCode,
  paragraphText,
  SETTINGS_ENTRY_IDS,
  SETTINGS_TOPIC,
  WIDGET_DESCRIPTIONS,
  topicText
} from '../src/renderer/help-content'

function unique(ids: readonly string[]): boolean {
  return new Set(ids).size === ids.length
}

describe('help content', () => {
  it('exposes topics with unique ids', () => {
    expect(getHelpTopics()).toBe(HELP_TOPICS)
    expect(unique(HELP_TOPICS.map((t) => t.id))).toBe(true)
  })

  it('has unique, non-empty section and entry ids within every topic', () => {
    for (const topic of HELP_TOPICS) {
      expect(topic.sections.length).toBeGreaterThan(0)
      expect(unique(topic.sections.map((s) => s.id))).toBe(true)
      for (const section of topic.sections) {
        expect(section.title).not.toBe('')
        expect(unique((section.entries ?? []).map((e) => e.id))).toBe(true)
      }
    }
  })

  it('flattens inline code segments to text', () => {
    expect(paragraphText(['a ', { code: 'b' }, ' c'])).toBe('a b c')
    expect(isHelpCode({ code: 'x' })).toBe(true)
    expect(isHelpCode('x')).toBe(false)
  })
})

describe('getting-started topic', () => {
  const topic = findHelpTopic('getting-started')

  it('exists with adding-accounts and choosing-what-to-track sections', () => {
    expect(topic).toBeDefined()
    expect(topic!.sections.map((s) => s.id)).toEqual(['adding-accounts', 'choosing-what-to-track'])
  })

  it('explains adding and removing accounts accurately', () => {
    const text = topicText(topic!)
    expect(text).toContain('CLAUDE_CONFIG_DIR')
    expect(text).toContain('.credentials.json')
    expect(text).toContain('+ Add account')
    expect(text).toMatch(/already be linked/)
    expect(text).toMatch(/never deletes any files/)
  })

  it('does not promise label editing', () => {
    const text = topicText(topic!).toLowerCase()
    expect(text).not.toMatch(/(edit|rename|change)\s+(the\s+|its\s+|a\s+)?(label|tab name)/)
    expect(text).toContain('cannot be renamed')
  })

  it('covers account tabs and the session picker', () => {
    const text = topicText(topic!)
    expect(text).toContain('All sessions')
    expect(text).toMatch(/hidden while the Session list widget is turned off/)
  })

  it('marks .credentials.json as inline code', () => {
    const segments = topic!.sections.flatMap((s) =>
      [...s.paragraphs, ...(s.entries ?? []).flatMap((e) => e.body)].flat()
    )
    expect(segments.some((s) => isHelpCode(s) && s.code === '.credentials.json')).toBe(true)
  })
})

describe('settings topic', () => {
  const topic = findHelpTopic('settings')!
  const entries = topic.sections.flatMap((s) => s.entries ?? [])
  const entry = (id: string) => entries.find((e) => e.id === id)!
  const bodyText = (id: string) => entry(id).body.map(paragraphText).join('\n')

  it('is registered after getting-started', () => {
    expect(topic).toBe(SETTINGS_TOPIC)
    expect(HELP_TOPICS.map((t) => t.id)).toEqual(['getting-started', 'settings'])
  })

  it('has an entry for every widget key, labelled as in WIDGET_OPTIONS', () => {
    for (const key of WIDGET_KEYS) {
      const option = WIDGET_OPTIONS.find((o) => o.key === key)
      expect(option, key).toBeDefined()
      expect(entry(key).term).toBe(option!.label)
      expect(bodyText(key)).toContain(WIDGET_DESCRIPTIONS[key])
    }
    const widgetSection = topic.sections.find((s) => s.id === 'widgets')!
    expect(widgetSection.entries!.map((e) => e.id)).toEqual(WIDGET_OPTIONS.map((o) => o.key))
  })

  it('derives the poll interval range and default from exported constants', () => {
    const text = bodyText('usagePollSeconds')
    const defaultSeconds = createEmptyConfig().usagePollSeconds
    expect(text).toContain(`Between ${MIN_POLL_SECONDS} and ${MAX_POLL_SECONDS} seconds`)
    expect(text).toContain(`Default: ${defaultSeconds} seconds`)
    expect(defaultSeconds).toBeGreaterThanOrEqual(MIN_POLL_SECONDS)
    expect(defaultSeconds).toBeLessThanOrEqual(MAX_POLL_SECONDS)
  })

  it('documents always on top', () => {
    expect(entry('alwaysOnTop').term).toBe('Always on top')
    expect(bodyText('alwaysOnTop')).toMatch(/above other windows/)
  })

  it('documents both window modes using min / max labels', () => {
    const text = bodyText('windowMode')
    for (const { label, glyph } of WINDOW_MODE_OPTIONS) {
      expect(entry('windowMode').term).toContain(label)
      expect(text).toContain(`${glyph} ${label}:`)
    }
    expect(text.toLowerCase()).not.toMatch(/minimi[sz]e|maximi[sz]e/)
  })

  it('exposes every entry id via SETTINGS_ENTRY_IDS', () => {
    expect(SETTINGS_ENTRY_IDS).toEqual(entries.map((e) => e.id))
    expect(SETTINGS_ENTRY_IDS).toEqual(
      expect.arrayContaining([...WIDGET_KEYS, 'usagePollSeconds', 'alwaysOnTop', 'windowMode'])
    )
  })
})
