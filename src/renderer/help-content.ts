/**
 * Help content as typed data. Pure module (no DOM, no React) so it compiles
 * under tsconfig.node.json and tests can assert on it directly. Settings text
 * is built from the renderer's own constants so it cannot drift from the UI.
 */

import type {
  EffortLevel,
  SessionStatus,
  UsageStatus,
  WidgetKey,
  WindowMode
} from '../shared/types'
import { createEmptyConfig } from './api'
import { USAGE_THRESHOLDS } from './theme'
import { MAX_FOLDERS } from './mini/playground-sim'
import { DEFAULT_WHEEL_OPTIONS } from './mini/carousel-logic'
import { MINI_SCREEN_IDS, type MiniScreenId } from './mini/screen-ids'
import {
  BASE_SPAWN_INTERVAL_MS,
  DEFAULT_EFFORT_WEIGHT,
  effortWeight,
  MAX_SPAWN_INTERVAL_MS,
  MIN_SPAWN_INTERVAL_MS
} from './mini/spawn-rate'
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
  /** Ids of settings entries (see SETTINGS_ENTRY_IDS) that affect this section. */
  readonly relatedSettings?: readonly string[]
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
      paragraphs: [['Pick what the gauges and session list follow:']],
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
            ['The picker is hidden while the Session list widget is turned off in Settings.']
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
            ...WINDOW_MODE_OPTIONS.map(({ mode, label, glyph }): HelpParagraph => [
              `${glyph} ${label}: ${WINDOW_MODE_DESCRIPTIONS[mode]}`
            ]),
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

/** Looks up a settings entry's display label by id; undefined for unknown ids. */
export function settingsEntryLabel(id: string): string | undefined {
  for (const section of SETTINGS_TOPIC.sections) {
    const entry = section.entries?.find((e) => e.id === id)
    if (entry) return entry.term
  }
  return undefined
}

/** "Related settings: A, B." paragraph so the cross-reference is visible in the panel. */
function relatedSettingsParagraph(ids: readonly string[]): HelpParagraph {
  const labels = ids.map((id) => settingsEntryLabel(id) ?? id)
  return [`Related settings: ${labels.join(', ')}.`]
}

const seconds = (ms: number): string => `${ms / 1000} s`

/** What each usage status means on screen; a Record so new statuses must be documented. */
export const USAGE_STATUS_DESCRIPTIONS: Readonly<Record<UsageStatus, string>> = {
  ok: 'Fresh data from the latest poll.',
  loading: 'No result yet; the first poll is still running.',
  stale:
    'The last refresh failed (network error or rate limit). Gauges are dimmed and keep the last good values until the next successful poll.',
  expired:
    'The account’s login token expired. Run claude in a terminal for that account to refresh it.',
  error: 'An unexpected failure; the message shown explains what went wrong.',
  unavailable: 'No credentials were found for the account, so usage cannot be fetched.'
}

/** What each session status means; a Record so new statuses must be documented. */
export const SESSION_STATUS_DESCRIPTIONS: Readonly<Record<SessionStatus, string>> = {
  busy: 'Claude is working on a turn right now.',
  idle: 'The session is open and has finished its last turn.',
  waiting: 'Claude needs you, e.g. to answer a permission prompt. The reason is shown when known.',
  unknown: 'The app cannot tell the session’s state yet.'
}

/** Every known effort level, lowest first; a Record so a new level fails to compile until listed. */
const EFFORT_LEVEL_RANK: Readonly<Record<EffortLevel, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  max: 3
}
export const EFFORT_LEVELS: readonly EffortLevel[] = (
  Object.keys(EFFORT_LEVEL_RANK) as EffortLevel[]
).sort((a, b) => EFFORT_LEVEL_RANK[a] - EFFORT_LEVEL_RANK[b])

/** Settings entries (by id) that change what each feature shows. */
export const FEATURE_RELATED_SETTINGS = {
  gauges: ['usage5h', 'usageWeekly', 'usagePollSeconds'],
  sessions: ['sessions', 'status', 'model', 'effort', 'branch'],
  playground: ['windowMode']
} as const satisfies Readonly<Record<string, readonly string[]>>

const effortWeightsText = EFFORT_LEVELS.map((level) => `${level} = ${effortWeight(level)}`).join(
  ', '
)

const statusParagraphs = <S extends string>(
  descriptions: Readonly<Record<S, string>>
): HelpParagraph[] =>
  (Object.keys(descriptions) as S[]).map((status) => [code(status), `: ${descriptions[status]}`])

