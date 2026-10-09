/**
 * Help content as typed data. Pure module (no DOM, no React) so it compiles
 * under tsconfig.node.json and tests can assert on it directly. Settings text
 * is built from the renderer's own constants so it cannot drift from the UI.
 */

import type { WidgetKey, WindowMode } from '../shared/types'
import { createEmptyConfig } from './api'
import {
  MAX_POLL_SECONDS,
  MIN_POLL_SECONDS,
  WIDGET_OPTIONS,
  WINDOW_MODE_OPTIONS
} from './components/SettingsPanel'

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

/** What each widget toggle controls; a Record so a new widget key fails to compile until documented. */
export const WIDGET_DESCRIPTIONS: Readonly<Record<WidgetKey, string>> = {
  usage5h: 'Shows the gauge for the rolling 5-hour usage window and when it resets.',
  usageWeekly:
    'Shows the weekly usage gauge, plus Opus / Sonnet weekly bars when your plan reports them.',
  sessions:
    'Shows the list of live Claude Code sessions for the selected account. Turning it off also hides the session picker.',
  model: 'Shows which model each session is using.',
  effort: 'Shows each session’s reasoning effort level (low, medium, high or max).',
  branch: 'Shows the git branch of each session’s working folder.',
  status: 'Shows whether each session is busy, idle or waiting for you.'
}

const DEFAULT_CONFIG = createEmptyConfig()

const onOff = (value: boolean): string => (value ? 'on' : 'off')

const WINDOW_MODE_DESCRIPTIONS: Readonly<Record<WindowMode, string>> = {
  mini: 'a small square window with swipeable screens. Text scales with the window and nothing scrolls.',
  max: 'the full window with account tabs, the session picker and the complete settings panel.'
}

const windowModeLabel = (mode: WindowMode): string =>
  WINDOW_MODE_OPTIONS.find((option) => option.mode === mode)?.label ?? mode

export const SETTINGS_TOPIC: HelpTopic = {
  id: 'settings',
  title: 'Settings reference',
  sections: [
    {
      id: 'widgets',
      title: 'Widgets',
      paragraphs: [
        ['Turn individual parts of the display on or off. Changes apply immediately and are saved.']
      ],
      entries: WIDGET_OPTIONS.map(({ key, label }) => ({
        id: key,
        term: label,
        body: [[WIDGET_DESCRIPTIONS[key]], [`Default: ${onOff(DEFAULT_CONFIG.widgets[key])}.`]]
      }))
    },
    {
      id: 'usage',
      title: 'Usage',
      paragraphs: [],
      entries: [
        {
          id: 'usagePollSeconds',
          term: 'Poll interval (seconds)',
          body: [
            [
              'How often usage limits are refreshed from Anthropic. Usage also refreshes when the window regains focus.'
            ],
            [
              `Between ${MIN_POLL_SECONDS} and ${MAX_POLL_SECONDS} seconds; values outside that range are clamped. Default: ${DEFAULT_CONFIG.usagePollSeconds} seconds.`
            ]
          ]
        }
      ]
    },
    {
      id: 'window',
      title: 'Window',
      paragraphs: [],
      entries: [
        {
          id: 'alwaysOnTop',
          term: 'Always on top',
          body: [
            ['Keeps the gauges window above other windows so it stays visible while you work.'],
            [`Default: ${onOff(DEFAULT_CONFIG.alwaysOnTop)}.`]
          ]
        },
        {
          id: 'windowMode',
          term: `Window size (${WINDOW_MODE_OPTIONS.map((option) => option.label).join(' / ')})`,
          body: [
            ...WINDOW_MODE_OPTIONS.map(
              ({ mode, label, glyph }): HelpParagraph => [
                `${glyph} ${label}: ${WINDOW_MODE_DESCRIPTIONS[mode]}`
              ]
            ),
            [
              `Each size remembers its own position and dimensions. Default: ${windowModeLabel(DEFAULT_CONFIG.windowMode)}.`
            ]
          ]
        }
      ]
    }
  ]
}

/** Ids of every settings entry, for cross-references from other topics. */
export const SETTINGS_ENTRY_IDS: readonly string[] = SETTINGS_TOPIC.sections.flatMap((section) =>
  (section.entries ?? []).map((entry) => entry.id)
)

export const HELP_TOPICS: readonly HelpTopic[] = [GETTING_STARTED_TOPIC, SETTINGS_TOPIC]

export function getHelpTopics(): readonly HelpTopic[] {
  return HELP_TOPICS
}

export function findHelpTopic(id: string): HelpTopic | undefined {
  return HELP_TOPICS.find((topic) => topic.id === id)
}
