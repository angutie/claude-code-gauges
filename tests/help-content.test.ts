import { describe, expect, it } from 'vitest'
import {
  findHelpTopic,
  getHelpTopics,
  HELP_TOPICS,
  isHelpCode,
  paragraphText,
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