export const FEATURES_TOPIC: HelpTopic = {
  id: 'features',
  title: 'Features',
  sections: [
    {
      id: 'gauges',
      title: 'Usage gauges',
      relatedSettings: FEATURE_RELATED_SETTINGS.gauges,
      paragraphs: [
        [
          'Show how much of your plan’s usage limits the selected account has used, with a countdown to each reset.'
        ],
        relatedSettingsParagraph(FEATURE_RELATED_SETTINGS.gauges)
      ],
      entries: [
        {
          id: 'gauge-5h',
          term: 'Session (5h)',
          body: [['Usage in the rolling 5-hour window.']]
        },
        {
          id: 'gauge-weekly',
          term: 'Weekly',
          body: [
            [
              'Usage in the weekly window. Separate Opus and Sonnet weekly bars appear only when your plan reports them.'
            ]
          ]
        },
        {
          id: 'gauge-colors',
          term: 'Colors',
          body: [
            [
              `Normal below ${USAGE_THRESHOLDS.warning}%, warning from ${USAGE_THRESHOLDS.warning}% up to ${USAGE_THRESHOLDS.critical}%, critical above ${USAGE_THRESHOLDS.critical}%. A gauge without a value shows as unknown.`
            ]
          ]
        },
        {
          id: 'gauge-statuses',
          term: 'Usage status',
          body: statusParagraphs(USAGE_STATUS_DESCRIPTIONS)
        },
        {
          id: 'gauge-refresh',
          term: 'Refreshing',
          body: [['Usage refreshes every poll interval and whenever the window regains focus.']]
        }
      ]
    },
    {
      id: 'sessions',
      title: 'Sessions list',
      relatedSettings: FEATURE_RELATED_SETTINGS.sessions,
      paragraphs: [
        [
          'Lists the live Claude Code sessions of the selected account (or only those ticked in the session picker), one row per working folder.'
        ],
        relatedSettingsParagraph(FEATURE_RELATED_SETTINGS.sessions)
      ],
      entries: [
        {
          id: 'session-status',
          term: 'Status',
          body: statusParagraphs(SESSION_STATUS_DESCRIPTIONS)
        },
        {
          id: 'session-model',
          term: 'Model',
          body: [['The model used for the session’s latest reply, shown with a friendly name.']]
        },
        {
          id: 'session-effort',
          term: 'Effort',
          body: [
            [
              `The reasoning effort level (${EFFORT_LEVELS.join(', ')}). “(default)” means it comes from your `,
              code('settings.json'),
              ' rather than from the session itself.'
            ]
          ]
        },
        {
          id: 'session-branch',
          term: 'Git branch',
          body: [['The git branch of the session’s working folder, when it is a git repository.']]
        }
      ]
    },
    {
      id: 'playground',
      title: 'Playground (mini only)',
      relatedSettings: FEATURE_RELATED_SETTINGS.playground,
      paragraphs: [
        [
          'A small animated playground available only in the mini window, as its last screen. Pets chase folders that appear while your sessions are working. It follows session status and effort even when those widgets are turned off.'
        ],
        relatedSettingsParagraph(FEATURE_RELATED_SETTINGS.playground)
      ],
      entries: [
        {
          id: 'playground-spawn-rate',
          term: 'How fast folders appear',
          body: [
            [
              'Only busy sessions count; idle, waiting and unknown sessions add nothing, so no folders appear when no session is busy.'
            ],
            [
              `Each busy session adds a weight by effort: ${effortWeightsText} (anything else counts as ${DEFAULT_EFFORT_WEIGHT}).`
            ],
            [
              `A new folder appears every ${seconds(BASE_SPAWN_INTERVAL_MS)} ÷ total weight, kept between ${seconds(MIN_SPAWN_INTERVAL_MS)} and ${seconds(MAX_SPAWN_INTERVAL_MS)}.`
            ]
          ]
        },
        {
          id: 'playground-max-folders',
          term: 'Folder limit',
          body: [[`At most ${MAX_FOLDERS} folders are on screen at once.`]]
        }
      ]
    }
  ]
}

/** Label and summary for each mini carousel screen; a Record so a new screen must be documented. */
export const MINI_SCREEN_DESCRIPTIONS: Readonly<
  Record<MiniScreenId, { readonly label: string; readonly description: string }>
> = {
  gauges: {
    label: 'Gauges',
    description:
      '5h and weekly gauges with reset times, plus a one-line notice when data is stale, expired or failed to load.'
  },
  sessions: {
    label: 'Sessions',
    description:
      'One line per session (repo · status · model · effort); sessions that do not fit are summarized as “+N more”.'
  },
  settings: {
    label: 'Settings',
    description:
      'The same settings as the max window in a compact two-column layout, including the min / max toggle.'
  },
  playground: {
    label: 'Playground',
    description: 'The pet playground. It exists only in the mini window.'
  }
}

const MINI_LABEL = windowModeLabel('mini')
const MAX_LABEL = windowModeLabel('max')
const MINI_SCREEN_ORDER = MINI_SCREEN_IDS.map((id) => MINI_SCREEN_DESCRIPTIONS[id].label).join(
  ' → '
)

