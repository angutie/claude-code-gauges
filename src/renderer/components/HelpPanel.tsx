import type { ReactNode } from 'react'
import {
  HELP_TOPICS,
  isHelpCode,
  type HelpEntry,
  type HelpParagraph,
  type HelpSection,
  type HelpTopic
} from '../help-content'

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

/** Help reference: every topic with its sections and entries. Hook-free. */
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
      {topics.map((topic) => (
        <HelpTopicBlock key={topic.id} topic={topic} />
      ))}
    </section>
  )
}

export default HelpPanel
