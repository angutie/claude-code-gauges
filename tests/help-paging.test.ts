import { describe, expect, it } from 'vitest'
import { HELP_TOPICS, type HelpTopic } from '../src/renderer/help-content'
import {
  backToIndex,
  canGoNext,
  canGoPrev,
  clampPage,
  currentTopic,
  HELP_INDEX_STATE,
  helpCards,
  nextPage,
  openTopic,
  prevPage,
  stepCard
} from '../src/renderer/help-paging'

const topic: HelpTopic = {
  id: 't',
  title: 'Topic',
  sections: [
    {
      id: 'a',
      title: 'A',
      paragraphs: [['intro']],
      entries: [
        { id: 'x', term: 'X', body: [['x body']] },
        { id: 'y', term: 'Y', body: [['y body']] }
      ]
    },
    { id: 'b', title: 'B', paragraphs: [], entries: [{ id: 'z', term: 'Z', body: [['z']] }] }
  ]
}

describe('helpCards', () => {
  it('makes an intro card per section with paragraphs plus one card per entry', () => {
    const cards = helpCards(topic)
    expect(cards.map((c) => c.id)).toEqual(['a', 'a/x', 'a/y', 'b/z'])
    expect(cards[0]?.term).toBeUndefined()
    expect(cards[1]).toMatchObject({ sectionTitle: 'A', term: 'X' })
    expect(cards[3]).toMatchObject({ sectionTitle: 'B', term: 'Z' })
  })

  it('produces at least one card with a unique id for every real topic', () => {
    for (const t of HELP_TOPICS) {
      const ids = helpCards(t).map((c) => c.id)
      expect(ids.length).toBeGreaterThan(0)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe('page clamping', () => {
  it('clamps into [0, count - 1]', () => {
    expect(clampPage(-3, 4)).toBe(0)
    expect(clampPage(2, 4)).toBe(2)
    expect(clampPage(9, 4)).toBe(3)
    expect(clampPage(1.7, 4)).toBe(1)
    expect(clampPage(Number.NaN, 4)).toBe(0)
    expect(clampPage(5, 0)).toBe(0)
  })

  it('stops at the first and last card', () => {
    expect(prevPage(0, 4)).toBe(0)
    expect(nextPage(3, 4)).toBe(3)
    expect(nextPage(0, 4)).toBe(1)
    expect(prevPage(3, 4)).toBe(2)
    expect(canGoPrev(0, 4)).toBe(false)
    expect(canGoNext(0, 4)).toBe(true)
    expect(canGoPrev(3, 4)).toBe(true)
    expect(canGoNext(3, 4)).toBe(false)
    expect(canGoPrev(0, 1)).toBe(false)
    expect(canGoNext(0, 1)).toBe(false)
  })
})

describe('paging state', () => {
  const topics = [topic]

  it('starts on the index and opens topics at page 0', () => {
    expect(HELP_INDEX_STATE).toEqual({ topicId: null, page: 0 })
    expect(currentTopic(HELP_INDEX_STATE, topics)).toBeUndefined()
    expect(openTopic('t')).toEqual({ topicId: 't', page: 0 })
    expect(currentTopic(openTopic('t'), topics)).toBe(topic)
    expect(currentTopic(openTopic('nope'), topics)).toBeUndefined()
    expect(backToIndex()).toEqual(HELP_INDEX_STATE)
  })

  it('steps through cards and clamps at both ends', () => {
    let state = openTopic('t')
    expect(stepCard(state, -1, topics)).toBe(state)
    for (let i = 0; i < 10; i++) state = stepCard(state, 1, topics)
    expect(state.page).toBe(3)
    expect(stepCard(state, 1, topics)).toBe(state)
    expect(stepCard(state, -1, topics).page).toBe(2)
  })

  it('is a no-op on the index', () => {
    expect(stepCard(HELP_INDEX_STATE, 1, topics)).toBe(HELP_INDEX_STATE)
  })
})
