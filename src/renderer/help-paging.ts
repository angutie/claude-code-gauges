/**
 * Pure paging logic for the compact (mini) help view: a topic index, then one
 * short card at a time. No DOM, no React, so tests can drive it directly.
 */

import type { HelpEntry, HelpParagraph, HelpSection, HelpTopic } from './help-content'

/** One screenful of help: a section intro or a single entry. */
export interface HelpCard {
  readonly id: string
  /** Section title, shown as context above the card. */
  readonly sectionTitle: string
  /** Entry term; absent on a section's intro card. */
  readonly term?: string
  readonly body: readonly HelpParagraph[]
}

/** `topicId === null` means the topic index is showing. */
export interface HelpPagingState {
  readonly topicId: string | null
  readonly page: number
}

export const HELP_INDEX_STATE: HelpPagingState = { topicId: null, page: 0 }

function entryCard(section: HelpSection, entry: HelpEntry): HelpCard {
  return {
    id: `${section.id}/${entry.id}`,
    sectionTitle: section.title,
    term: entry.term,
    body: entry.body
  }
}

/** Splits a topic into cards: an intro per section (when it has paragraphs) plus one per entry. */
export function helpCards(topic: HelpTopic): HelpCard[] {
  return topic.sections.flatMap((section) => {
    const intro: HelpCard[] =
      section.paragraphs.length > 0
        ? [{ id: section.id, sectionTitle: section.title, body: section.paragraphs }]
        : []
    return [...intro, ...(section.entries ?? []).map((entry) => entryCard(section, entry))]
  })
}

/** Clamps a page index into `[0, count - 1]` (0 when there are no cards). */
export function clampPage(page: number, count: number): number {
  if (count <= 0 || !Number.isFinite(page)) return 0
  return Math.min(Math.max(Math.trunc(page), 0), count - 1)
}

export const canGoPrev = (page: number, count: number): boolean => clampPage(page, count) > 0
export const canGoNext = (page: number, count: number): boolean =>
  clampPage(page, count) < count - 1

export const prevPage = (page: number, count: number): number => clampPage(page - 1, count)
export const nextPage = (page: number, count: number): number => clampPage(page + 1, count)

export function openTopic(topicId: string): HelpPagingState {
  return { topicId, page: 0 }
}

export function backToIndex(): HelpPagingState {
  return HELP_INDEX_STATE
}

/** Moves one card forward/back within the open topic; no-op on the index. */
export function stepCard(
  state: HelpPagingState,
  delta: 1 | -1,
  topics: readonly HelpTopic[]
): HelpPagingState {
  const topic = currentTopic(state, topics)
  if (!topic) return state
  const count = helpCards(topic).length
  const page = delta > 0 ? nextPage(state.page, count) : prevPage(state.page, count)
  return page === state.page ? state : { ...state, page }
}

/** The open topic, or undefined on the index (or when the id is unknown). */
export function currentTopic(
  state: HelpPagingState,
  topics: readonly HelpTopic[]
): HelpTopic | undefined {
  return state.topicId === null ? undefined : topics.find((t) => t.id === state.topicId)
}
