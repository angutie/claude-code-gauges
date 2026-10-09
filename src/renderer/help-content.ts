/**
 * Help content as typed data. Pure module (no DOM, no React) so it compiles
 * under tsconfig.node.json and tests can assert on it directly.
 */

/** Inline code, rendered as `<code>` by the help UI. */
export interface HelpCode {
  readonly code: string
}

/** A run of text: plain string or an inline-code segment. */
export type HelpSegment = string | HelpCode

/** One paragraph (or list item) made of text/code segments. */
export type HelpParagraph = readonly HelpSegment[]

/** A labelled item inside a section, e.g. one setting or one step. */
export interface HelpEntry {
  readonly id: string
  readonly term: string
  readonly body: readonly HelpParagraph[]
}

export interface HelpSection {
  readonly id: string
  readonly title: string
  readonly paragraphs: readonly HelpParagraph[]
  readonly entries?: readonly HelpEntry[]
}

export interface HelpTopic {
  readonly id: string
  readonly title: string
  readonly sections: readonly HelpSection[]
}

export const code = (text: string): HelpCode => ({ code: text })

export function isHelpCode(segment: HelpSegment): segment is HelpCode {
  return typeof segment !== 'string'
}

/** Flattens a paragraph to plain text (code segments keep their raw text). */
export function paragraphText(paragraph: HelpParagraph): string {
  return paragraph.map((s) => (isHelpCode(s) ? s.code : s)).join('')
}

/** All plain text of a topic, useful for searching and tests. */
export function topicText(topic: HelpTopic): string {
  const parts: string[] = [topic.title]
  for (const section of topic.sections) {
    parts.push(section.title, ...section.paragraphs.map(paragraphText))
    for (const entry of section.entries ?? []) {
      parts.push(entry.term, ...entry.body.map(paragraphText))
    }
  }
  return parts.join('\n')
}

const ADD_ACCOUNT_LABEL = '+ Add account'
const ALL_SESSIONS_LABEL = 'All sessions'

export const GETTING_STARTED_TOPIC: HelpTopic = {
  id: 'getting-started',
  title: 'Getting started',
  sections: [
    {
      id: 'adding-accounts',
      title: 'Adding accounts',
      paragraphs: [
        [
          'Each Claude Code account lives in its own config folder: ',
          code('~/.claude'),
          ' by default, or any folder set with the ',
          code('CLAUDE_CONFIG_DIR'),
          ' environment variable. On first run the app links one account automatically.'
        ]
      ],
      entries: [
        {
          id: 'create-config-dir',
          term: '1. Sign in with a separate config folder',
          body: [
            [
              'Start Claude Code with ',
              code('CLAUDE_CONFIG_DIR'),
              ' pointing at a new folder (for example ',
              code('CLAUDE_CONFIG_DIR=~/.claude-work claude'),
              '), then run ',
              code('/login'),
              '. This creates ',
              code('.credentials.json'),
              ' in that folder.'
            ]
          ]
        },
        {
          id: 'add-account-button',
          term: `2. Click "${ADD_ACCOUNT_LABEL}"`,
          body: [
            [
              `In the max window, click "${ADD_ACCOUNT_LABEL}" next to the account tabs and pick that folder. The folder must contain a readable `,
              code('.credentials.json'),
              ' and must not already be linked; otherwise an error is shown inline.'
            ]
          ]
        },
        {
          id: 'keep-config-dir',
          term: '3. Keep using the same folder',
          body: [
            [
              'Always start Claude Code for that account with the same ',
              code('CLAUDE_CONFIG_DIR'),
              ' so its sessions appear under that account’s tab.'
            ]
          ]
        },
        {
          id: 'remove-account',
          term: 'Removing an account',
          body: [
            [
              'Click the × on the account’s tab and confirm. This only unlinks it from the app — it never deletes any files in the config folder.'
            ]
          ]
        },
        {
          id: 'account-labels',
          term: 'Tab names',
          body: [
            [
              'Tabs show the account’s email address, taken from Claude Code. They cannot be renamed in the app.'
            ]
          ]
        }
      ]
    },
    {
      id: 'choosing-what-to-track',
      title: 'Choosing what to track',
      paragraphs: [
        ['Pick what the gauges and session list follow:']
      ],
      entries: [
        {
          id: 'account-tabs',
          term: 'Account tabs',
          body: [
            [
              'In the max window there is one tab per linked account. Select a tab to show that account’s usage gauges and sessions.'
            ]
          ]
        },
        {
          id: 'session-picker',
          term: 'Session picker',
          body: [
            [
              `Under the tabs, keep "${ALL_SESSIONS_LABEL}" checked to follow every live session of the account, or uncheck it and tick individual sessions. Your choice is remembered per account.`
            ],
            [
              'The picker is hidden while the Session list widget is turned off in Settings.'
            ]
          ]
        }
      ]
    }
  ]
}

export const HELP_TOPICS: readonly HelpTopic[] = [GETTING_STARTED_TOPIC]

export function getHelpTopics(): readonly HelpTopic[] {
  return HELP_TOPICS
}

export function findHelpTopic(id: string): HelpTopic | undefined {
  return HELP_TOPICS.find((topic) => topic.id === id)
}