export const MODES_TOPIC: HelpTopic = {
  id: 'modes',
  title: `Mini vs max (${MINI_LABEL} / ${MAX_LABEL})`,
  sections: [
    {
      id: 'window-modes',
      title: 'The two window sizes',
      relatedSettings: ['windowMode'],
      paragraphs: [
        [
          'The app runs in one of two window sizes. Both show the same data for the selected account; they differ in layout and in what you can do.'
        ]
      ],
      entries: WINDOW_MODE_OPTIONS.map(({ mode, label, glyph }) => ({
        id: mode,
        term: `${glyph} ${label}`,
        body:
          mode === 'max'
            ? [
                [
                  'The full, resizable window. It is the only place to add, remove and switch accounts (account tabs) and to choose sessions with the session picker.'
                ],
                [
                  'Settings open as a full panel with a Done button. Content that does not fit scrolls.'
                ]
              ]
            : [
                [
                  'A small square (1:1) window showing one condensed screen at a time. The strip at the top shows the active account and is used to drag the window; to change accounts, switch back to max.'
                ],
                [
                  'Settings use a compact two-column layout. Text scales with the window size and nothing scrolls.'
                ]
              ]
      }))
    },
    {
      id: 'switching',
      title: 'Switching between them',
      relatedSettings: ['windowMode'],
      paragraphs: [
        [
          `To shrink: open Settings in the max window and choose ${MINI_LABEL} under Window. To grow: go to the Settings screen in the mini carousel and choose ${MAX_LABEL}. If the mini window shows an error or “no accounts” message, the same ${MINI_LABEL} / ${MAX_LABEL} toggle appears in that message.`
        ],
        [
          'Each size remembers its own position and dimensions (saved as ',
          code('windowBounds'),
          ' for max and ',
          code('miniWindowBounds'),
          ' for mini), so switching puts the window back where that size was last used. The app reopens in the size you used last.'
        ]
      ]
    },
    {
      id: 'carousel',
      title: 'Mini screens',
      paragraphs: [
        [`Screens come in this order and loop around: ${MINI_SCREEN_ORDER}.`],
        [
          `Swipe sideways on a trackpad, or hold Shift and turn the mouse wheel. Each gesture moves exactly one screen: it must pass ${DEFAULT_WHEEL_OPTIONS.threshold} px, then waits ${DEFAULT_WHEEL_OPTIONS.cooldownMs} ms before the next move.`
        ],
        [
          'When the carousel has focus, ← and → move one screen (ignored while typing in a text field). Click a dot at the bottom to jump to a screen.'
        ]
      ],
      entries: MINI_SCREEN_IDS.map((id) => ({
        id,
        term: MINI_SCREEN_DESCRIPTIONS[id].label,
        body: [[MINI_SCREEN_DESCRIPTIONS[id].description]]
      }))
    }
  ]
}

export const GLOSSARY_TOPIC: HelpTopic = {
  id: 'glossary',
  title: 'Glossary',
  sections: [
    {
      id: 'terms',
      title: 'Terms',
      paragraphs: [],
      entries: [
        {
          id: 'session',
          term: 'Session',
          body: [
            [
              'One running Claude Code instance (one ',
              code('claude'),
              ' process) in a working folder. Each account can have several at once.'
            ]
          ]
        },
        {
          id: 'config-dir',
          term: 'Config dir',
          body: [
            [
              'The folder where Claude Code keeps an account’s login and sessions: ',
              code('~/.claude'),
              ' by default, or the folder set with ',
              code('CLAUDE_CONFIG_DIR'),
              '. Each linked account is one config dir.'
            ]
          ]
        },
        {
          id: 'effort',
          term: 'Effort',
          body: [
            [
              `How hard Claude reasons on each turn: ${EFFORT_LEVELS.join(', ')}. Higher effort uses more of your limits.`
            ]
          ]
        },
        {
          id: '5h-window',
          term: '5h window',
          body: [
            [
              'A rolling 5-hour usage limit. It starts with your first message and resets 5 hours later; the Session (5h) gauge shows how much of it is used.'
            ]
          ]
        },
        {
          id: 'weekly-window',
          term: 'Weekly window',
          body: [
            [
              'A 7-day usage limit across all sessions of the account, shown by the Weekly gauge. Some plans also report separate Opus and Sonnet weekly limits.'
            ]
          ]
        },
        {
          id: 'stale',
          term: 'Stale',
          body: [[USAGE_STATUS_DESCRIPTIONS.stale]]
        },
        {
          id: 'expired',
          term: 'Expired',
          body: [[USAGE_STATUS_DESCRIPTIONS.expired]]
        }
      ]
    }
  ]
}

/** Glossary entry ids, for completeness checks. */
export const GLOSSARY_TERM_IDS = [
  'session',
  'config-dir',
  'effort',
  '5h-window',
  'weekly-window',
  'stale',
  'expired'
] as const

export const HELP_TOPICS: readonly HelpTopic[] = [
  GETTING_STARTED_TOPIC,
  SETTINGS_TOPIC,
  FEATURES_TOPIC,
  MODES_TOPIC,
  GLOSSARY_TOPIC
]

export function getHelpTopics(): readonly HelpTopic[] {
  return HELP_TOPICS
}

export function findHelpTopic(id: string): HelpTopic | undefined {
  return HELP_TOPICS.find((topic) => topic.id === id)
}
