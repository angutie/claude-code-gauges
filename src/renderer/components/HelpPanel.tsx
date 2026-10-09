import { useState, type ReactNode } from 'react'
import {
  HELP_TOPICS,
  isHelpCode,
  type HelpEntry,
  type HelpParagraph,
  type HelpSection,
  type HelpTopic
} from '../help-content'
import {
  backToIndex,
  canGoNext,
  canGoPrev,
  clampPage,
  currentTopic,
  HELP_INDEX_STATE,
  helpCards,
  openTopic,
  stepCard,
  type HelpPagingState
} from '../help-paging'

export interface HelpPanelProps {
  /** Shows a Done button that calls this; omit when the panel cannot be closed (e.g. a carousel screen). */
  onClose?: () => void
  /** Condensed layout for the mini window. */
  compact?: boolean
  /** Topics to render; defaults to every help topic. */
  topics?: readonly HelpTopic[]
}

/** Renders text segments, turning code segments into inline `<code>`. */
export function renderParagraph(paragraph: HelpParagraph): ReactNode[] {
  return paragraph.map((segment, i) =>
    isHelpCode(segment) ? <code key={i}>{segment.code}</code> : segment
  )
}

function HelpEntryItem({ entry }: { entry: HelpEntry }): React.JSX.Element {
  return (
    <div className="help-entry">
      <dt className="help-entry-term">{entry.term}</dt>
      {entry.body.map((paragraph, i) => (
        <dd key={i} className="help-entry-body">
          {renderParagraph(paragraph)}
        </dd>
      ))}
    </div>
  )
}

function HelpSectionBlock({ section }: { section: HelpSection }): React.JSX.Element {
  const entries = section.entries ?? []
  return (
    <div className="help-section" id={`help-section-${section.id}`}>
      <h4 className="settings-legend help-section-title">{section.title}</h4>
      {section.paragraphs.map((paragraph, i) => (
        <p key={i} className="help-paragraph">
          {renderParagraph(paragraph)}
        </p>
      ))}
      {entries.length > 0 && (
        <dl className="help-entries">
          {entries.map((entry) => (
            <HelpEntryItem key={entry.id} entry={entry} />
          ))}
        </dl>
      )}
    </div>
  )
}

export function HelpTopicBlock({ topic }: { topic: HelpTopic }): React.JSX.Element {
  return (
    <article className="help-topic" id={`help-topic-${topic.id}`} aria-label={topic.title}>
      <h3 className="help-topic-title">{topic.title}</h3>
      {topic.sections.map((section) => (
        <HelpSectionBlock key={section.id} section={section} />
      ))}
    </article>
  )
}

export interface CompactHelpViewProps {
  state: HelpPagingState
  topics: readonly HelpTopic[]
  onNavigate: (next: HelpPagingState) => void
}

/**
 * Stateless compact help: the topic index, or one card of the open topic with
 * Back and ‹ / › buttons. Navigation is buttons only (no key handlers) so the
 * mini carousel's ←/→ keys keep working.
 */
export function CompactHelpView({
  state,
  topics,
  onNavigate
}: CompactHelpViewProps): React.JSX.Element {
  const topic = currentTopic(state, topics)
  if (!topic) {
    return (
      <nav className="help-index" aria-label="Help topics">
        {topics.map((t) => (
          <button
            key={t.id}
            type="button"
            className="button help-index-item"
            onClick={() => onNavigate(openTopic(t.id))}
          >
            {t.title}
          </button>
        ))}
      </nav>
    )
  }

  const cards = helpCards(topic)
  const page = clampPage(state.page, cards.length)
  const card = cards[page]
  const step = (delta: 1 | -1): void => onNavigate(stepCard({ ...state, page }, delta, topics))
  return (
    <article className="help-card" aria-label={topic.title}>
      <div className="help-card-head">
        <button type="button" className="button" onClick={() => onNavigate(backToIndex())}>
          Back
        </button>
        <h3 className="help-topic-title">{topic.title}</h3>
      </div>
      {card && (
        <div className="help-card-body">
          <h4 className="settings-legend help-section-title">{card.sectionTitle}</h4>
          {card.term && <p className="help-entry-term">{card.term}</p>}
          {card.body.map((paragraph, i) => (
            <p key={i} className="help-paragraph">
              {renderParagraph(paragraph)}
            </p>
          ))}
        </div>
      )}
      <div className="help-pager">
        <button
          type="button"
          className="button"
          aria-label="Previous card"
          disabled={!canGoPrev(page, cards.length)}
          onClick={() => step(-1)}
        >
          ‹
        </button>
        <span className="muted help-pager-count">
          {cards.length === 0 ? 0 : page + 1} / {cards.length}
        </span>
        <button
          type="button"
          className="button"
          aria-label="Next card"
          disabled={!canGoNext(page, cards.length)}
          onClick={() => step(1)}
        >
          ›
        </button>
      </div>
    </article>
  )
}

/** Holds the compact paging state locally; starts on the topic index. */
export function CompactHelp({ topics }: { topics: readonly HelpTopic[] }): React.JSX.Element {
  const [state, setState] = useState<HelpPagingState>(HELP_INDEX_STATE)
  return <CompactHelpView state={state} topics={topics} onNavigate={setState} />
}

/** Help reference: every topic in full, or (compact) an index plus paged cards. Hook-free itself. */
export function HelpPanel({
  onClose,
  compact = false,
  topics = HELP_TOPICS
}: HelpPanelProps): React.JSX.Element {
  return (
    <section className={`panel help-panel${compact ? ' help-panel--compact' : ''}`} aria-label="Help">
      <div className="settings-panel-head help-panel-head">
        <h2 className="panel-title">Help</h2>
        {onClose && (
          <button type="button" className="button" onClick={onClose}>
            Done
          </button>
        )}
      </div>
      {compact ? (
        <CompactHelp topics={topics} />
      ) : (
        topics.map((topic) => <HelpTopicBlock key={topic.id} topic={topic} />)
      )}
    </section>
  )
}

export default HelpPanel
